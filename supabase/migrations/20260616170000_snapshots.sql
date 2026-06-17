-- ============================================================
-- Migration : F8-001 — Table snapshots_regles + versionnement
-- Créée le   : 2026-06-16
-- Auteur     : ruflo / GuardVeto V2 Fondations
-- Dépendances: cabinets (F5-001), contraintes_veto (F5-001)
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- TABLE : snapshots_regles
-- Stocke l'état des règles actives au moment de la génération
-- d'un planning. Permet de rejouer ou d'auditer un planning
-- passé même si les règles ont évolué depuis.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.snapshots_regles (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id  UUID        NOT NULL REFERENCES public.cabinets(id),
  planning_id UUID        NULL,      -- FK vers periodes (complétée par F6-002)
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  regles_json JSONB       NOT NULL DEFAULT '{}'::JSONB
);

-- Index principal : retrouver tous les snapshots d'un cabinet
CREATE INDEX IF NOT EXISTS idx_snapshots_cabinet_id
  ON public.snapshots_regles(cabinet_id);

-- Index partiel : retrouver le snapshot lié à un planning donné
CREATE INDEX IF NOT EXISTS idx_snapshots_planning_id
  ON public.snapshots_regles(planning_id)
  WHERE planning_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- TABLE : regles_version_courante
-- Compteur de version par règle et par cabinet.
-- Incrémenté à chaque modification d'une règle (trigger futur).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.regles_version_courante (
  cabinet_id UUID        NOT NULL REFERENCES public.cabinets(id),
  regle_id   TEXT        NOT NULL,
  version    INTEGER     NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, regle_id)
);

-- ─────────────────────────────────────────────────────────────
-- RLS : snapshots_regles
-- Isolation stricte par cabinet : chaque cabinet ne voit
-- que ses propres snapshots.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.snapshots_regles ENABLE ROW LEVEL SECURITY;

-- DROP avant CREATE pour rester idempotent (CREATE POLICY n'a pas de IF NOT EXISTS).
DROP POLICY IF EXISTS "snapshots_cabinet_isolation" ON public.snapshots_regles;
CREATE POLICY "snapshots_cabinet_isolation" ON public.snapshots_regles
  FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- ─────────────────────────────────────────────────────────────
-- RLS : regles_version_courante
-- Même isolation cabinet que pour snapshots_regles.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.regles_version_courante ENABLE ROW LEVEL SECURITY;

-- DROP avant CREATE pour rester idempotent (CREATE POLICY n'a pas de IF NOT EXISTS).
DROP POLICY IF EXISTS "regles_version_cabinet_isolation" ON public.regles_version_courante;
CREATE POLICY "regles_version_cabinet_isolation" ON public.regles_version_courante
  FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- ─────────────────────────────────────────────────────────────
-- FONCTION : prendre_snapshot(p_planning_id, p_cabinet_id)
-- Copie l'état courant des contraintes actives du cabinet dans
-- snapshots_regles.regles_json, puis retourne le snapshot_id.
--
-- Appelée par le pipeline de génération (F6-002) juste après
-- la persistence du planning, pour garantir la traçabilité.
--
-- Sécurité : SECURITY DEFINER + search_path fixé pour éviter
-- toute injection via search_path. Accès restreint à
-- authenticated (révoqué pour anon).
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
  -- Construire le JSON des règles actives du cabinet.
  -- En V2 Fondations, on snapshote les contraintes_veto actives.
  SELECT jsonb_agg(
    jsonb_build_object(
      'id',          c.id,
      'type',        c.type_contrainte,
      'brique_type', c.brique_type,
      'config',      c.config_json,
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

-- Droits : restreindre anon, autoriser authenticated uniquement
REVOKE EXECUTE ON FUNCTION public.prendre_snapshot(UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.prendre_snapshot(UUID, UUID) TO authenticated;
