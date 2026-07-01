-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — A1.1 : Table creneaux_cabinet (horaires par cabinet)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-06-30
-- Epic   : structure des gardes configurable + roulement ordonné
--          (docs/v2/07-epic-structure-roulement.md) — Fondation A1
-- ───────────────────────────────────────────────────────────────
-- ⚠️ MIGRATION DE SÉCURITÉ — crée des policies RLS (gate TILT auth/RLS).
--   NE PAS APPLIQUER SANS RELECTURE. Appliquer sur la base MPP
--   (mpvrokmtwqlmhvxaaxdn) via le SQL Editor du dashboard ou la
--   Management API — jamais en auto direct.
--
-- OBJET
--   `creneaux_cabinet` est une SURCOUCHE optionnelle, PAR CABINET, des
--   horaires d'un type de créneau. Elle ne remplace pas le référentiel
--   partagé `creneaux_catalogue` : elle le SURCHARGE quand un cabinet a
--   des horaires propres (ex. gardes de semaine 19h→08h au lieu de 18h30).
--
--   ⚠️ Comportement par défaut INCHANGÉ : tant qu'un cabinet n'a AUCUNE
--   ligne ici, le code retombe sur les horaires par défaut (constantes
--   `CRENEAUX` de src/engine/structure-creneaux.ts, miroir du seed
--   `creneaux_catalogue`). Table vide = zéro changement.
--
--   Ne porte QUE l'horaire (début/fin/offset/libellé/actif). Les faits
--   structurels intrinsèques (un week-end EST un week-end, un soir EST une
--   nuit) ne sont pas configurables ici — ils dépendent du jour, pas du
--   cabinet. L'effectif semaine reste porté par periodes.nb_vetos_semaine_soir.
--
-- SÉCURITÉ — modèle F5-003 durci (identique à regles_cabinet) :
--   1. isolation cabinet → RESTRICTIVE (borne au cabinet, n'accorde rien)
--   2. écriture (INSERT/UPDATE/DELETE) → PERMISSIVE réservée à l'ADMIN
--   3. lecture → PERMISSIVE pour tout authentifié (la restrictive borne)
--   Dépend des fonctions auth_cabinet_actif() et get_user_role()
--   (créées en F5-001/F5-003, déjà utilisées par regles_cabinet).
--
-- IDEMPOTENCE : CREATE TABLE IF NOT EXISTS ; DROP POLICY IF EXISTS avant
--   CREATE. Transaction atomique.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.creneaux_cabinet (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       UUID NOT NULL REFERENCES public.cabinets(id),
  -- Code machine — aligné sur TypeGardeEngine / creneaux_catalogue.code
  -- ('semaine_soir' | 'vendredi_soir' | 'weekend' | 'ferie').
  code             TEXT NOT NULL,
  -- Override optionnel du libellé humain (NULL = libellé par défaut).
  libelle          TEXT,
  -- Horaires propres au cabinet (locale Europe/Paris).
  heure_debut      TIME NOT NULL,
  heure_fin        TIME NOT NULL,
  -- Nombre de jours entre la date de début et la date de fin
  -- (1 = finit le lendemain ; 2 = surlendemain, ex. week-end sam→lun).
  offset_jours_fin SMALLINT NOT NULL DEFAULT 1 CHECK (offset_jours_fin BETWEEN 0 AND 3),
  -- Le cabinet pratique-t-il ce type de garde ? (false = type désactivé).
  actif            BOOLEAN NOT NULL DEFAULT true,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  mis_a_jour_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un seul réglage par (cabinet, type de créneau).
  CONSTRAINT creneaux_cabinet_unique UNIQUE (cabinet_id, code)
);

CREATE INDEX IF NOT EXISTS idx_creneaux_cabinet_cab
  ON public.creneaux_cabinet (cabinet_id);

COMMENT ON TABLE public.creneaux_cabinet IS
  'Surcouche optionnelle des horaires de créneau PAR CABINET (A1). Vide = horaires par défaut (creneaux_catalogue). RLS durcie (modèle F5-003) : écriture admin-only, isolation RESTRICTIVE.';
COMMENT ON COLUMN public.creneaux_cabinet.code             IS 'Type de créneau (aligné TypeGardeEngine) que ce réglage surcharge';
COMMENT ON COLUMN public.creneaux_cabinet.offset_jours_fin IS 'Jours entre début et fin (1 = lendemain, 2 = surlendemain pour le week-end)';
COMMENT ON COLUMN public.creneaux_cabinet.actif            IS 'Le cabinet pratique ce type de garde (false = désactivé pour ce cabinet)';

-- Trigger : mise à jour automatique de mis_a_jour_le (réutilise la fonction
-- générique si elle existe, sinon en crée une locale dédiée).
CREATE OR REPLACE FUNCTION trigger_creneaux_cabinet_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.mis_a_jour_le = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS creneaux_cabinet_mis_a_jour_le ON public.creneaux_cabinet;
CREATE TRIGGER creneaux_cabinet_mis_a_jour_le
  BEFORE UPDATE ON public.creneaux_cabinet
  FOR EACH ROW EXECUTE FUNCTION trigger_creneaux_cabinet_updated_at();

-- ───────────────────────────────────────────────────────────────
-- SÉCURITÉ — RLS (modèle F5-003 durci, identique à regles_cabinet)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.creneaux_cabinet ENABLE ROW LEVEL SECURITY;

-- 1. Isolation cabinet → RESTRICTIVE (combinée en AND, n'accorde aucun droit)
DROP POLICY IF EXISTS "creneaux_cabinet_isolation" ON public.creneaux_cabinet;
CREATE POLICY "creneaux_cabinet_isolation" ON public.creneaux_cabinet
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- 2. Écriture réservée à l'admin (PERMISSIVE) — le véto propose, l'admin ancre
DROP POLICY IF EXISTS "creneaux_cabinet_admin_write" ON public.creneaux_cabinet;
CREATE POLICY "creneaux_cabinet_admin_write" ON public.creneaux_cabinet
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 3. Lecture pour tout authentifié (PERMISSIVE) — la restrictive borne au cabinet
DROP POLICY IF EXISTS "creneaux_cabinet_read_auth" ON public.creneaux_cabinet;
CREATE POLICY "creneaux_cabinet_read_auth" ON public.creneaux_cabinet
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
