-- ============================================================
-- GUARDVETO — Les deux fonctions qui parlaient encore de structure dupliquée
-- ============================================================
-- Suite de `20260804140000` : la structure est devenue un socle unique du
-- cabinet, affiné par période type. Deux fonctions raisonnaient encore sur
-- l'ancien modèle et devaient bouger avec lui — les laisser aurait recréé des
-- créneaux dupliqués à la première période type, annulant la migration.
-- ============================================================

BEGIN;

-- ── dupliquer_profil : ne duplique plus RIEN ──────────────────────────────
-- Créer une période type était « copier tout le catalogue de la source ».
-- Maintenant, c'est « créer une ligne, et recopier ses CHOIX » — le socle,
-- lui, est commun. Le nom de la fonction reste (la RPC est appelée depuis
-- l'application), sa promesse change : elle duplique un AFFINAGE.
--
-- Sans source, la nouvelle période type part sans aucune ligne d'affinage :
-- elle prend donc tout le socle, toutes places comprises. C'est le défaut le
-- plus utile — on part de tout ce qui est possible, et on retire ensuite.
CREATE OR REPLACE FUNCTION public.dupliquer_profil(
  p_nom text,
  p_source_profil_id uuid DEFAULT NULL::uuid,
  p_saison text DEFAULT NULL::text,
  p_effectif integer DEFAULT NULL::integer
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_cabinet uuid;
  v_new     uuid;
  v_ordre   smallint;
BEGIN
  v_cabinet := public.auth_cabinet_actif();
  IF v_cabinet IS NULL THEN
    RAISE EXCEPTION 'dupliquer_profil: cabinet introuvable pour ce JWT';
  END IF;

  IF p_nom IS NULL OR btrim(p_nom) = '' THEN
    RAISE EXCEPTION 'dupliquer_profil: nom de période type vide';
  END IF;

  SELECT COALESCE(MAX(ordre), 0) + 1 INTO v_ordre
  FROM public.profils_planning
  WHERE cabinet_id = v_cabinet;

  -- `p_saison` et `p_effectif` sont conservés dans la signature : l'appelant
  -- historique (et Filou) les passent encore. Ils ne sont plus écrits — les
  -- deux réglages ont été supprimés le 2026-08-04.
  INSERT INTO public.profils_planning
    (cabinet_id, nom, actif, est_defaut, ordre)
  VALUES
    (v_cabinet, btrim(p_nom), true, false, v_ordre)
  RETURNING id INTO v_new;

  IF p_source_profil_id IS NOT NULL THEN
    INSERT INTO public.periode_type_creneau (cabinet_id, profil_id, creneau_id, nb_vetos)
    SELECT ptc.cabinet_id, v_new, ptc.creneau_id, ptc.nb_vetos
    FROM public.periode_type_creneau ptc
    WHERE ptc.cabinet_id = v_cabinet AND ptc.profil_id = p_source_profil_id
    ON CONFLICT (profil_id, creneau_id) DO NOTHING;
  END IF;

  RETURN v_new;
END;
$function$;

-- ── prendre_snapshot : fige le socle DÉJÀ AFFINÉ ──────────────────────────
-- Le snapshot sert à rejouer un planning publié exactement comme il a été
-- généré. Il lisait `creneau_modele WHERE profil_id = <celui de la période>`
-- — une requête qui ne rend plus rien depuis que les créneaux vivent sur le
-- socle. Il fige désormais le RÉSULTAT : le socle, avec le nombre de places
-- que la période type retenait, et sans les créneaux qu'elle avait retirés
-- (`nb_vetos = 0`). C'est mieux qu'avant : on garde ce que le moteur a
-- réellement utilisé, pas les ingrédients qu'il aurait fallu recombiner.
CREATE OR REPLACE FUNCTION public.prendre_snapshot(p_planning_id uuid, p_cabinet_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot_id UUID;
  v_regles_json JSONB;
  v_effectif    INTEGER;
  v_profil_id   UUID;
  v_creneaux    JSONB;
  v_relations   JSONB;
BEGIN
  IF auth.jwt() IS NOT NULL AND p_cabinet_id IS DISTINCT FROM public.auth_cabinet_actif() THEN
    RAISE EXCEPTION 'prendre_snapshot: cabinet_id % non autorise pour ce JWT', p_cabinet_id;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',            r.id,
      'cabinet_id',    r.cabinet_id,
      'periode_id',    r.periode_id,
      'brique_id',     r.brique_id,
      'params_json',   r.params_json,
      'force',         r.force,
      'validite_json', r.validite_json,
      'version',       r.version,
      'actif',         r.actif
    )
    ORDER BY r.id
  )
  INTO v_regles_json
  FROM public.regles_cabinet r
  WHERE r.cabinet_id = p_cabinet_id
    AND r.actif = true
    AND (r.periode_id IS NULL OR r.periode_id = p_planning_id);

  SELECT profil_id INTO v_profil_id FROM public.periodes WHERE id = p_planning_id;

  SELECT nb_vetos_semaine_soir INTO v_effectif
  FROM public.periodes WHERE id = p_planning_id;

  -- Le socle affiné. `LEAST` reproduit la borne du code applicatif
  -- (`appliquerAffinage`) : une période type ne dépasse jamais son socle.
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',               cm.id,
      'code',             cm.code,
      'nom',              cm.nom,
      'jours_semaine',    cm.jours_semaine,
      'sur_feries',       cm.sur_feries,
      'heure_debut',      cm.heure_debut,
      'heure_fin',        cm.heure_fin,
      'offset_jours_fin', cm.offset_jours_fin,
      'nb_places',        LEAST(COALESCE(ptc.nb_vetos, cm.nb_places), cm.nb_places),
      'roles',            cm.roles[1:LEAST(COALESCE(ptc.nb_vetos, cm.nb_places), cm.nb_places)],
      'actif',            cm.actif,
      'ordre',            cm.ordre
    )
    ORDER BY cm.ordre
  )
  INTO v_creneaux
  FROM public.creneau_modele cm
  LEFT JOIN public.periode_type_creneau ptc
         ON ptc.creneau_id = cm.id AND ptc.profil_id = v_profil_id
  WHERE cm.cabinet_id = p_cabinet_id
    AND cm.profil_id IS NULL
    AND COALESCE(ptc.nb_vetos, cm.nb_places) > 0;  -- 0 = pas de garde ici

  -- Les enchaînements du socle, moins ceux dont un bout a été retiré.
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',        rc.id,
      'source_id', rc.source_id,
      'cible_id',  rc.cible_id,
      'genre',     rc.genre,
      'actif',     rc.actif
    )
    ORDER BY rc.id
  )
  INTO v_relations
  FROM public.relation_creneau rc
  WHERE rc.cabinet_id = p_cabinet_id
    AND rc.profil_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.periode_type_creneau z
      WHERE z.profil_id = v_profil_id
        AND z.nb_vetos = 0
        AND z.creneau_id IN (rc.source_id, rc.cible_id)
    );

  INSERT INTO public.snapshots_regles (cabinet_id, planning_id, regles_json)
  VALUES (
    p_cabinet_id,
    p_planning_id,
    jsonb_build_object(
      'schema',         5,
      'regles_cabinet', COALESCE(v_regles_json, '[]'::JSONB),
      'effectif',       jsonb_build_object('nb_vetos_semaine_soir', v_effectif),
      'structure',      jsonb_build_object(
        'profil_id',        v_profil_id,
        'creneau_modele',   COALESCE(v_creneaux, '[]'::JSONB),
        'relation_creneau', COALESCE(v_relations, '[]'::JSONB)
      )
    )
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$function$;

COMMIT;
