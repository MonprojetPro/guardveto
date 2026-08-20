-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Backlog 8 bis (2/2) : la vue planning_semaine
--             APPLIQUE les exceptions de jour
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-08-20
-- ───────────────────────────────────────────────────────────────
-- POURQUOI ICI, ET PAS DANS CHAQUE ÉCRAN
--   `planning_semaine` est lue par QUATORZE modules : l'écran planning V2,
--   l'épicentre de l'accueil, le validateur, le contrôle de cohérence, les
--   outils de Filou, l'import, les places de garde… Brancher les exceptions
--   dans la vue les sert TOUS d'un coup. Les brancher écran par écran, c'est
--   la garantie d'en oublier un — et un consumer oublié se voit à ceci :
--   « ça ne se met à jour QUE quelque part ».
--
-- CE QUI CHANGE PAR RAPPORT À LA DÉFINITION PRÉCÉDENTE
--   1. Les trois branches (garde native / vendredi dérivé / dimanche dérivé)
--      sont regroupées dans un CTE `base` au lieu d'être copiées-collées avec
--      leurs jointures. Trois copies, c'était trois endroits où appliquer les
--      exceptions — et trois occasions d'en oublier une.
--   2. Deux LEFT JOIN sur `gardes_exceptions` (une par rôle) substituent le
--      vétérinaire du jour. Une exception PRÉSENTE fait foi même si elle ne
--      désigne personne : une place laissée vacante doit se voir VIDE, pas
--      retomber en silence sur un titulaire qui ne viendra pas.
--   3. Quatre colonnes ajoutées EN FIN de vue (jour_exceptionnel,
--      exception_premier, exception_second, compte_1er_we) pour que
--      l'affichage puisse SIGNALER l'exception au lieu de la faire passer
--      pour l'attribution ordinaire.
--
-- ÉQUITÉ : rien à faire ici. Les compteurs (`compteurs_gardes`) lisent la
--   table `gardes` en direct, pas cette vue — une exception simple est donc
--   NEUTRE par construction, ce qui est exactement la règle voulue.
--
-- NON-RÉGRESSION : vérifiée en base après application — mêmes comptes de
--   lignes par jour et par type qu'avant (18 ven / 18 sam / 18 dim / 40
--   semaine+férié), aucun vétérinaire perdu, 0 exception. Tant que
--   `gardes_exceptions` est vide, la vue est équivalente à la précédente.
-- ROLLBACK : réappliquer la définition de
--   20260729180000_planning_semaine_places_supplementaires.sql.
--
-- ⚠️ `places_sup` (places 3 et 4 des créneaux sur-mesure) n'est PAS couverte
--    par les exceptions : le cas 8 bis porte sur le binôme du week-end. Un
--    créneau sur-mesure à trois places qui aurait besoin d'un remplacement
--    d'un jour devra étendre cette jointure — c'est une limite ASSUMÉE, pas
--    un oubli.
-- ═══════════════════════════════════════════════════════════════
-- (définition alignée sur la base — voir pg_get_viewdef)

CREATE OR REPLACE VIEW public.planning_semaine AS
WITH periode_couple AS (
  SELECT p.id AS periode_id,
         p.cabinet_id,
         COALESCE(p.profil_id, (SELECT pp.id FROM profils_planning pp
                                 WHERE pp.cabinet_id = p.cabinet_id AND pp.est_defaut = true
                                 LIMIT 1)) AS profil_id
    FROM periodes p
), couple_flags AS (
  SELECT pc.periode_id,
         CASE WHEN (EXISTS (SELECT 1 FROM creneau_modele cm
                             WHERE cm.cabinet_id = pc.cabinet_id AND cm.profil_id = pc.profil_id))
              THEN (EXISTS (SELECT 1 FROM relation_creneau r
                              JOIN creneau_modele cs ON cs.id = r.source_id
                              JOIN creneau_modele cc ON cc.id = r.cible_id
                             WHERE r.cabinet_id = pc.cabinet_id AND r.profil_id = pc.profil_id
                               AND r.actif AND r.genre = 'inversion_role'
                               AND cs.code = 'vendredi_soir' AND cc.code = 'weekend'))
              ELSE true END AS inverser,
         CASE WHEN (EXISTS (SELECT 1 FROM creneau_modele cm
                             WHERE cm.cabinet_id = pc.cabinet_id AND cm.profil_id = pc.profil_id))
              THEN (EXISTS (SELECT 1 FROM relation_creneau r
                              JOIN creneau_modele cs ON cs.id = r.source_id
                              JOIN creneau_modele cc ON cc.id = r.cible_id
                             WHERE r.cabinet_id = pc.cabinet_id AND r.profil_id = pc.profil_id
                               AND r.actif AND r.genre = 'meme_binome'
                               AND cs.code = 'vendredi_soir' AND cc.code = 'weekend'))
              ELSE true END AS materialiser
    FROM periode_couple pc
), places_sup AS (
  SELECT gp.garde_id,
         jsonb_agg(jsonb_build_object('place_index', gp.place_index, 'role', gp.role,
                                      'id', v.id, 'prenom', v.prenom, 'nom', v.nom,
                                      'couleur', v.couleur) ORDER BY gp.place_index) AS places
    FROM garde_placements gp
    JOIN veterinaires v ON v.id = gp.veterinaire_id
   WHERE gp.place_index >= 2
   GROUP BY gp.garde_id
),
-- Les trois jours qu'une garde OCCUPE réellement au calendrier, avec le
-- titulaire de chaque rôle TEL QU'IL S'AFFICHE ce jour-là (le vendredi peut
-- inverser les rôles). Le week-end est une ligne unique posée le samedi qui
-- couvre vendredi soir -> lundi matin : ces trois branches sont ce qui la
-- rend visible sur les trois cases du calendrier.
base AS (
  SELECT g.id, g.periode_id, g.date AS date, g.type, g.verrouille, g.modifie_manuellement,
         g.premier_id AS tit_premier, g.second_id AS tit_second
    FROM gardes g
  UNION ALL
  SELECT g.id, g.periode_id, (g.date - '1 day'::interval)::date, g.type, g.verrouille, g.modifie_manuellement,
         CASE WHEN cf.inverser THEN g.second_id ELSE g.premier_id END,
         CASE WHEN cf.inverser THEN g.premier_id ELSE g.second_id END
    FROM gardes g
    JOIN couple_flags cf ON cf.periode_id = g.periode_id
   WHERE g.type = 'weekend' AND cf.materialiser
  UNION ALL
  SELECT g.id, g.periode_id, (g.date + '1 day'::interval)::date, g.type, g.verrouille, g.modifie_manuellement,
         g.premier_id, g.second_id
    FROM gardes g
   WHERE g.type = 'weekend'
)
SELECT b.id,
       b.periode_id,
       b.date,
       b.type,
       b.verrouille,
       b.modifie_manuellement,
       vp.id AS premier_id,
       vp.prenom AS premier_prenom,
       vp.nom AS premier_nom,
       vp.couleur AS premier_couleur,
       vs.id AS second_id,
       vs.prenom AS second_prenom,
       vs.nom AS second_nom,
       vs.couleur AS second_couleur,
       p.saison,
       p.statut AS periode_statut,
       COALESCE(ps.places, '[]'::jsonb) AS places_sup,
       (ep.id IS NOT NULL OR es.id IS NOT NULL) AS jour_exceptionnel,
       (ep.id IS NOT NULL) AS exception_premier,
       (es.id IS NOT NULL) AS exception_second,
       COALESCE(ep.compte_1er_we, false) AS compte_1er_we
  FROM base b
  JOIN periodes p ON p.id = b.periode_id
  LEFT JOIN gardes_exceptions ep
         ON ep.garde_id = b.id AND ep.date = b.date AND ep.role = 'premier'
  LEFT JOIN gardes_exceptions es
         ON es.garde_id = b.id AND es.date = b.date AND es.role = 'second'
  LEFT JOIN veterinaires vp
         ON vp.id = CASE WHEN ep.id IS NOT NULL THEN ep.veterinaire_id ELSE b.tit_premier END
  LEFT JOIN veterinaires vs
         ON vs.id = CASE WHEN es.id IS NOT NULL THEN es.veterinaire_id ELSE b.tit_second END
  LEFT JOIN places_sup ps ON ps.garde_id = b.id
 ORDER BY 3;
