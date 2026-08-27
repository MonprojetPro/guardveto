-- ============================================================
-- GUARDVETO — prendre_snapshot capture AUSSI libelle_agenda
-- ============================================================
-- La colonne `creneau_modele.libelle_agenda` a été ajoutée le 27/08
-- (migration `20260827180000_agenda_google_socle.sql`, chantier agenda
-- Google). Mais `prendre_snapshot` liste les colonnes de `creneau_modele`
-- une par une dans son `jsonb_build_object` (dernière définition :
-- `20260804141000_rpc_socle_affinage.sql`) — une colonne ajoutée en base
-- n'apparaît donc PAS automatiquement dans le JSON figé.
--
-- Sans ce correctif, toute NOUVELLE génération continuerait de figer un
-- snapshot SANS `libelle_agenda`, et le replay (`creneauxDepuisSnapshot`,
-- `src/app/api/generate/replay/route.ts`, corrigé le même jour) retomberait
-- alors systématiquement sur `null` → `nom`, sans que rien ne le signale :
-- l'intitulé Google Agenda serait correct sur le planning vivant et
-- silencieusement vide sur tout planning rejoué.
--
-- CE QUE CETTE MIGRATION CHANGE, ET RIEN D'AUTRE : reprend la définition
-- exacte de `20260804141000_rpc_socle_affinage.sql` (même signature,
-- `SECURITY DEFINER`, `SET search_path TO 'public'` conservés à l'identique)
-- et ajoute une seule clé, `'libelle_agenda', cm.libelle_agenda`, au
-- `jsonb_build_object` du catalogue de créneaux. Aucun REVOKE/GRANT à
-- rejouer : ils survivent à un `CREATE OR REPLACE` sur la même signature.
-- ============================================================

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
      'ordre',            cm.ordre,
      'libelle_agenda',   cm.libelle_agenda
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
