-- ============================================================
-- GUARDVETO — planning_semaine : dérivation du VENDREDI pilotée par les
--             relations (P6 — verrou n°3, étape 2a). MIGRATION ÉCRITE, NON
--             APPLIQUÉE : à jouer après revue + re-vérif security_invoker.
-- Auteur : MonProjetPro — Date : 2026-07-06
-- ------------------------------------------------------------
-- CE QUE ÇA CHANGE.
--   Jusqu'ici, la branche « vendredi » de la vue INVERSAIT TOUJOURS les rôles
--   1er/2nd (R8 câblée en dur — migration 20260617160000). Depuis RG4, les
--   relations entre créneaux sont PILOTABLES (`relation_creneau`, genres
--   `inversion_role` / `meme_binome`). Un cabinet qui coupe l'inversion voyait
--   pourtant toujours un vendredi inversé à l'écran → affichage FAUX silencieux.
--
--   Cette migration rend la branche vendredi GÉNÉRIQUE : elle APPLIQUE les
--   relations du profil EFFECTIF de la période (mêmes règles que le moteur —
--   cf. src/engine/loader.ts + resoudreRelationsStructure) :
--     • `inversion_role` actif  → rôles inversés (comportement R8 historique) ;
--       sinon → rôles NATIFS (vendredi = samedi).
--     • `meme_binome` actif → le vendredi est matérialisé ; sinon → PAS de
--       ligne vendredi (le cabinet a découplé ses créneaux ; en V1 l'équipe du
--       vendredi n'est pas dérivable).
--
--   Le SAMEDI (natif) et le DIMANCHE (continuation du week-end) sont
--   INCHANGÉS : ils ne dépendent d'aucune relation.
--
-- BYTE-IDENTIQUE (défaut). PRÉCÉDENCE identique au moteur (loader.ts) :
--   - Cabinet/profil SANS catalogue `creneau_modele` (contextes legacy) →
--     REPLI couple historique : inversion=TRUE, matérialisation=TRUE → sortie
--     STRICTEMENT identique à l'ancienne vue.
--   - Cabinet/profil AVEC catalogue → la DONNÉE (`relation_creneau`) fait foi,
--     exactement comme la génération : ce que le moteur a produit et ce que la
--     vue affiche restent cohérents.
--
-- ⚠️⚠️ AVANT D'APPLIQUER — VÉRIFICATION OBLIGATOIRE (sinon régression) :
--   Pour tout cabinet/profil qui A un catalogue, s'assurer que
--   `relation_creneau` contient bien le couple vendredi_soir→weekend
--   {inversion_role, meme_binome} ACTIF — sinon la vue cessera (à juste titre,
--   pour coller au moteur) d'inverser/matérialiser le vendredi. Requête de
--   contrôle (doit renvoyer 1 ligne par profil catalogué, avec les 2 genres) :
--
--     SELECT cm.cabinet_id, cm.profil_id,
--            bool_or(r.genre='inversion_role' AND r.actif) AS a_inversion,
--            bool_or(r.genre='meme_binome'    AND r.actif) AS a_meme_binome
--       FROM creneau_modele cs
--       JOIN creneau_modele cc
--         ON cc.cabinet_id = cs.cabinet_id AND cc.profil_id = cs.profil_id
--        AND cc.code = 'weekend'
--       JOIN relation_creneau r
--         ON r.source_id = cs.id AND r.cible_id = cc.id
--       JOIN creneau_modele cm ON cm.id = cs.id
--      WHERE cs.code = 'vendredi_soir'
--      GROUP BY cm.cabinet_id, cm.profil_id;
--
-- SÉCURITÉ — RLS (piège critique).
--   `CREATE OR REPLACE VIEW` NE PRÉSERVE PAS l'option `security_invoker`
--   (posée en migration 010). Sans elle, la vue s'exécute avec les droits du
--   PROPRIÉTAIRE → contournement de la RLS → un véto pourrait voir un brouillon
--   ou les gardes d'un AUTRE cabinet. On la RÉ-APPLIQUE en fin de migration.
--   Les sous-requêtes ajoutées (creneau_modele / relation_creneau) héritent
--   elles aussi de la RLS de l'appelant grâce à security_invoker.
--
-- PORTÉE. Aucune donnée modifiée — seule la définition de la vue change.
--   Idempotente (CREATE OR REPLACE), réversible (revenir à 20260617160000).
-- ============================================================

CREATE OR REPLACE VIEW public.planning_semaine AS
WITH
-- Profil EFFECTIF de chaque période : celui de la période, sinon le profil
-- DÉFAUT du cabinet (même résolution que resoudreProfilId, source unique).
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
-- Flags résolus par période : faut-il inverser / matérialiser le vendredi ?
-- Repli historique (TRUE/TRUE) quand le cabinet/profil n'a pas de catalogue.
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
      ELSE TRUE  -- pas de catalogue → couple historique câblé
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
      ELSE TRUE  -- pas de catalogue → couple historique câblé
    END AS materialiser
  FROM periode_couple pc
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
  p.statut   AS periode_statut
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id

UNION ALL

-- ── Vendredi : veille du samedi — DÉRIVÉ via les relations (P6). ──
-- Rôles inversés SSI `inverser` (défaut historique) ; ligne émise SSI
-- `materialiser` (défaut historique). vp = 1er du WE, vs = 2nd du WE.
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
  p.statut   AS periode_statut
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
JOIN couple_flags cf ON cf.periode_id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id
WHERE g.type = 'weekend'
  AND cf.materialiser

UNION ALL

-- ── Dimanche : lendemain du samedi — INCHANGÉ (continuation du week-end,
--    indépendante des relations). Même composition que le samedi (natif). ──
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
  'Planning dénormalisé pour affichage. Week-end = 3 lignes : vendredi (rôles '
  'dérivés des relations — inversion R8 pilotable, matérialisé si meme_binome ; '
  'repli couple historique sans catalogue), samedi (natif), dimanche (natif).';

-- ⚠️ RLS — CREATE OR REPLACE VIEW ne préserve pas security_invoker (migration 010).
-- On la RÉ-APPLIQUE : sans elle, fuite inter-cabinet / brouillons visibles.
ALTER VIEW public.planning_semaine SET (security_invoker = on);
