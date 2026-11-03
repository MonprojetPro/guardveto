-- ============================================================
-- B-187 — Un remplacement d'un seul jour peut porter son propre cadenas
-- ============================================================
-- Constat du 03/11 (Val d'Allier, Hiver P3) : le 25/12 et le 01/01 sont des
-- remplacements d'un jour posés sur la garde du week-end. Le cadenas affiché
-- devant les remplaçants était celui du WEEK-END, et le poser ou l'enlever
-- était refusé (« Cette personne ne tient pas cette garde »).
--
-- Décision de MiKL : sur ces jours, le cadenas fixe LES PERSONNES CHOISIES PAR
-- L'ADMIN, et on peut l'enlever. Un remplacement fixé survit à la génération
-- (voir `ecrirePlanningV1`) ; un remplacement libre est laissé au moteur.
--
-- ① La colonne `fige` porte ce cadenas.
-- ② La vue `planning_semaine` le rend dans `places_figees` pour les jours
--    remplacés : la place remplacée suit `fige` du remplacement, l'autre place
--    garde le cadenas du week-end. Les rôles de `gardes_exceptions` sont déjà
--    ceux de la LIGNE (vendredi inversé compris), comme `b.places_figees`.
-- ③ Les 4 remplacements du brouillon Hiver P3 du Val d'Allier sont fixés :
--    Anne-Sophie avait voulu les cadenasser (MiKL, 03/11).
-- ============================================================

ALTER TABLE public.gardes_exceptions
  ADD COLUMN IF NOT EXISTS fige BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.gardes_exceptions.fige IS
  'B-187 — cadenas propre au remplacement d''un jour : vrai = la génération le remet en place, faux = le moteur reprend la main sur ce jour.';

CREATE OR REPLACE VIEW public.planning_semaine
WITH (security_invoker = true) AS
 WITH places_sup AS (
         SELECT gp.garde_id,
            jsonb_agg(jsonb_build_object('place_index', gp.place_index, 'role', gp.role, 'id', v.id, 'prenom', v.prenom, 'nom', v.nom, 'couleur', v.couleur) ORDER BY gp.place_index) AS places
           FROM garde_placements gp
             JOIN veterinaires v ON v.id = gp.veterinaire_id
          WHERE gp.place_index >= 2
          GROUP BY gp.garde_id
        ), base AS (
         SELECT g.id,
            g.periode_id,
            g.date,
            g.type,
            g.verrouille,
            g.modifie_manuellement,
            g.cabinet_id,
            g.premier_id AS tit_premier,
            g.second_id AS tit_second,
            g.places_figees
           FROM gardes g
        UNION ALL
         SELECT g.id,
            g.periode_id,
            (g.date - '1 day'::interval)::date AS date,
            g.type,
            g.verrouille,
            g.modifie_manuellement,
            g.cabinet_id,
                CASE
                    WHEN cf.inverser THEN g.second_id
                    ELSE g.premier_id
                END AS premier_id,
                CASE
                    WHEN cf.inverser THEN g.premier_id
                    ELSE g.second_id
                END AS second_id,
                CASE
                    WHEN cf.inverser THEN ARRAY( SELECT
                            CASE x.x
                                WHEN 'premier'::text THEN 'second'::text
                                WHEN 'second'::text THEN 'premier'::text
                                ELSE x.x
                            END AS x
                       FROM unnest(g.places_figees) x(x))
                    ELSE g.places_figees
                END AS places_figees
           FROM gardes g
             JOIN couple_vendredi_weekend cf ON cf.periode_id = g.periode_id
          WHERE g.type = 'weekend'::text AND cf.materialiser
        UNION ALL
         SELECT g.id,
            g.periode_id,
            (g.date + '1 day'::interval)::date AS date,
            g.type,
            g.verrouille,
            g.modifie_manuellement,
            g.cabinet_id,
            g.premier_id,
            g.second_id,
            g.places_figees
           FROM gardes g
          WHERE g.type = 'weekend'::text
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
    ep.id IS NOT NULL OR es.id IS NOT NULL AS jour_exceptionnel,
    ep.id IS NOT NULL AS exception_premier,
    es.id IS NOT NULL AS exception_second,
    COALESCE(ep.compte_1er_we, false) AS compte_1er_we,
    b.cabinet_id,
        CASE
            WHEN ep.id IS NULL AND es.id IS NULL THEN b.places_figees
            ELSE ARRAY(
              SELECT r.r
                FROM unnest(ARRAY['premier'::text, 'second'::text]) r(r)
               WHERE (r.r = 'premier'::text AND
                        CASE WHEN ep.id IS NOT NULL THEN ep.fige
                             ELSE 'premier'::text = ANY (COALESCE(b.places_figees, '{}'::text[])) END)
                  OR (r.r = 'second'::text AND
                        CASE WHEN es.id IS NOT NULL THEN es.fige
                             ELSE 'second'::text = ANY (COALESCE(b.places_figees, '{}'::text[])) END)
            ) || ARRAY(
              -- Les places au-delà de la 2e gardent le cadenas du week-end.
              SELECT x.x FROM unnest(COALESCE(b.places_figees, '{}'::text[])) x(x)
               WHERE x.x <> ALL (ARRAY['premier'::text, 'second'::text])
            )
        END AS places_figees
   FROM base b
     JOIN periodes p ON p.id = b.periode_id
     LEFT JOIN gardes_exceptions ep ON ep.garde_id = b.id AND ep.date = b.date AND ep.role = 'premier'::text
     LEFT JOIN gardes_exceptions es ON es.garde_id = b.id AND es.date = b.date AND es.role = 'second'::text
     LEFT JOIN veterinaires vp ON vp.id =
        CASE
            WHEN ep.id IS NOT NULL THEN ep.veterinaire_id
            ELSE b.tit_premier
        END
     LEFT JOIN veterinaires vs ON vs.id =
        CASE
            WHEN es.id IS NOT NULL THEN es.veterinaire_id
            ELSE b.tit_second
        END
     LEFT JOIN places_sup ps ON ps.garde_id = b.id
  ORDER BY b.date;

-- CREATE OR REPLACE ne garantit pas l'option : on la repose (tests/lib/vues-security-invoker).
ALTER VIEW public.planning_semaine SET (security_invoker = true);

UPDATE public.gardes_exceptions e
   SET fige = true
  FROM public.gardes g
 WHERE g.id = e.garde_id
   AND g.periode_id = '3fabcced-b9f2-451c-8e90-ec4b3241b757'
   AND e.cabinet_id = '00000000-0000-0000-0000-000000000001';
