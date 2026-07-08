-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Vague 5 tranche B : successions / repos avancés (#13)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-08
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Ajoute au catalogue `briques_regles` les patterns standard du nurse
--   rostering, en briques PAR-VÉTO configurables (famille `sequence`) :
--     • succession_interdite — « pas de garde de type B le lendemain d'une
--       garde de type A ». params: { type_avant, type_apres }.
--       Sémantique JOUR CIVIL (le weekend, daté du samedi, se termine le
--       dimanche → son « lendemain » est le lundi).
--     • serie_max — « jamais plus de N jours de garde d'affilée ».
--       params: { n_jours, creneaux? } (creneaux absent = tous les types).
--     • repos_apres_serie — « après N jours de garde d'affilée, imposer M
--       jours sans garde ». params: { n_jours, repos_jours }.
--
--   NB : « repos minimum consécutif » (au moins N jours entre deux gardes)
--   est DÉJÀ couvert par la brique `espacement_min` (écart N+1) — pas de
--   doublon créé ici.
--
--   Indispensable AVANT de créer la moindre règle de ce type : la FK
--   regles_cabinet.brique_id → briques_regles.id rejetterait sinon
--   l'insertion (anti-coquille-vide au niveau base).
--
--   L'évaluateur reste en TypeScript (hard-constraints.ts + validateur
--   indépendant validerPlanning.ts). Ce seed n'est qu'un MIROIR LECTURE
--   du schéma (cf. note P1A-001).
--
-- SÉCURITÉ : table de référence, RLS lecture seule. Écriture via migration
--   uniquement (C3). Aucune policy modifiée.
-- IDEMPOTENCE : INSERT … ON CONFLICT (id) DO UPDATE (rejouable).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('succession_interdite', 'sequence', 'SUCCESSION_INTERDITE', jsonb_build_object(
    'description', 'Pas de garde de type B le lendemain d''une garde de type A (jour civil ; le lendemain d''un week-end est le lundi)',
    'axes', jsonb_build_array('qui','quoi'),
    'params', jsonb_build_object(
      'type_avant', 'string (code du créneau « veille »)',
      'type_apres', 'string (code du créneau interdit le lendemain)'))),

  ('serie_max', 'sequence', 'SERIE_MAX', jsonb_build_object(
    'description', 'Jamais plus de N jours de garde d''affilée (stretch borné)',
    'axes', jsonb_build_array('qui','combien'),
    'params', jsonb_build_object(
      'n_jours', 'integer (nombre max de jours de garde consécutifs)',
      'creneaux', 'string[]? (ne compter que ces types — absent = tous)'))),

  ('repos_apres_serie', 'sequence', 'REPOS_APRES_SERIE', jsonb_build_object(
    'description', 'Après N jours de garde d''affilée, imposer M jours sans garde',
    'axes', jsonb_build_array('qui','combien'),
    'params', jsonb_build_object(
      'n_jours', 'integer (longueur de série déclenchant le repos)',
      'repos_jours', 'integer (jours sans garde imposés après la série)')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
