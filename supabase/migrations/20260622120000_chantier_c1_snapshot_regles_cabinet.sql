-- ============================================================
-- GUARDVETO — Chantier C1 : le snapshot capture les VRAIES règles
-- Auteur : MAX — MonProjetPro
-- Date   : 2026-06-22
-- ------------------------------------------------------------
-- PROBLÈME (dette de fond, audit 2026-06-21) :
--   prendre_snapshot copiait `contraintes_veto` (source LEGACY V1) alors
--   que le moteur lit `regles_cabinet` depuis P1A-004. Conséquence : la
--   photo des règles ne contenait NI l'équité (`equilibrer`), NI la
--   structure R8/R9 (`liaison_creneaux`/`inversion_role`), NI l'effectif
--   configurable (`periodes.nb_vetos_semaine_soir`). Rejouer un planning
--   passé appliquait donc l'équité/structure d'AUJOURD'HUI → rejouabilité
--   mensongère (« coquille »).
--
-- CORRECTIF :
--   On capture les lignes `regles_cabinet` brutes (actives, permanentes +
--   propres à la période générée) telles que le loader les consomme, PLUS
--   l'effectif configurable de la période. Le replay (F8-002) reconstruit
--   alors le contexte via les MÊMES mappers que le loader.
--
-- FORME DU JSON (nouveau schéma versionné) :
--   {
--     "schema": 2,
--     "regles_cabinet": [ { id, cabinet_id, periode_id, brique_id,
--                           params_json, force, validite_json, version,
--                           actif }, ... ],
--     "effectif": { "nb_vetos_semaine_soir": <int|null> }
--   }
--   L'ancien schéma (tableau de contraintes_veto) reste lisible par le
--   replay, qui détecte la forme (tableau = legacy v1, objet = v2).
--
-- SÉCURITÉ : on conserve à l'identique la garde d'autorisation de F8-002
--   (SECURITY DEFINER + search_path figé + contrôle cabinet via JWT).
-- IDEMPOTENCE : CREATE OR REPLACE. AUCUNE donnée modifiée.
-- RÉVERSIBLE : réappliquer la migration F8-002 restaure l'ancienne version.
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
BEGIN
  -- ─────────────────────────────────────────────────────────
  -- Garde d'autorisation (inchangée vs F8-002) : un utilisateur
  -- authentifié ne peut snapshoter que SON cabinet. Le service_role
  -- (JWT nul, pipeline serveur) reste autorisé sans restriction.
  -- ─────────────────────────────────────────────────────────
  IF auth.jwt() IS NOT NULL AND p_cabinet_id IS DISTINCT FROM public.auth_cabinet_actif() THEN
    RAISE EXCEPTION 'prendre_snapshot: cabinet_id % non autorise pour ce JWT', p_cabinet_id;
  END IF;

  -- ─────────────────────────────────────────────────────────
  -- 1. Règles actives du cabinet, scopées comme le loader (P1A-004) :
  --    permanentes (periode_id NULL) OU propres à la période générée.
  --    On capture la ligne BRUTE pour pouvoir la rejouer à l'identique
  --    (briques par-véto + équité `equilibrer` + structure R8/R9).
  -- ─────────────────────────────────────────────────────────
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

  -- ─────────────────────────────────────────────────────────
  -- 2. Effectif configurable de la période (structure capturée pour
  --    un rejeu fidèle). DÉFENSIF : la colonne nb_vetos_semaine_soir
  --    peut ne pas exister sur un déploiement antérieur à sa migration
  --    → on retombe sur NULL sans casser la fonction.
  -- ─────────────────────────────────────────────────────────
  BEGIN
    SELECT nb_vetos_semaine_soir
    INTO v_effectif
    FROM public.periodes
    WHERE id = p_planning_id;
  EXCEPTION
    WHEN undefined_column THEN
      v_effectif := NULL;
  END;

  -- ─────────────────────────────────────────────────────────
  -- 3. Écrire le snapshot (schéma v2, objet versionné).
  -- ─────────────────────────────────────────────────────────
  INSERT INTO public.snapshots_regles (cabinet_id, planning_id, regles_json)
  VALUES (
    p_cabinet_id,
    p_planning_id,
    jsonb_build_object(
      'schema',         2,
      'regles_cabinet', COALESCE(v_regles_json, '[]'::JSONB),
      'effectif',       jsonb_build_object('nb_vetos_semaine_soir', v_effectif)
    )
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;

-- Maintenir les mêmes droits que F8-001/F8-002
REVOKE EXECUTE ON FUNCTION public.prendre_snapshot(UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.prendre_snapshot(UUID, UUID) TO authenticated;
