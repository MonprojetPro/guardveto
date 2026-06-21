-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Gestion de crise (LOT 1) : absences + compensations
-- Auteur : MAX (MPP) + ruflo — MonProjetPro
-- Date   : 2026-06-21
-- ───────────────────────────────────────────────────────────────
-- ⚠️ MIGRATION DE SÉCURITÉ (multi-tenant) — NE PAS APPLIQUER SANS
--    AUDIT CERBÈRE. Crée 2 tables + leur RLS strict.
--
-- CONTEXTE MÉTIER
--   • absences      : indisponibilité IMPRÉVUE déclarée APRÈS la
--                     publication d'un planning (≠ `conges`, qui
--                     influence la génération en amont).
--   • compensations : trace légère de « qui a dépanné qui » sur une
--                     garde donnée, en réponse à une absence.
--
-- MODÈLE RLS (copié À L'IDENTIQUE de f5_003 — 20260618120000)
--   Pour CHAQUE table :
--     1. Isolation cabinet RESTRICTIVE FOR ALL (borne au cabinet,
--        n'accorde AUCUN droit) — fonction helper : auth_cabinet_actif().
--        ⚠️ Leçon douloureuse du projet : une isolation PERMISSIVE
--        FOR ALL accorderait INSERT/UPDATE/DELETE à tout véto authentifié
--        du cabinet (escalade). L'isolation DOIT être RESTRICTIVE.
--     2. Écriture réservée à l'admin PERMISSIVE FOR ALL — fonction
--        helper : get_user_role() = 'admin'.
--     3. Lecture PERMISSIVE FOR SELECT pour tout authentifié (la
--        restrictive borne au cabinet).
--
--   Effet net (exemple absences) :
--     INSERT véto  : aucune permissive INSERT n'accorde (admin_write
--                    WITH CHECK = FALSE) → REFUSÉ ✅
--     INSERT admin : admin_write (TRUE) AND restrictive (cabinet match)
--                    → AUTORISÉ ✅
--     SELECT véto  : read_auth (TRUE) AND restrictive (cabinet match)
--                    → lit SON cabinet uniquement ✅
--     Cross-tenant : restrictive = FALSE → REFUSÉ quel que soit le rôle ✅
--
-- HELPERS RÉUTILISÉS (existants, non redéfinis ici)
--   • public.auth_cabinet_actif()  (20260616140001) → UUID cabinet du JWT
--   • public.get_user_role()       (003_rls.sql)    → rôle_app du connecté
--
-- IDEMPOTENCE : CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--   DROP POLICY IF EXISTS avant chaque CREATE POLICY. Transaction atomique.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE : absences  (indisponibilité imprévue post-publication)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.absences (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      UUID        NOT NULL REFERENCES public.cabinets(id),
  veterinaire_id  UUID        NOT NULL REFERENCES public.veterinaires(id),
  date_debut      DATE        NOT NULL,
  date_fin        DATE        NOT NULL,
  motif           TEXT        NOT NULL CHECK (motif IN ('maladie', 'urgence', 'autre')),
  commentaire     TEXT,
  statut          TEXT        NOT NULL DEFAULT 'active'
                                CHECK (statut IN ('active', 'resolue', 'annulee')),
  declaree_par    UUID        REFERENCES public.veterinaires(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT absences_dates_coherentes CHECK (date_fin >= date_debut)
);

COMMENT ON TABLE  public.absences               IS 'Indisponibilités imprévues déclarées après publication du planning (≠ conges).';
COMMENT ON COLUMN public.absences.statut        IS 'active = à traiter, resolue = compensée, annulee = annulée.';
COMMENT ON COLUMN public.absences.declaree_par  IS 'Vétérinaire (admin) ayant déclaré l''absence.';

CREATE INDEX IF NOT EXISTS idx_absences_cabinet_id ON public.absences(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_absences_veto_dates ON public.absences(veterinaire_id, date_debut, date_fin);

-- ───────────────────────────────────────────────────────────────
-- TABLE : compensations  (trace « qui a dépanné qui » sur une garde)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.compensations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      UUID        NOT NULL REFERENCES public.cabinets(id),
  absence_id      UUID        NOT NULL REFERENCES public.absences(id) ON DELETE CASCADE,
  garde_id        UUID        NOT NULL REFERENCES public.gardes(id) ON DELETE CASCADE,
  remplacant_id   UUID        NOT NULL REFERENCES public.veterinaires(id),
  remplace_id     UUID        NOT NULL REFERENCES public.veterinaires(id),
  role            TEXT        CHECK (role IN ('premier', 'second')),
  statut          TEXT        NOT NULL DEFAULT 'a_compenser'
                                CHECK (statut IN ('a_compenser', 'compensee', 'annulee')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.compensations             IS 'Trace légère du dépannage : qui a remplacé qui sur une garde, suite à une absence.';
COMMENT ON COLUMN public.compensations.role        IS 'Rôle remplacé sur la garde : premier ou second.';
COMMENT ON COLUMN public.compensations.statut      IS 'a_compenser = dette ouverte, compensee = soldée, annulee = annulée.';

CREATE INDEX IF NOT EXISTS idx_compensations_cabinet_id ON public.compensations(cabinet_id);
CREATE INDEX IF NOT EXISTS idx_compensations_absence_id ON public.compensations(absence_id);

-- ───────────────────────────────────────────────────────────────
-- RLS — TABLE : absences  (modèle f5_003 : isolation RESTRICTIVE
--   + écriture admin PERMISSIVE + lecture authentifiée)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.absences ENABLE ROW LEVEL SECURITY;

-- 1. Isolation cabinet → RESTRICTIVE (combinée en AND, n'accorde aucun droit)
DROP POLICY IF EXISTS "absences_cabinet_isolation" ON public.absences;
CREATE POLICY "absences_cabinet_isolation" ON public.absences
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- 2. Écriture réservée à l'admin (PERMISSIVE)
DROP POLICY IF EXISTS "absences_admin_write" ON public.absences;
CREATE POLICY "absences_admin_write" ON public.absences
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 3. Lecture pour tout authentifié (PERMISSIVE) — la restrictive borne au cabinet
DROP POLICY IF EXISTS "absences_read_auth" ON public.absences;
CREATE POLICY "absences_read_auth" ON public.absences
  FOR SELECT TO authenticated
  USING (true);

-- ───────────────────────────────────────────────────────────────
-- RLS — TABLE : compensations  (même modèle f5_003)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.compensations ENABLE ROW LEVEL SECURITY;

-- 1. Isolation cabinet → RESTRICTIVE
DROP POLICY IF EXISTS "compensations_cabinet_isolation" ON public.compensations;
CREATE POLICY "compensations_cabinet_isolation" ON public.compensations
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- 2. Écriture réservée à l'admin (PERMISSIVE)
DROP POLICY IF EXISTS "compensations_admin_write" ON public.compensations;
CREATE POLICY "compensations_admin_write" ON public.compensations
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 3. Lecture pour tout authentifié (PERMISSIVE) — la restrictive borne au cabinet
DROP POLICY IF EXISTS "compensations_read_auth" ON public.compensations;
CREATE POLICY "compensations_read_auth" ON public.compensations
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
