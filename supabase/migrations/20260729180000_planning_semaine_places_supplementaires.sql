-- ============================================================
-- GUARDVETO — planning_semaine : les places AU-DELÀ DE LA DEUXIÈME
-- ============================================================
-- Le catalogue autorise jusqu'à 4 places par créneau (N_PLACES_MAX), et le
-- moteur sait les pourvoir. Mais `gardes` n'a que deux colonnes — premier_id
-- et second_id — et les places 3 et 4 ne vivent que dans le miroir
-- `garde_placements`, « qu'aucun lecteur ne consomme encore » (P3b-1).
--
-- Conséquence : un cabinet qui créerait un créneau à 3 ou 4 places verrait
-- son planning n'en afficher que 2, EN SILENCE. Cette migration ouvre le
-- premier lecteur.
--
-- Principe : on N'AJOUTE qu'une colonne, `places_sup`, en fin de vue.
--   • Les places 0 et 1 restent celles de la vue (premier_* / second_*) :
--     ce sont elles qui portent l'inversion du vendredi et la dérivation du
--     week-end. Y toucher rouvrirait le bug de la couche aval (2026-06-17).
--   • Seules les places d'index >= 2 viennent du miroir — l'inversion ne
--     concerne que les deux premiers rôles, ces places-là sont donc les
--     mêmes sur les trois lignes d'un week-end.
--
-- Additif et réversible : les lecteurs actuels ne voient aucune différence.
-- ============================================================

CREATE OR REPLACE VIEW public.planning_semaine AS
WITH
periode_couple AS (
  SELECT
    p.id         AS periode_id,
    p.cabinet_id AS cabinet_id,
    COALESCE(
      p.profil_id,
      (SELECT pp.id FROM profils_planning pp
        WHERE pp.cabinet_id = p.cabinet_id AND pp.est_defaut = TRUE
        LIMIT 1)
    ) AS profil_id
  FROM periodes p
),
couple_flags AS (
  SELECT
    pc.periode_id,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM creneau_modele cm
         WHERE cm.cabinet_id = pc.cabinet_id AND cm.profil_id = pc.profil_id
      ) THEN EXISTS (
        SELECT 1
          FROM relation_creneau r
          JOIN creneau_modele cs ON cs.id = r.source_id
          JOIN creneau_modele cc ON cc.id = r.cible_id
         WHERE r.cabinet_id = pc.cabinet_id AND r.profil_id = pc.profil_id
           AND r.actif AND r.genre = 'inversion_role'
           AND cs.code = 'vendredi_soir' AND cc.code = 'weekend'
      )
      ELSE TRUE
    END AS inverser,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM creneau_modele cm
         WHERE cm.cabinet_id = pc.cabinet_id AND cm.profil_id = pc.profil_id
      ) THEN EXISTS (
        SELECT 1
          FROM relation_creneau r
          JOIN creneau_modele cs ON cs.id = r.source_id
          JOIN creneau_modele cc ON cc.id = r.cible_id
         WHERE r.cabinet_id = pc.cabinet_id AND r.profil_id = pc.profil_id
           AND r.actif AND r.genre = 'meme_binome'
           AND cs.code = 'vendredi_soir' AND cc.code = 'weekend'
      )
      ELSE TRUE
    END AS materialiser
  FROM periode_couple pc
),
-- Les places d'index >= 2, agrégées par garde, avec de quoi les afficher.
-- Une garde sans place supplémentaire n'apparaît pas ici (LEFT JOIN → NULL,
-- ramené à un tableau vide par COALESCE).
places_sup AS (
  SELECT
    gp.garde_id,
    jsonb_agg(
      jsonb_build_object(
        'place_index', gp.place_index,
        'role',        gp.role,
        'id',          v.id,
        'prenom',      v.prenom,
        'nom',         v.nom,
        'couleur',     v.couleur
      )
      ORDER BY gp.place_index
    ) AS places
  FROM garde_placements gp
  JOIN veterinaires v ON v.id = gp.veterinaire_id
  WHERE gp.place_index >= 2
  GROUP BY gp.garde_id
)

-- ── Ligne native (date réelle) — semaine / week-end (samedi) / férié ──
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
  p.statut   AS periode_statut,
  COALESCE(ps.places, '[]'::jsonb) AS places_sup
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id
LEFT JOIN places_sup ps ON ps.garde_id = g.id

UNION ALL

-- ── Vendredi : veille du samedi — DÉRIVÉ via les relations (P6). ──
SELECT
  g.id,
  g.periode_id,
  (g.date - INTERVAL '1 day')::date AS date,
  g.type,
  g.verrouille,
  g.modifie_manuellement,
  CASE WHEN cf.inverser THEN vs.id      ELSE vp.id      END AS premier_id,
  CASE WHEN cf.inverser THEN vs.prenom  ELSE vp.prenom  END AS premier_prenom,
  CASE WHEN cf.inverser THEN vs.nom     ELSE vp.nom     END AS premier_nom,
  CASE WHEN cf.inverser THEN vs.couleur ELSE vp.couleur END AS premier_couleur,
  CASE WHEN cf.inverser THEN vp.id      ELSE vs.id      END AS second_id,
  CASE WHEN cf.inverser THEN vp.prenom  ELSE vs.prenom  END AS second_prenom,
  CASE WHEN cf.inverser THEN vp.nom     ELSE vs.nom     END AS second_nom,
  CASE WHEN cf.inverser THEN vp.couleur ELSE vs.couleur END AS second_couleur,
  p.saison,
  p.statut   AS periode_statut,
  COALESCE(ps.places, '[]'::jsonb) AS places_sup
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
JOIN couple_flags cf ON cf.periode_id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id
LEFT JOIN places_sup ps ON ps.garde_id = g.id
WHERE g.type = 'weekend'
  AND cf.materialiser

UNION ALL

-- ── Dimanche : lendemain du samedi — INCHANGÉ. ──
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
  p.statut   AS periode_statut,
  COALESCE(ps.places, '[]'::jsonb) AS places_sup
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id
LEFT JOIN places_sup ps ON ps.garde_id = g.id
WHERE g.type = 'weekend'

ORDER BY date;

COMMENT ON VIEW public.planning_semaine IS
  'Planning dénormalisé pour affichage. Week-end = 3 lignes : vendredi (rôles '
  'dérivés des relations — inversion R8 pilotable, matérialisé si meme_binome ; '
  'repli couple historique sans catalogue), samedi (natif), dimanche (natif). '
  'places_sup = places d''index >= 2 (créneaux sur-mesure à 3 ou 4 places), '
  'issues du miroir garde_placements ; les places 0 et 1 restent premier_*/second_*.';

ALTER VIEW public.planning_semaine SET (security_invoker = on);
