-- ============================================================
-- GUARDVETO — P5 slice 4a : RPC atomique dupliquer_profil
-- ============================================================
-- Créer un profil de planning = insérer la ligne `profils_planning` PUIS copier
-- le catalogue `creneau_modele` d'un profil source. Ces écritures multiples
-- doivent être ATOMIQUES : sinon un échec en cours laisserait un profil VIDE
-- (aucun type de garde → planning ingénérable). Une fonction plpgsql s'exécute
-- dans la transaction de l'appelant → tout ou rien.
--
-- SÉCURITÉ : SECURITY INVOKER (défaut) → la RLS s'applique AVEC les droits de
-- l'appelant. Les INSERT ne passent que si l'appelant est admin de SON cabinet
-- (policies admin_write + isolation restrictive de chaque table). Le cabinet est
-- dérivé du JWT via auth_cabinet_actif() — jamais d'un paramètre client.
--
-- La source (p_source_profil_id) est bornée au cabinet ; NULL → profil défaut.
-- Le nom en doublon lève unique_violation (profils_planning_nom_unique) → la
-- transaction est annulée et l'appelant reçoit l'erreur.
-- ============================================================

CREATE OR REPLACE FUNCTION public.dupliquer_profil(
  p_nom              text,
  p_source_profil_id uuid DEFAULT NULL,
  p_saison           text DEFAULT NULL,
  p_effectif         int  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_cabinet uuid;
  v_source  uuid;
  v_new     uuid;
  v_ordre   smallint;
BEGIN
  v_cabinet := public.auth_cabinet_actif();
  IF v_cabinet IS NULL THEN
    RAISE EXCEPTION 'dupliquer_profil: cabinet introuvable pour ce JWT';
  END IF;

  IF p_nom IS NULL OR btrim(p_nom) = '' THEN
    RAISE EXCEPTION 'dupliquer_profil: nom de profil vide';
  END IF;

  -- Profil source : celui demandé (borné au cabinet), sinon le profil défaut.
  SELECT id INTO v_source
  FROM public.profils_planning
  WHERE cabinet_id = v_cabinet
    AND (id = p_source_profil_id OR (p_source_profil_id IS NULL AND est_defaut))
  ORDER BY est_defaut DESC
  LIMIT 1;

  -- Ordre = juste après le dernier profil du cabinet.
  SELECT COALESCE(MAX(ordre), 0) + 1 INTO v_ordre
  FROM public.profils_planning
  WHERE cabinet_id = v_cabinet;

  -- 1. Nouveau profil (jamais défaut : le défaut reste unique et intangible).
  INSERT INTO public.profils_planning
    (cabinet_id, nom, actif, est_defaut, saison_suggeree, nb_vetos_semaine_soir, ordre)
  VALUES
    (v_cabinet, btrim(p_nom), true, false, p_saison, p_effectif, v_ordre)
  RETURNING id INTO v_new;

  -- 2. Copie du catalogue de la source (nouveaux ids, même contenu).
  IF v_source IS NOT NULL THEN
    INSERT INTO public.creneau_modele
      (cabinet_id, profil_id, code, nom, jours_semaine, sur_feries,
       heure_debut, heure_fin, offset_jours_fin, nb_places, roles, actif, ordre)
    SELECT
      cabinet_id, v_new, code, nom, jours_semaine, sur_feries,
      heure_debut, heure_fin, offset_jours_fin, nb_places, roles, actif, ordre
    FROM public.creneau_modele
    WHERE cabinet_id = v_cabinet AND profil_id = v_source;
  END IF;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dupliquer_profil(text, uuid, text, int) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dupliquer_profil(text, uuid, text, int) TO authenticated;
