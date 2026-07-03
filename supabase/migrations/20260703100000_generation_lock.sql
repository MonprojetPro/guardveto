-- ============================================================
-- Verrou de génération (audit 2026-07-03, trou « concurrence »)
-- ============================================================
-- Empêche deux générations simultanées sur la même période
-- (double-clic, admin PC + admin mobile) qui produisaient un
-- planning « mélange » de deux solutions du solver.
--
-- Acquisition par compare-and-swap côté /api/generate :
--   UPDATE ... SET generation_lock_at = now()
--   WHERE id = :periode AND (lock NULL OU lock périmé)
-- Verrou périmé après 3 minutes (maxDuration serverless = 60 s)
-- pour ne jamais bloquer une période définitivement.
-- Colonne simple, aucune policy RLS modifiée (couvert par les
-- policies periodes existantes : write admin-only + isolation).

ALTER TABLE public.periodes
  ADD COLUMN IF NOT EXISTS generation_lock_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.periodes.generation_lock_at IS
  'Verrou de génération : horodatage d''acquisition (NULL = libre). Considéré périmé après 3 minutes.';
