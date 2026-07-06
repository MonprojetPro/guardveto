-- ============================================================
-- GUARDVETO — RG1 (relations génériques, tranche 1) : dupliquer_profil v2
-- copie AUSSI les relations entre créneaux (avec remap des ids)
-- ============================================================
-- La v1 (20260702170000) copiait le catalogue `creneau_modele` mais pas les
-- relations `relation_creneau` (elles n'existaient pas en donnée). Sans cette
-- v2, dupliquer un profil perdrait silencieusement ses relations (ex R8/R9)
-- → le profil copié planifierait SANS liaison vendredi↔WE. Consumer inspecté
-- au moment où la donnée prend vie (règle INSPECTION DES CONSUMERS).
--
-- REMAP : les créneaux copiés reçoivent de NOUVEAUX ids ; on apparie
-- l'ancien créneau au nouveau par (code, nom) — tous deux uniques PAR PROFIL
-- (20260702180000) et recopiés à l'identique → l'appariement est bijectif.
--
-- SÉCURITÉ : SECURITY INVOKER (défaut) conservé → RLS de l'appelant (admin
-- de SON cabinet). Cabinet dérivé du JWT, jamais d'un paramètre client.
-- ATOMICITÉ : même transaction que la copie du catalogue — tout ou rien.
-- IDEMPOTENCE : CREATE OR REPLACE. RÉVERSIBLE : réappliquer la v1.
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

  IF v_source IS NOT NULL THEN
    -- 2. Copie du catalogue de la source (nouveaux ids, même contenu).
    INSERT INTO public.creneau_modele
      (cabinet_id, profil_id, code, nom, jours_semaine, sur_feries,
       heure_debut, heure_fin, offset_jours_fin, nb_places, roles, actif, ordre)
    SELECT
      cabinet_id, v_new, code, nom, jours_semaine, sur_feries,
      heure_debut, heure_fin, offset_jours_fin, nb_places, roles, actif, ordre
    FROM public.creneau_modele
    WHERE cabinet_id = v_cabinet AND profil_id = v_source;

    -- 3. Copie des relations de la source, ids remappés vers les créneaux
    --    copiés — appariement par (code, nom), uniques par profil.
    INSERT INTO public.relation_creneau
      (cabinet_id, profil_id, source_id, cible_id, genre, actif)
    SELECT
      rc.cabinet_id, v_new, ns.id, nc.id, rc.genre, rc.actif
    FROM public.relation_creneau rc
    JOIN public.creneau_modele os ON os.id = rc.source_id           -- ancien source
    JOIN public.creneau_modele oc ON oc.id = rc.cible_id            -- ancien cible
    JOIN public.creneau_modele ns                                   -- nouveau source
      ON  ns.profil_id = v_new
      AND ns.code IS NOT DISTINCT FROM os.code
      AND ns.nom = os.nom
    JOIN public.creneau_modele nc                                   -- nouveau cible
      ON  nc.profil_id = v_new
      AND nc.code IS NOT DISTINCT FROM oc.code
      AND nc.nom = oc.nom
    WHERE rc.cabinet_id = v_cabinet AND rc.profil_id = v_source
    ON CONFLICT (cabinet_id, source_id, cible_id, genre) DO NOTHING;
  END IF;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dupliquer_profil(text, uuid, text, int) FROM anon;
GRANT  EXECUTE ON FUNCTION public.dupliquer_profil(text, uuid, text, int) TO authenticated;
