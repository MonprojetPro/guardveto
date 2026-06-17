-- ============================================================
-- GUARDVETO — Migration 20260616170001 : Migrer les contraintes V1 → format brique V2
-- Story : F4-002 — Migrer les contraintes existantes au format normalisé
-- Auteur : ruflo — MonProjetPro
-- Date   : 2026-06-16
-- ============================================================
--
-- Convertit chaque ligne de contraintes_veto dont brique_type = 'legacy'
-- vers la grammaire 6-axes V2 (archi §4.4), selon le type de contrainte V1.
--
-- Mapping V1 → V2 :
--   'indisponibilite_cyclique' → brique 'alternance_ancre'  (R2, force 3)
--   'jour_repos_fixe'          → brique 'interdire_creneau' (R1, force 4)
--   'jour_repos_conditionnel'  → brique 'repos_conditionnel'(R3/R5, force 3)
--   'duo_interdit'             → brique 'duo_interdit'       (R6, force 2)
--
-- Idempotence : la clause WHERE brique_type = 'legacy' garantit que
-- relancer la migration ne touche pas les lignes déjà migrées.
--
-- NE PAS APPLIQUER sans avoir exécuté F4-001 (migration 20260616160001).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. indisponibilite_cyclique → brique 'alternance_ancre' (R2)
-- ────────────────────────────────────────────────────────────
-- Exemple config V1 : { "semaines": "impaires", "periodes": ["soir", "weekend"] }
-- L'axe 'quand' reprend le type_creneau principal (premier élément de 'periodes',
-- ou le champ 'type_creneau' s'il existe). Les paramètres V1 entiers sont conservés
-- dans 'params' pour traçabilité et usage futur.

UPDATE public.contraintes_veto
SET
  config = jsonb_build_object(
    'brique',  'alternance_ancre',
    'axes',    jsonb_build_object(
                 'quand', COALESCE(
                   config->>'type_creneau',
                   (config->'periodes'->>0)
                 )
               ),
    'force',   3,
    'params',  config
  ),
  brique_type = 'v2'
WHERE type        = 'indisponibilite_cyclique'
  AND brique_type = 'legacy';

-- ────────────────────────────────────────────────────────────
-- 2. jour_repos_fixe → brique 'interdire_creneau' (R1)
-- ────────────────────────────────────────────────────────────
-- Exemple config V1 : { "jour": "mercredi", "exception_vacances_scolaires": true }
-- L'axe 'quand' reprend le jour fixe.

UPDATE public.contraintes_veto
SET
  config = jsonb_build_object(
    'brique',  'interdire_creneau',
    'axes',    jsonb_build_object(
                 'quand', config->>'jour'
               ),
    'force',   4,
    'params',  config
  ),
  brique_type = 'v2'
WHERE type        = 'jour_repos_fixe'
  AND brique_type = 'legacy';

-- ────────────────────────────────────────────────────────────
-- 3. jour_repos_conditionnel → brique 'repos_conditionnel' (R3/R5)
-- ────────────────────────────────────────────────────────────
-- Exemple config V1 : { "si_garde_we": "jeudi", "sinon": "vendredi" }
-- Les axes sont vides (la logique conditionnelle vit dans params).

UPDATE public.contraintes_veto
SET
  config = jsonb_build_object(
    'brique',  'repos_conditionnel',
    'axes',    jsonb_build_object(),
    'force',   3,
    'params',  config
  ),
  brique_type = 'v2'
WHERE type        = 'jour_repos_conditionnel'
  AND brique_type = 'legacy';

-- ────────────────────────────────────────────────────────────
-- 4. duo_interdit → brique 'duo_interdit' (R6)
-- ────────────────────────────────────────────────────────────
-- Exemple config V1 : { "avec_veterinaire_id": "uuid..." }
-- Les axes sont vides (les deux vétérinaires sont dans params).

UPDATE public.contraintes_veto
SET
  config = jsonb_build_object(
    'brique',  'duo_interdit',
    'axes',    jsonb_build_object(),
    'force',   2,
    'params',  config
  ),
  brique_type = 'v2'
WHERE type        = 'duo_interdit'
  AND brique_type = 'legacy';

-- ────────────────────────────────────────────────────────────
-- 5. Types non mappés : rester en 'legacy' (pas de plantage)
-- ────────────────────────────────────────────────────────────
-- Aucune action — les types inconnus conservent brique_type = 'legacy'.
-- Ils seront traités manuellement ou dans une migration ultérieure.

-- ────────────────────────────────────────────────────────────
-- 6. Vérification post-migration : alerte si des lignes legacy subsistent
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE v_legacy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_legacy_count
  FROM public.contraintes_veto
  WHERE brique_type = 'legacy';

  IF v_legacy_count > 0 THEN
    RAISE WARNING
      'Attention : % contrainte(s) encore en brique_type=legacy (types non mappés)',
      v_legacy_count;
  END IF;
END $$;
