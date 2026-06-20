-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Équité configurable : poids (curseurs) par cabinet
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-06-20
-- Lot    : Règles structurelles configurables — Vague 2 (équité réglable)
-- ───────────────────────────────────────────────────────────────
-- ⚠️ MIGRATION DE SÉCURITÉ — touche la RLS (modèle F5-003). NE PAS
--    APPLIQUER SANS RELECTURE (gate TILT auth/RLS).
--
-- OBJET
--   `equite_cabinet` porte les 6 POIDS d'équité réglés par chaque cabinet
--   (les curseurs). Une ligne par cabinet. Le code de scoring reste en TS
--   (DEFAULT_EQUITY_WEIGHTS = repli) ; ici on ne stocke que la DONNÉE réglée.
--   Sert le principe « toutes les règles réglables » (équité incluse).
--
-- SÛRETÉ
--   • Table OPTIONNELLE : le loader la lit en best-effort. Pas de ligne pour
--     un cabinet → le solver retombe sur DEFAULT_EQUITY_WEIGHTS (planning
--     historique inchangé). Aucune contrainte d'ordre de déploiement : le code
--     fonctionne AVANT (table absente → undefined) ET APRÈS cette migration.
--   • DEFAULT sur chaque colonne = valeurs historiques (WE 100, WE_1er 25,
--     fériés 60, semaine_1er 30, semaine_2nd 10, grands_WE 60). Une ligne
--     créée sans préciser tous les poids reste donc au comportement par défaut.
--   • CHECK (>= 0) : un poids négatif n'a pas de sens (inverserait la priorité).
--
-- SÉCURITÉ — RLS modèle F5-003 durci (identique à regles_cabinet)
--   1. isolation cabinet → RESTRICTIVE (borne au cabinet, n'accorde rien)
--   2. écriture (INSERT/UPDATE/DELETE) → PERMISSIVE réservée à l'ADMIN
--   3. lecture → PERMISSIVE pour tout authentifié (la restrictive borne au cab)
--   Effet : un véto LIT les poids de son cabinet mais ne peut pas les MODIFIER ;
--   seul l'admin ancre ; aucun accès cross-tenant quel que soit le rôle.
--
-- IDEMPOTENCE : CREATE TABLE IF NOT EXISTS ; DROP POLICY IF EXISTS avant CREATE.
--   Transaction atomique. Dépend de cabinets (F5-001) + helpers
--   auth_cabinet_actif() / get_user_role() (déjà en place — regles_cabinet).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.equite_cabinet (
  cabinet_id      UUID PRIMARY KEY REFERENCES public.cabinets(id) ON DELETE CASCADE,
  -- Les 6 poids d'équité (cf. EquityWeights / DEFAULT_EQUITY_WEIGHTS en TS).
  we_garde        NUMERIC NOT NULL DEFAULT 100 CHECK (we_garde        >= 0), -- R11
  we_premier_role NUMERIC NOT NULL DEFAULT 25  CHECK (we_premier_role >= 0), -- R11b
  feries          NUMERIC NOT NULL DEFAULT 60  CHECK (feries          >= 0), -- R12
  semaine_premier NUMERIC NOT NULL DEFAULT 30  CHECK (semaine_premier >= 0), -- R13
  semaine_second  NUMERIC NOT NULL DEFAULT 10  CHECK (semaine_second  >= 0), -- R14
  grands_we       NUMERIC NOT NULL DEFAULT 60  CHECK (grands_we       >= 0), -- R15
  updated_by      UUID REFERENCES public.veterinaires(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.equite_cabinet IS
  'Poids d''équité (curseurs) réglés par cabinet. 1 ligne/cabinet. Repli code = DEFAULT_EQUITY_WEIGHTS. RLS durcie F5-003 : écriture admin-only, isolation RESTRICTIVE.';
COMMENT ON COLUMN public.equite_cabinet.we_garde        IS 'R11 — importance de l''égalité du nombre de week-ends de garde (défaut 100).';
COMMENT ON COLUMN public.equite_cabinet.we_premier_role IS 'R11b — égalité du rôle 1er le week-end / avantage financier (défaut 25).';
COMMENT ON COLUMN public.equite_cabinet.feries          IS 'R12 — égalité des gardes de jours fériés (défaut 60).';
COMMENT ON COLUMN public.equite_cabinet.semaine_premier IS 'R13 — égalité des soirs de semaine en 1er (défaut 30).';
COMMENT ON COLUMN public.equite_cabinet.semaine_second  IS 'R14 — égalité des soirs de semaine en 2nd (défaut 10).';
COMMENT ON COLUMN public.equite_cabinet.grands_we       IS 'R15 — égalité des grands week-ends perdus par les salariés (défaut 60).';

-- ───────────────────────────────────────────────────────────────
-- SÉCURITÉ — RLS (modèle F5-003 durci, identique à regles_cabinet)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.equite_cabinet ENABLE ROW LEVEL SECURITY;

-- 1. Isolation cabinet → RESTRICTIVE (combinée en AND, n'accorde aucun droit)
DROP POLICY IF EXISTS "equite_cabinet_isolation" ON public.equite_cabinet;
CREATE POLICY "equite_cabinet_isolation" ON public.equite_cabinet
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- 2. Écriture réservée à l'admin (PERMISSIVE) — le véto consulte, l'admin règle
DROP POLICY IF EXISTS "equite_cabinet_admin_write" ON public.equite_cabinet;
CREATE POLICY "equite_cabinet_admin_write" ON public.equite_cabinet
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 3. Lecture pour tout authentifié (PERMISSIVE) — la restrictive borne au cabinet
DROP POLICY IF EXISTS "equite_cabinet_read_auth" ON public.equite_cabinet;
CREATE POLICY "equite_cabinet_read_auth" ON public.equite_cabinet
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
