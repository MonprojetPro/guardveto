-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Backlog n°14 : équité inter-annuelle des fêtes (historique_fete)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-07
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Le doc métier (§6/§7 regles-metier-gardes.md) promet : « qui a fait Noël
--   l'an dernier ne le refait pas cette année ». Rien ne le portait : les
--   périodes sont indépendantes, aucune mémoire inter-annuelle des fêtes.
--
--   Cette table enregistre, à la PUBLICATION d'une période couvrant une fête,
--   QUI a tenu chaque fête (Noël = 24-25/12, Nouvel An = 31/12-01/01 — les
--   deux seules fêtes du doc métier, mêmes dates que estFeteFinAnnee).
--   Convention d'année : l'année du mois de DÉCEMBRE (le 01/01/2027 appartient
--   au Nouvel An 2026). Le moteur consomme l'historique en PÉNALITÉ SOUPLE
--   (étage 4, jamais une violation dure — le validateur indépendant l'ignore).
--
-- BYTE-IDENTIQUE : table VIDE ⇒ aucune pénalité ⇒ planning strictement
--   inchangé (garanti par construction, testé). Aucune donnée n'est seedée.
--
-- IDEMPOTENCE ÉCRITURE : l'alimentation (enregistrerHistoriqueFetes) purge
--   par (cabinet_id, fete, annee) puis insère — la contrainte UNIQUE ci-dessous
--   est le filet (un véto = une entrée par instance de fête).
--
-- SÉCURITÉ (modèle F5-003, leçon rls-isolation-doit-etre-restrictive) :
--   • isolation tenant AS RESTRICTIVE (borne TOUTES les policies permissives) ;
--   • écriture : admin (policy permissive) + service_role (bypass RLS natif) ;
--   • lecture : tout authentifié DU cabinet (l'admin voit l'historique sur
--     /compteurs ; la restrictive garantit le scope).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.historique_fete (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      uuid NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  veterinaire_id  uuid NOT NULL REFERENCES public.veterinaires(id) ON DELETE CASCADE,
  -- Codes alignés sur le moteur (src/engine/historique-fete.ts — CodeFete).
  fete            text NOT NULL CHECK (fete IN ('noel', 'nouvel_an')),
  -- Année de SAISON (année de décembre : 01/01/2027 → nouvel_an 2026).
  annee           smallint NOT NULL CHECK (annee BETWEEN 2020 AND 2200),
  -- Rôle tenu (ex. 'premier'/'second') — informatif, nullable.
  role            text NULL,
  -- Date de la garde V1 qui a couvert la fête (traçabilité).
  garde_date      date NULL,
  -- Période publiée à l'origine de l'entrée (traçabilité, jamais bloquant).
  periode_id      uuid NULL REFERENCES public.periodes(id) ON DELETE SET NULL,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  -- Un véto = UNE entrée par instance de fête (idempotence re-publication).
  CONSTRAINT historique_fete_unique UNIQUE (cabinet_id, veterinaire_id, fete, annee)
);

COMMENT ON TABLE public.historique_fete IS
  'Qui a tenu chaque fête de fin d''année (Noël / Nouvel An) — alimentée à la publication, consommée par le moteur en pénalité souple (équité inter-annuelle, backlog n°14)';
COMMENT ON COLUMN public.historique_fete.annee IS
  'Année de saison = année de décembre (le 01/01/2027 appartient au Nouvel An 2026)';
COMMENT ON COLUMN public.historique_fete.fete IS
  'Code fête aligné moteur : noel (24-25/12) ou nouvel_an (31/12-01/01)';

-- Lecture moteur : toujours (cabinet, annees[]) — index dédié.
CREATE INDEX IF NOT EXISTS idx_historique_fete_cab_annee
  ON public.historique_fete (cabinet_id, annee);

-- ── 2. RLS (modèle F5-003 durci) ────────────────────────────
ALTER TABLE public.historique_fete ENABLE ROW LEVEL SECURITY;

-- Isolation tenant RESTRICTIVE : borne toutes les policies permissives
-- (une permissive FOR ALL seule accorderait l'écriture inter-cabinet —
-- leçon rls-isolation-doit-etre-restrictive).
DROP POLICY IF EXISTS "historique_fete_isolation" ON public.historique_fete;
CREATE POLICY "historique_fete_isolation" ON public.historique_fete
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- Écriture : admin uniquement (le service_role bypasse la RLS nativement).
DROP POLICY IF EXISTS "historique_fete_admin_write" ON public.historique_fete;
CREATE POLICY "historique_fete_admin_write" ON public.historique_fete
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Lecture : tout authentifié (bornée au cabinet par la restrictive).
DROP POLICY IF EXISTS "historique_fete_read_auth" ON public.historique_fete;
CREATE POLICY "historique_fete_read_auth" ON public.historique_fete
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
