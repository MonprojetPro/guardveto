-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Backlog n°7 : desiderata (préférences POSITIVES)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-07
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Trois briques PAR-VÉTO au catalogue — tout l'existant est en
--   interdiction/limite, celles-ci sont l'inverse :
--     • preferer_creneau — « préfère le mardi », « préfère les week-ends »
--       params: { jours?: string[], creneaux?: string[] }
--     • preferer_avec — « préfère être de garde avec X » (non symétrique)
--       params: { avec_veterinaire_id }
--     • volume_gardes — « veut PLUS (ou MOINS) de gardes »
--       params: { sens: 'plus'|'moins' }
--   ⚠️ TOUJOURS SOUPLES (aucun gardien dur) : l'action serveur refuse la
--   force « jamais », et l'évaluation clampe tout étage < 3 (défense en
--   profondeur). Une préférence ne bloque JAMAIS une génération.
--   AUCUNE ligne regles_cabinet créée ici : pas de règle = rien ne change.
--
-- SÉCURITÉ : briques_regles = référence lecture seule (C3).
-- IDEMPOTENCE : INSERT … ON CONFLICT (id) DO UPDATE.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('preferer_creneau', 'forcer', 'PREFERER', jsonb_build_object(
    'description', 'Préférence positive de jours et/ou de créneaux (ex. préfère le mardi, préfère les week-ends) — toujours souple',
    'axes', jsonb_build_array('qui','quoi','quand'),
    'params', jsonb_build_object(
      'jours', 'string[]? (lundi..dimanche — jours préférés)',
      'creneaux', 'string[]? (codes de créneaux préférés)'))),

  ('preferer_avec', 'forcer', 'PREFERER_AVEC', jsonb_build_object(
    'description', 'Préfère être de garde avec un co-équipier donné (non symétrique) — toujours souple',
    'axes', jsonb_build_array('qui'),
    'params', jsonb_build_object(
      'avec_veterinaire_id', 'string (id du co-équipier préféré)'))),

  ('volume_gardes', 'equilibrer', 'VOLUME', jsonb_build_object(
    'description', 'Souhaite faire plus ou moins de gardes que la moyenne (biais assumé sur l''équité) — toujours souple',
    'axes', jsonb_build_array('qui','combien'),
    'params', jsonb_build_object(
      'sens', 'string (plus|moins)')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
