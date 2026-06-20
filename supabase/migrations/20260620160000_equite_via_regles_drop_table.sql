-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Équité unifiée dans les règles : retrait table dédiée
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-06-20
-- Lot    : Règles structurelles configurables — Vague 2bis (unification)
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   L'équité devient une FAMILLE DE RÈGLE (`equilibrer`) gérée comme les
--   autres dans `regles_cabinet`, au lieu d'une table de curseurs séparée.
--   Cette migration :
--     1. met à jour le schéma descriptif de la brique `equilibrer`
--        (dimension + importance, au lieu de mesure/quote_part) ;
--     2. SUPPRIME la table `equite_cabinet` (remplacée par les règles
--        `equilibrer` — cf. migration 20260620150000, désormais obsolète).
--
-- SÛRETÉ
--   • Le code lit déjà l'équité depuis les règles `equilibrer` (loader →
--     extraireEquityRules → buildEquityWeights), avec repli sur les défauts
--     historiques si aucune règle. Supprimer `equite_cabinet` est donc sans
--     impact (plus aucun code ne la lit).
--   • DROP TABLE IF EXISTS : idempotent, ne casse rien si déjà absente.
--
-- IDEMPOTENCE : ON CONFLICT DO UPDATE (seed brique) ; DROP IF EXISTS.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Schéma descriptif de la brique `equilibrer` (miroir du catalogue de code).
--    dimension = quel compteur ; importance = cran nommé (→ poids côté moteur).
INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES
  ('equilibrer', 'equilibrer', 'EQUILIBRER', jsonb_build_object(
    'description', 'Répartit équitablement un COMPTEUR (week-ends, fériés, soirs…) entre les vétos, avec une importance réglable',
    'axes', jsonb_build_array('qui', 'quoi'),
    'params', jsonb_build_object(
      'dimension', 'string (weekend|weekend_premier|ferie|semaine_premier|semaine_second|grands_weekend)',
      'importance', 'string (peu_important|normal|important|essentiel)')))
ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

-- 2. Retrait de la table de curseurs (remplacée par les règles `equilibrer`).
DROP TABLE IF EXISTS public.equite_cabinet;

COMMIT;
