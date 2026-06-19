-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — P1A-002 : Table regles_cabinet (la donnée) + RLS strict
-- Auteur : MAX (MPP) + ruflo — MonProjetPro
-- Date   : 2026-06-19
-- Lot    : Palier 1 — A (règles configurables) — story 2/7
-- Source : archi v2 §4.3/§4.5/§7 + docs/v2/08-stories-palier1-a.md
-- ───────────────────────────────────────────────────────────────
-- ⚠️ MIGRATION DE SÉCURITÉ — gate TILT (auth/RLS). NE PAS APPLIQUER
--   SANS RELECTURE.
--
-- OBJET
--   `regles_cabinet` porte les règles CONFIGURÉES par chaque cabinet
--   (la DONNÉE ; le code de l'évaluateur reste en TS — cf. briques_regles).
--   Chaque ligne = { brique_id, params_json (QUI/QUOI/QUAND), force,
--   validite_json } pour un cabinet (+ période optionnelle).
--
-- SÉCURITÉ — modèle F5-003 (PAS l'exemple PERMISSIVE de l'archi §7)
--   L'archi §7 montre une policy `tenant_isolation FOR ALL` PERMISSIVE :
--   c'est EXACTEMENT le pattern qui a causé l'escalade véto corrigée par
--   F5-003. On applique le modèle durci à 3 policies :
--     1. isolation cabinet → RESTRICTIVE (borne au cabinet, n'accorde rien)
--     2. écriture (INSERT/UPDATE/DELETE) → PERMISSIVE réservée à l'ADMIN
--        (gouvernance PRD §5 : le véto PROPOSE, l'admin ANCRE)
--     3. lecture → PERMISSIVE pour tout authentifié du cabinet
--   Effet net :
--     INSERT véto  : aucune permissive write n'accorde → REFUSÉ ✅
--     INSERT admin : admin_write (TRUE) AND restrictive (cabinet) → OK ✅
--     SELECT véto  : read_auth (TRUE) AND restrictive (cabinet) → son cab ✅
--     Cross-tenant : restrictive = FALSE → REFUSÉ quel que soit le rôle ✅
--
-- IDEMPOTENCE : CREATE TABLE IF NOT EXISTS ; DROP POLICY IF EXISTS avant
--   CREATE. Transaction atomique. Dépend de briques_regles (P1A-001).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.regles_cabinet (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    UUID NOT NULL REFERENCES public.cabinets(id),
  periode_id    UUID REFERENCES public.periodes(id),       -- NULL = permanente
  brique_id     TEXT NOT NULL REFERENCES public.briques_regles(id),
  params_json   JSONB NOT NULL,                            -- QUI/QUOI/QUAND (ParamsRegle)
  force         TEXT NOT NULL CHECK (force IN
                  ('invariant','reglementaire','jamais','sauf_crise','evitee','si_possible')),
  validite_json JSONB NOT NULL DEFAULT '{"type":"permanente","version":1}'::jsonb,
  version       INTEGER NOT NULL DEFAULT 1,                -- incrémentale, jamais rétro-appliquée
  actif         BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES public.veterinaires(id),   -- table réelle V1 (pas veterinaires_cabinet)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index incluant cabinet_id (P4 : tenant dans chaque accès).
CREATE INDEX IF NOT EXISTS idx_regles_cabinet_cab        ON public.regles_cabinet (cabinet_id, actif);
CREATE INDEX IF NOT EXISTS idx_regles_cabinet_cab_periode ON public.regles_cabinet (cabinet_id, periode_id);

COMMENT ON TABLE public.regles_cabinet IS
  'Règles configurées par cabinet (la donnée). brique_id → catalogue de code. RLS durcie (modèle F5-003) : écriture admin-only, isolation RESTRICTIVE.';

-- ───────────────────────────────────────────────────────────────
-- SÉCURITÉ — RLS (modèle F5-003 durci)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.regles_cabinet ENABLE ROW LEVEL SECURITY;

-- 1. Isolation cabinet → RESTRICTIVE (combinée en AND, n'accorde aucun droit)
DROP POLICY IF EXISTS "regles_cabinet_isolation" ON public.regles_cabinet;
CREATE POLICY "regles_cabinet_isolation" ON public.regles_cabinet
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- 2. Écriture réservée à l'admin (PERMISSIVE) — le véto propose, l'admin ancre
DROP POLICY IF EXISTS "regles_cabinet_admin_write" ON public.regles_cabinet;
CREATE POLICY "regles_cabinet_admin_write" ON public.regles_cabinet
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 3. Lecture pour tout authentifié (PERMISSIVE) — la restrictive borne au cabinet
DROP POLICY IF EXISTS "regles_cabinet_read_auth" ON public.regles_cabinet;
CREATE POLICY "regles_cabinet_read_auth" ON public.regles_cabinet
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
