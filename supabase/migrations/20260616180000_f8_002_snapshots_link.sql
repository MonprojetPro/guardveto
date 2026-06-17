-- ============================================================
-- Migration : F8-002 — Lier chaque planning publié à son snapshot
-- Créée le   : 2026-06-16
-- Auteur     : ruflo / GuardVeto V2 Fondations
-- Dépendances: snapshots_regles (F8-001), periodes (F5-001)
--
-- Correctifs par rapport à F8-001 :
--   - prendre_snapshot référençait c.type_contrainte et c.config_json
--     alors que les colonnes réelles sont c.type et c.config
--     (bug découvert lors de F4-002)
--   - periodes.snapshot_id absent (lien manquant vers snapshots_regles)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- A) Corriger la fonction prendre_snapshot
--    Utilise CREATE OR REPLACE : idempotent, remplace la version F8-001.
--    Seul changement : c.type_contrainte → c.type, c.config_json → c.config
-- ─────────────────────────────────────────────────────────────
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
BEGIN
  -- ─────────────────────────────────────────────────────────
  -- Garde d'autorisation (SECURITY DEFINER + GRANT authenticated) :
  -- empêche un utilisateur authentifié de créer un snapshot dans un
  -- AUTRE cabinet que le sien. Le service_role (JWT nul, ex : pipeline
  -- de génération côté serveur) reste autorisé sans restriction.
  -- ─────────────────────────────────────────────────────────
  IF auth.jwt() IS NOT NULL AND p_cabinet_id IS DISTINCT FROM public.auth_cabinet_actif() THEN
    RAISE EXCEPTION 'prendre_snapshot: cabinet_id % non autorise pour ce JWT', p_cabinet_id;
  END IF;

  -- Construire le JSON des règles actives du cabinet.
  -- Utilise les colonnes réelles de contraintes_veto :
  --   c.type       (et non c.type_contrainte — bug F8-001)
  --   c.config     (et non c.config_json     — bug F8-001)
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',          c.id,
      'type',        c.type,
      'brique_type', c.brique_type,
      'config',      c.config,
      'actif',       c.actif
    )
  )
  INTO v_regles_json
  FROM public.contraintes_veto c
  WHERE c.cabinet_id = p_cabinet_id
    AND c.actif = true;

  INSERT INTO public.snapshots_regles (cabinet_id, planning_id, regles_json)
  VALUES (
    p_cabinet_id,
    p_planning_id,
    COALESCE(v_regles_json, '[]'::JSONB)
  )
  RETURNING id INTO v_snapshot_id;

  RETURN v_snapshot_id;
END;
$$;

-- Maintenir les mêmes droits que F8-001
REVOKE EXECUTE ON FUNCTION public.prendre_snapshot(UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.prendre_snapshot(UUID, UUID) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- B) Ajouter periodes.snapshot_id (nullable — lien vers snapshots_regles)
--    ADD COLUMN IF NOT EXISTS : idempotent, ne casse pas si déjà présent.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.periodes
  ADD COLUMN IF NOT EXISTS snapshot_id UUID
    REFERENCES public.snapshots_regles(id)
    ON DELETE SET NULL;

-- Index pour retrouver rapidement la période liée à un snapshot
CREATE INDEX IF NOT EXISTS idx_periodes_snapshot_id
  ON public.periodes(snapshot_id)
  WHERE snapshot_id IS NOT NULL;
