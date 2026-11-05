-- ============================================================
-- B-189 — Le vendredi d'un week-end porte son PROPRE cadenas
-- ============================================================
-- MiKL, 05/11, au bac à sable : « quand je clique sur le cadenas du 25 décembre
-- ça m'embarque tout le week-end ou rien » — puis « il clique, ça verrouille,
-- point ; s'il veut aussi pour les autres jours, il clique à chaque fois ».
--
-- Un week-end est UNE ligne de `gardes` (le samedi) ; la vue `planning_semaine`
-- en tire le vendredi et le dimanche. Son cadenas (`places_figees`) valait
-- donc pour les trois jours. Pour le moteur, le vendredi est pourtant un
-- créneau à part (`vendredi_soir`), lié au week-end par ses règles : il sait
-- composer autour d'un vendredi figé seul (tests B-189).
--
-- ① `gardes.vendredi_figees` porte le cadenas du VENDREDI, dans le vocabulaire
--    de la LIGNE DU VENDREDI (rôles déjà inversés le cas échéant) — c'est celui
--    que l'écran et le moteur lisent ce jour-là. `places_figees` ne vaut plus
--    que pour le samedi et le dimanche (une seule garde pour le moteur).
-- ② Les cadenas existants sont RECOPIÉS sur le vendredi : un week-end
--    cadenassé hier l'était aussi le vendredi, il doit le rester (empreinte de
--    la vue identique avant/après).
-- ③ La vue lit `vendredi_figees` sur la ligne du vendredi.
-- ============================================================

ALTER TABLE public.gardes
  ADD COLUMN IF NOT EXISTS vendredi_figees TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.gardes.vendredi_figees IS
  'B-189 — cadenas du vendredi d''un week-end, rôles de la LIGNE DU VENDREDI (inversion déjà appliquée). places_figees vaut pour samedi + dimanche.';

ALTER TABLE public.gardes
  DROP CONSTRAINT IF EXISTS gardes_vendredi_figees_roles;
ALTER TABLE public.gardes
  ADD CONSTRAINT gardes_vendredi_figees_roles
  CHECK (vendredi_figees <@ ARRAY['premier', 'second']::text[]);

-- ② Recopie des cadenas existants, traduits dans le vocabulaire du vendredi.
UPDATE public.gardes g
   SET vendredi_figees = ARRAY(
         -- Ordre d'origine conservé : la vue rend le même tableau qu'avant.
         SELECT
           CASE WHEN cf.inverser THEN
             CASE x.x WHEN 'premier' THEN 'second' WHEN 'second' THEN 'premier' ELSE x.x END
           ELSE x.x END
           FROM unnest(g.places_figees) WITH ORDINALITY x(x, n)
          WHERE x.x IN ('premier', 'second')
          ORDER BY x.n
       )
  FROM public.couple_vendredi_weekend cf
 WHERE cf.periode_id = g.periode_id
   AND cf.materialiser
   AND g.type = 'weekend'
   AND g.places_figees <> '{}';

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
            -- B-189 — le vendredi a son propre cadenas, déjà dans SON vocabulaire.
            -- Les places au-delà de la 2e gardent celui du week-end.
            g.vendredi_figees || ARRAY(
              SELECT x.x FROM unnest(g.places_figees) x(x)
               WHERE x.x <> ALL (ARRAY['premier'::text, 'second'::text])
            ) AS places_figees
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
