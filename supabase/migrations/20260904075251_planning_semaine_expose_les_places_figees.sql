-- ============================================================
-- B-111 — la vue du planning dit QUELLES PLACES SONT CADENASSÉES
-- ============================================================
-- Sans cette colonne, l'écran ne peut pas afficher les cadenas : il lit le
-- planning par `planning_semaine`, jamais par la table `gardes`.
--
-- ⚠️ LE PIÈGE, ET LA RAISON POUR LAQUELLE CE N'EST PAS UN SIMPLE `g.places_figees` :
--
-- Cette vue MATÉRIALISE le week-end sur trois jours (vendredi, samedi,
-- dimanche) et, pour la ligne du VENDREDI, elle INVERSE les deux rôles quand la
-- relation `inversion_role` est active — le 1er affiché le vendredi est le 2nd
-- de la garde week-end. Exposer les labels bruts aurait donc dessiné le cadenas
-- sur l'autre place, un jour sur trois : l'admin aurait vu son cadenas se
-- déplacer tout seul, ou pire, aurait cadenassé quelqu'un d'autre en croyant
-- fixer la personne affichée.
--
-- Les labels suivent donc exactement le même sort que `premier_id`/`second_id`
-- juste au-dessus. Une colonne qui ment sur une ligne sur trois serait pire que
-- pas de colonne du tout — elle aurait l'air de marcher.
--
-- MESURE DE CONTRÔLE (04/09, sur la base réelle) : un cadenas posé sur la place
-- `premier` d'un week-end tenu par Fanny (1re) et Antoine (2nd) ressort
-- `{premier}` le samedi et le dimanche, et `{second}` le vendredi — où la vue
-- affiche justement Fanny en 2nde. Le cadenas désigne bien la même personne les
-- trois jours.
--
-- `security_invoker=true` est reconduit explicitement : sans lui, la vue
-- s'ouvre à `anon`, dont la clé vit dans le bundle du navigateur (incident du
-- 2026-08-22, `vues-sans-rls-security-invoker`).
-- ============================================================

CREATE OR REPLACE VIEW public.planning_semaine
WITH (security_invoker = true) AS
 WITH periode_couple AS (
         SELECT p_1.id AS periode_id,
            p_1.cabinet_id,
            COALESCE(p_1.profil_id, ( SELECT pp.id
                   FROM profils_planning pp
                  WHERE pp.cabinet_id = p_1.cabinet_id AND pp.est_defaut = true
                 LIMIT 1)) AS profil_id
           FROM periodes p_1
        ), couple_flags AS (
         SELECT pc.periode_id,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM creneau_modele cm
                      WHERE cm.cabinet_id = pc.cabinet_id AND cm.profil_id = pc.profil_id)) THEN (EXISTS ( SELECT 1
                       FROM relation_creneau r
                         JOIN creneau_modele cs ON cs.id = r.source_id
                         JOIN creneau_modele cc ON cc.id = r.cible_id
                      WHERE r.cabinet_id = pc.cabinet_id AND r.profil_id = pc.profil_id AND r.actif AND r.genre = 'inversion_role'::text AND cs.code = 'vendredi_soir'::text AND cc.code = 'weekend'::text))
                    ELSE true
                END AS inverser,
                CASE
                    WHEN (EXISTS ( SELECT 1
                       FROM creneau_modele cm
                      WHERE cm.cabinet_id = pc.cabinet_id AND cm.profil_id = pc.profil_id)) THEN (EXISTS ( SELECT 1
                       FROM relation_creneau r
                         JOIN creneau_modele cs ON cs.id = r.source_id
                         JOIN creneau_modele cc ON cc.id = r.cible_id
                      WHERE r.cabinet_id = pc.cabinet_id AND r.profil_id = pc.profil_id AND r.actif AND r.genre = 'meme_binome'::text AND cs.code = 'vendredi_soir'::text AND cc.code = 'weekend'::text))
                    ELSE true
                END AS materialiser
           FROM periode_couple pc
        ), places_sup AS (
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
                -- Les labels suivent l'inversion, exactement comme les deux
                -- colonnes ci-dessus. Tout label non historique est laissé tel
                -- quel : l'inversion ne concerne que le couple 1er/2nd.
                CASE
                    WHEN cf.inverser THEN ARRAY(
                      SELECT CASE x
                               WHEN 'premier' THEN 'second'
                               WHEN 'second'  THEN 'premier'
                               ELSE x
                             END
                      FROM unnest(g.places_figees) AS x
                    )
                    ELSE g.places_figees
                END AS places_figees
           FROM gardes g
             JOIN couple_flags cf ON cf.periode_id = g.periode_id
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
    b.places_figees
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

-- Redondant avec le `WITH (...)` ci-dessus, et VOULU. Le garde-fou
-- `tests/lib/vues-security-invoker.test.ts` exige cette forme explicite sur
-- toute migration qui recrée la vue, et il a raison de ne pas se fier au reste :
-- c'est un `CREATE OR REPLACE` sans l'option qui a ouvert les vues à `anon` le
-- 2026-08-22. Le contrôle se satisfait d'une ligne ; l'assouplir pour
-- reconnaître une autre écriture aurait coûté bien plus cher.
ALTER VIEW public.planning_semaine SET (security_invoker = true);
