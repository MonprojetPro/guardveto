-- ============================================================
-- GUARDVETO — attributions.planning_id : FK vers periodes (P6 verrou n°7, ét. 3)
-- Auteur : Claude — MonProjetPro
-- Date   : 2026-07-07
-- ⚠️ ÉCRITE, PAS APPLIQUÉE — à relire avant application (règle MiKL).
-- ============================================================
-- CONTEXTE
--   `attributions` (V2) devient la future table de vérité du planning
--   (cutover verrou n°7, étape 4). Or `planning_id` est un UUID nu, sans FK
--   (F1-001 la prévoyait « lors de F6-002 », jamais faite) :
--     • supprimer une période laisse ses lignes V2 ORPHELINES à jamais ;
--     • rien n'empêche d'insérer une attribution vers une période inexistante.
--   Le code applicatif purge désormais la V2 à la suppression d'une période
--   (supprimerPeriode), mais une contrainte en base reste la seule garantie
--   contre les chemins non applicatifs (SQL manuel, incidents passés).
--
-- CE QUE FAIT CETTE MIGRATION
--   1. Purge les lignes orphelines EXISTANTES (périodes déjà supprimées) —
--      sinon la création de la FK échouerait.
--   2. Ajoute la FK `attributions.planning_id → periodes(id)` ON DELETE CASCADE
--      (aligné sur gardes.periode_id : la V2 suit le cycle de vie de la période).
--
-- IDEMPOTENCE : garde sur l'existence de la contrainte. Transaction atomique.
-- RLS : inchangée (attributions_admin_write / F5-003 suffisent — l'écriture
--   admin + service_role couvre tous les chemins de synchro V2).
-- ============================================================

BEGIN;

-- 1. Orphelins : attributions dont la période n'existe plus.
DELETE FROM public.attributions a
WHERE NOT EXISTS (
  SELECT 1 FROM public.periodes p WHERE p.id = a.planning_id
);

-- 2. FK (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attributions_planning_id_fkey'
      AND conrelid = 'public.attributions'::regclass
  ) THEN
    ALTER TABLE public.attributions
      ADD CONSTRAINT attributions_planning_id_fkey
      FOREIGN KEY (planning_id) REFERENCES public.periodes(id)
      ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN public.attributions.planning_id IS
  'FK vers periodes (ON DELETE CASCADE) — la V2 suit le cycle de vie de sa période.';

COMMIT;
