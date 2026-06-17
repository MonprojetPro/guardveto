-- ============================================================
-- GUARDVETO — Fix : ré-application de l'inversion R8 (vendredi ↔ week-end)
--                    dans la vue planning_semaine
-- Auteur : ruflo — MonProjetPro
-- Date   : 2026-06-17
-- ------------------------------------------------------------
-- RÉGRESSION corrigée (ré-apparue) :
--   La règle dure R8 — « celui qui est 1er le vendredi soir devient
--   2nd le week-end, et inversement » — est bien calculée par le
--   moteur (src/engine/rules/hard-constraints.ts → checkR8Inversion),
--   mais la vue `planning_semaine` recopiait la paire du week-end
--   À L'IDENTIQUE sur la ligne dérivée du vendredi → l'inversion
--   n'apparaissait jamais à l'écran (ven = sam = dim).
--
--   Ce correctif avait été posé le 2026-06-06 (migration 014), mais a
--   été PERDU lorsque la base a été rebâtie depuis
--   `migration-complete-client.sql` (qui contient la définition
--   d'origine, sans permutation — cf. branche « vendredi » de la vue,
--   héritée de 002_views.sql).
--
-- CONTEXTE STOCKAGE :
--   Les gardes sont persistées dans la table V1 `gardes`
--   (type IN 'semaine','weekend','ferie'). Une garde de week-end =
--   UNE seule ligne (samedi) avec premier_id / second_id (= rôles du
--   week-end). Il n'existe PAS de ligne « vendredi_soir » en base :
--   le vendredi est DÉRIVÉ à l'affichage par la vue. Pour refléter R8,
--   la branche « vendredi » doit donc PERMUTER 1er ↔ 2nd.
--
-- CORRECTIF :
--   On reconstruit `planning_semaine` à l'identique de la définition
--   courante, SAUF dans le bloc UNION du VENDREDI (g.date - 1 jour,
--   WHERE g.type='weekend') où premier_* ← véto SECOND du WE et
--   second_* ← véto PREMIER du WE. Les blocs samedi (natif) et
--   dimanche (g.date + 1 jour) conservent les rôles du week-end.
--
-- SÉCURITÉ :
--   `CREATE OR REPLACE VIEW` ne préserve pas toujours l'option
--   `security_invoker` (posée en migration 010). On la RÉ-APPLIQUE en
--   fin de migration pour ne pas perdre ce réglage (sinon la vue
--   contournerait la RLS — un véto pourrait voir un brouillon ou les
--   gardes d'un autre cabinet).
--
-- PORTÉE :
--   Aucune donnée n'est modifiée — seule la définition de la vue
--   change. Migration atomique, idempotente (CREATE OR REPLACE),
--   entièrement réversible (revenir à la définition sans permutation).
--   Compatible V2 multi-tenant : l'isolation par cabinet_id reste
--   portée par la RLS de la table `gardes` (héritée via security_invoker).
-- ============================================================

CREATE OR REPLACE VIEW public.planning_semaine AS
-- ── Ligne native (date réelle de la garde) — semaine / week-end (samedi) / férié
SELECT
  g.id,
  g.periode_id,
  g.date,
  g.type,
  g.verrouille,
  g.modifie_manuellement,
  vp.id      AS premier_id,
  vp.prenom  AS premier_prenom,
  vp.nom     AS premier_nom,
  vp.couleur AS premier_couleur,
  vs.id      AS second_id,
  vs.prenom  AS second_prenom,
  vs.nom     AS second_nom,
  vs.couleur AS second_couleur,
  p.saison,
  p.statut   AS periode_statut
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id

UNION ALL

-- ── Vendredi : veille du samedi de garde de week-end.
-- ⚠️ R8 — rôles INVERSÉS : le 1er du week-end (vp) devient 2nd le
--    vendredi, et le 2nd du week-end (vs) devient 1er le vendredi.
SELECT
  g.id,
  g.periode_id,
  (g.date - INTERVAL '1 day')::date AS date,
  g.type,
  g.verrouille,
  g.modifie_manuellement,
  vs.id      AS premier_id,      -- 2nd du WE  → 1er le vendredi
  vs.prenom  AS premier_prenom,
  vs.nom     AS premier_nom,
  vs.couleur AS premier_couleur,
  vp.id      AS second_id,       -- 1er du WE  → 2nd le vendredi
  vp.prenom  AS second_prenom,
  vp.nom     AS second_nom,
  vp.couleur AS second_couleur,
  p.saison,
  p.statut   AS periode_statut
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id
WHERE g.type = 'weekend'

UNION ALL

-- ── Dimanche : lendemain du samedi — même composition que le week-end (samedi).
SELECT
  g.id,
  g.periode_id,
  (g.date + INTERVAL '1 day')::date AS date,
  g.type,
  g.verrouille,
  g.modifie_manuellement,
  vp.id      AS premier_id,
  vp.prenom  AS premier_prenom,
  vp.nom     AS premier_nom,
  vp.couleur AS premier_couleur,
  vs.id      AS second_id,
  vs.prenom  AS second_prenom,
  vs.nom     AS second_nom,
  vs.couleur AS second_couleur,
  p.saison,
  p.statut   AS periode_statut
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id
WHERE g.type = 'weekend'

ORDER BY date;

COMMENT ON VIEW public.planning_semaine IS
  'Planning dénormalisé pour affichage calendrier. Les week-ends génèrent 3 lignes : '
  'vendredi (rôles 1er/2nd INVERSÉS — R8), samedi (natif), dimanche.';

-- La vue doit rester en SECURITY INVOKER (cf. migration 010) :
-- CREATE OR REPLACE VIEW ne préserve pas toujours l'option, on la ré-applique.
ALTER VIEW public.planning_semaine SET (security_invoker = on);
