-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Backlog n°21 (Vague 6 tranche A) : COHORTES D'ÉQUITÉ
--             paramétrables par étiquette (tag)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-08
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Rafraîchir le `schema_json` (miroir descriptif) de la brique
--   `equilibrer` DÉJÀ présente au catalogue, pour documenter le
--   nouveau paramètre OPTIONNEL `tag` :
--     params: { dimension, importance, tag? }
--       • tag ABSENT  → équilibrage GLOBAL des 6 dimensions (historique,
--                       byte-identique — aucun changement de comportement).
--       • tag PRÉSENT → COHORTE : la variance de la dimension n'est calculée
--                       QUE sur les vétos portant l'étiquette (normalisée
--                       trim().toLowerCase()). Chaque (dimension, tag) = une
--                       entrée de score indépendante qui S'AJOUTE aux 6
--                       dimensions globales (pas de remplacement implicite).
--
--   La SOURCE DE VÉRITÉ du schéma reste le TypeScript (catalogue.ts) ; ce
--   `schema_json` en base n'est qu'un miroir descriptif (cf. mapReglesCabinet.ts).
--
--   AUCUNE ligne `regles_cabinet` créée ici : pas de cohorte posée = rien
--   ne change. Les cohortes sont créées via l'écran Règles (setCohorteEquite)
--   ou proposées par l'assistant IA (equilibrer + tag).
--
-- SÉCURITÉ : briques_regles = référence lecture seule (C3), aucune policy
--   modifiée. Les tags vivent déjà sur veterinaires.tags (migration
--   20260707150000) — pas de nouvelle colonne.
-- IDEMPOTENCE : INSERT … ON CONFLICT (id) DO UPDATE.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('equilibrer', 'equilibrer', 'EQUILIBRER', jsonb_build_object(
    'description', 'Répartit équitablement une dimension de charge. Sans tag = équilibrage GLOBAL (tous les vétos). Avec tag = COHORTE : équilibrage UNIQUEMENT entre les vétos portant l''étiquette (backlog n°21) ; s''ajoute à l''équilibrage global.',
    'axes', jsonb_build_array('qui','quoi'),
    'params', jsonb_build_object(
      'dimension', 'string (weekend|weekend_premier|ferie|semaine_premier|semaine_second|grands_weekend)',
      'importance', 'string (peu_important|normal|important|essentiel)',
      'tag', 'string? (cohorte n°21 — absent = équilibrage global ; présent = équilibré uniquement entre les vétos portant cette étiquette)')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
