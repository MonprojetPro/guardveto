-- ============================================================
-- B-195 (10/11) — les deux règles des fêtes deviennent réglables par cabinet
-- ============================================================
-- MiKL : « garde la possibilité pour un cabinet de paramétrer que Noël et jour
-- de l'an ce ne doit pas être les mêmes vétos de garde, et pareil d'une année
-- sur l'autre, comme une règle paramétrable comme les autres ».
--
-- Ne seede que le CATALOGUE des briques (données de référence) : aucune ligne
-- `regles_cabinet` n'est créée. Sans ligne, le moteur applique le défaut :
--   • pas_meme_veto_noel_nouvel_an    → ÉTEINTE (rien ne change)
--   • eviter_meme_fete_annee_suivante → active, « évitée », poids 40
--     (exactement le comportement d'avant, qui était écrit en dur)
-- Aucune table, aucune policy, aucun droit modifié.
-- ============================================================

BEGIN;

INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('pas_meme_veto_noel_nouvel_an', 'interdire', 'PAS_LES_DEUX', jsonb_build_object(
    'description', 'B-195 — une même personne n''est pas de garde à Noël (24-25 déc.) ET au Nouvel An (31 déc.-1er janv.) de la même saison (réglage du cabinet, éteint par défaut, peut aller jusqu''à « jamais »)',
    'axes', jsonb_build_array('quand'),
    'params', jsonb_build_object(
      '_reglage', 'aucun paramètre — le réglage porte { actif, force }'))),

  ('eviter_meme_fete_annee_suivante', 'interdire', 'EVITER_FETE', jsonb_build_object(
    'description', 'B-195 — évite qu''une personne tienne la même fête de fin d''année que l''an dernier, lue dans les plannings publiés (préférence réglable, défaut : évitée ; jamais une interdiction)',
    'axes', jsonb_build_array('quand'),
    'params', jsonb_build_object(
      '_reglage', 'aucun paramètre — le réglage porte { actif, force }')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
