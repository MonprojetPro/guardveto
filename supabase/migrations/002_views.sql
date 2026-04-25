-- ============================================================
-- GUARDVETO — Migration 002 : Vues calculées
-- Auteur : SPARK — MonProjetPro
-- Date   : 2026-04-24
-- ============================================================

-- ============================================================
-- VUE : compteurs_gardes
-- Compteurs par vétérinaire et par période
-- ============================================================
CREATE OR REPLACE VIEW compteurs_gardes AS
SELECT
  g.periode_id,
  v.id                                                            AS veterinaire_id,
  v.prenom,
  v.nom,
  v.statut,
  v.couleur,
  -- Week-ends
  COUNT(*) FILTER (WHERE g.type = 'weekend' AND g.premier_id = v.id) AS we_premier,
  COUNT(*) FILTER (WHERE g.type = 'weekend' AND g.second_id  = v.id) AS we_second,
  -- Total week-ends
  COUNT(*) FILTER (WHERE g.type = 'weekend' AND (g.premier_id = v.id OR g.second_id = v.id)) AS we_total,
  -- Gardes semaine
  COUNT(*) FILTER (WHERE g.type = 'semaine' AND g.premier_id = v.id) AS sem_premier,
  COUNT(*) FILTER (WHERE g.type = 'semaine' AND g.second_id  = v.id) AS sem_second,
  -- Total semaine
  COUNT(*) FILTER (WHERE g.type = 'semaine' AND (g.premier_id = v.id OR g.second_id = v.id)) AS sem_total,
  -- Jours fériés
  COUNT(*) FILTER (WHERE g.type = 'ferie' AND g.premier_id = v.id)   AS feries_premier,
  COUNT(*) FILTER (WHERE g.type = 'ferie' AND g.second_id  = v.id)   AS feries_second,
  COUNT(*) FILTER (WHERE g.type = 'ferie' AND (g.premier_id = v.id OR g.second_id = v.id)) AS feries_total,
  -- Total général
  COUNT(*) FILTER (WHERE g.premier_id = v.id OR g.second_id = v.id)  AS total_gardes
FROM veterinaires v
CROSS JOIN gardes g
WHERE v.actif = true
  AND v.id IN (g.premier_id, g.second_id)
GROUP BY g.periode_id, v.id, v.prenom, v.nom, v.statut, v.couleur;

COMMENT ON VIEW compteurs_gardes IS 'Compteurs de gardes par vétérinaire et par période — utilisé pour équité et bonus/malus';

-- ============================================================
-- VUE : planning_semaine
-- Vue hebdomadaire dénormalisée (utile pour l'affichage)
-- Les gardes de week-end (samedi) génèrent aussi une ligne
-- pour le vendredi (veille) et le dimanche (lendemain) afin
-- que le calendrier affiche les badges sur les 3 jours.
-- ============================================================
CREATE OR REPLACE VIEW planning_semaine AS
-- Ligne native (date réelle de la garde)
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

-- Vendredi : veille du samedi de garde de week-end
SELECT
  g.id,
  g.periode_id,
  (g.date - INTERVAL '1 day')::date AS date,
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

UNION ALL

-- Dimanche : lendemain du samedi de garde de week-end
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

COMMENT ON VIEW planning_semaine IS 'Planning dénormalisé pour affichage calendrier — noms + couleurs des vétos inclus. Les week-ends génèrent 3 lignes (ven/sam/dim).';
