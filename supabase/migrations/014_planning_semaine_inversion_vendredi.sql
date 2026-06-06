-- ============================================================
-- GUARDVETO — Migration 014 : Inversion 1er/2nd vendredi ↔ week-end
-- Auteur : MAX — MonProjetPro
-- Date   : 2026-06-06
-- ------------------------------------------------------------
-- BUG corrigé : la règle dure R8 (« celui qui est 1er le vendredi
-- soir devient 2nd le week-end, et inversement ») était bien
-- calculée par le moteur, mais la vue `planning_semaine` recopiait
-- la paire du week-end À L'IDENTIQUE sur le vendredi → l'inversion
-- n'apparaissait jamais à l'écran (ven = sam = dim).
--
-- Correctif : la branche « vendredi » de la vue PERMUTE désormais
-- 1er et 2nd. Comme R8 + R9 garantissent que le vendredi a les deux
-- mêmes vétos que le week-end avec les rôles inversés, permuter les
-- colonnes reconstruit exactement la composition réelle du vendredi.
--
-- Aucune donnée n'est modifiée : seule la définition de la vue change.
-- Entièrement réversible (revenir à la définition de 002_views.sql).
-- ============================================================

CREATE OR REPLACE VIEW planning_semaine AS
-- Ligne native (date réelle de la garde) — semaine / week-end (samedi) / férié
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

-- Vendredi : veille du samedi de garde de week-end.
-- ⚠️ R8 — rôles INVERSÉS : le 1er du week-end (vp) devient 2nd le
-- vendredi, et le 2nd du week-end (vs) devient 1er le vendredi.
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

-- Dimanche : lendemain du samedi — même composition que le week-end (samedi).
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

COMMENT ON VIEW planning_semaine IS 'Planning dénormalisé pour affichage calendrier. Les week-ends génèrent 3 lignes : vendredi (rôles 1er/2nd INVERSÉS — R8), samedi (natif), dimanche.';

-- La vue reste en SECURITY INVOKER (cf. migration 010) — CREATE OR REPLACE
-- ne préserve pas toujours l'option, on la ré-applique par sécurité.
ALTER VIEW planning_semaine SET (security_invoker = on);
