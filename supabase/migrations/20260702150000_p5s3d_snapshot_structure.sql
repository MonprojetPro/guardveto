-- ============================================================
-- GUARDVETO — P5 slice 3d : le snapshot fige AUSSI la structure (catalogue)
-- ============================================================
-- PROBLÈME résiduel après C1 (2026-06-22) :
--   prendre_snapshot capturait les règles + l'effectif de la PÉRIODE, mais PAS
--   le CATALOGUE de créneaux (creneau_modele). Le replay reconstruisait donc les
--   créneaux depuis le catalogue VIVANT → régénérer après une évolution du profil
--   ne redonnait pas le même planning (rejouabilité mensongère sur la structure).
--
-- CORRECTIF (schéma v3) :
--   On résout le PROFIL de la période (periodes.profil_id, sinon profil défaut du
--   cabinet) et on capture SON catalogue `creneau_modele` + l'effectif RÉSOLU
--   (période > profil). Le replay reconstruit alors les créneaux depuis le
--   snapshot (slice 3d côté TS), comme il reconstruit déjà les règles.
--
-- FORME DU JSON (schéma v3) :
--   {
--     "schema": 3,
--     "regles_cabinet": [ ... ],                  -- inchangé (C1)
--     "effectif": { "nb_vetos_semaine_soir": <int|null> },  -- RÉSOLU période>profil
--     "structure": {
--       "profil_id": <uuid|null>,
--       "creneau_modele": [ { id, code, nom, jours_semaine, sur_feries,
--                             heure_debut, heure_fin, offset_jours_fin,
--                             nb_places, roles, actif, ordre }, ... ]
--     }
--   }
--   Les schémas antérieurs (v2 objet, v1 tableau legacy) restent lisibles par le
--   replay ; pour eux, les créneaux continuent de venir du catalogue vivant.
--   (Les relation_creneau ne sont pas capturées : le moteur ne les consomme pas
--   encore — à ajouter au snapshot quand elles seront branchées.)
--
-- SÉCURITÉ : garde d'autorisation (JWT → cabinet) et search_path figé CONSERVÉS
--   à l'identique. Chaque capture de structure est best-effort (EXCEPTION →
--   valeur NULL) : jamais un souci de structure ne doit faire échouer le snapshot
--   des règles. IDEMPOTENCE : CREATE OR REPLACE. RÉVERSIBLE : réappliquer C1.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prendre_snapshot(
  p_planning_id UUID,
  p_cabinet_id  UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_snapshot_id UUID;
  v_regles_json JSONB;
  v_effectif    INTEGER;
  v_profil_id   UUID;
  v_creneaux    JSONB;
BEGIN
  -- Garde d'autorisation (inchangée vs C1) : un JWT ne snapshote que SON cabinet ;
  -- le service_role (JWT nul, pipeline serveur) reste autorisé sans restriction.
  IF auth.jwt() IS NOT NULL AND p_cabinet_id IS DISTINCT FROM public.auth_cabinet_actif() THEN
    RAISE EXCEPTION 'prendre_snapshot: cabinet_id % non autorise pour ce JWT', p_cabinet_id;
  END IF;

  -- 1. Règles actives (permanentes + propres à la période), comme le loader.
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

  -- 2. Profil de la période (choisi, sinon profil défaut du cabinet) — best-effort.
  BEGIN
    SELECT COALESCE(
      (SELECT profil_id FROM public.periodes WHERE id = p_planning_id),
      (SELECT id FROM public.profils_planning
         WHERE cabinet_id = p_cabinet_id AND est_defaut LIMIT 1)
    ) INTO v_profil_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    v_profil_id := NULL;
  END;

  -- 3. Effectif RÉSOLU (précédence période > profil) — best-effort.
  BEGIN
    SELECT COALESCE(
      (SELECT nb_vetos_semaine_soir FROM public.periodes WHERE id = p_planning_id),
      (SELECT nb_vetos_semaine_soir FROM public.profils_planning WHERE id = v_profil_id)
    ) INTO v_effectif;
  EXCEPTION WHEN undefined_column THEN
    v_effectif := NULL;
  END;

  -- 4. Catalogue de créneaux du profil (la structure figée) — best-effort.
  BEGIN
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
        'nb_places',        cm.nb_places,
        'roles',            cm.roles,
        'actif',            cm.actif,
        'ordre',            cm.ordre
      )
      ORDER BY cm.ordre
    )
    INTO v_creneaux
    FROM public.creneau_modele cm
    WHERE cm.cabinet_id = p_cabinet_id
      AND cm.profil_id = v_profil_id;
  EXCEPTION WHEN undefined_column OR undefined_table THEN
    v_creneaux := NULL;
  END;

  -- 5. Écrire le snapshot (schéma v3).
  INSERT INTO public.snapshots_regles (cabinet_id, planning_id, regles_json)
  VALUES (
    p_cabinet_id,
    p_planning_id,
    jsonb_build_object(
      'schema',         3,
      'regles_cabinet', COALESCE(v_regles_json, '[]'::JSONB),
      'effectif',       jsonb_build_object('nb_vetos_semaine_soir', v_effectif),
      'structure',      jsonb_build_object(
        'profil_id',      v_profil_id,
        'creneau_modele', COALESCE(v_creneaux, '[]'::JSONB)
      )
    )
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prendre_snapshot(UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.prendre_snapshot(UUID, UUID) TO authenticated;
