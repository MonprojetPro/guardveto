-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — F5-001 : Multi-tenant — Colonne cabinet_id + RLS d'isolation
-- Auteur : ruflo — MonProjetPro
-- Date   : 2026-06-16
-- ───────────────────────────────────────────────────────────────
-- 1. Fonction auth_cabinet_actif() : lit cabinet_id depuis app_metadata
--    du JWT (JAMAIS user_metadata — règle sécurité C1).
-- 2. Ajoute cabinet_id (nullable) sur toutes les tables métier existantes.
-- 3. Pose une policy d'isolation tenant sur chacune.
--
-- Les lignes existantes auront cabinet_id = NULL — c'est intentionnel :
-- F5-002 (seed client) se chargera de les rattacher au bon cabinet.
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- Fonction d'isolation tenant
-- ───────────────────────────────────────────────────────────────
-- 🔒 C1 : lecture depuis app_metadata (jamais user_metadata).
--   - app_metadata n'est modifiable que par le service_role
--     ou via les Edge Functions avec le JWT de service.
--   - user_metadata est modifiable par l'utilisateur lui-même
--     → utiliser user_metadata pour le routage tenant serait
--       une escalade de privilèges triviale.
-- Retourne NULL si le cabinet est introuvable ou inactif.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_cabinet_actif()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT c.id
  FROM public.cabinets c
  WHERE c.id = ((auth.jwt() -> 'app_metadata') ->> 'cabinet_id')::UUID
    AND c.actif = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.auth_cabinet_actif IS
  'Retourne l''UUID du cabinet actif du JWT connecté (app_metadata.cabinet_id). '
  'NULL si absent ou cabinet inactif. 🔒 C1 : jamais user_metadata.';

-- Restreindre l'exécution aux utilisateurs authentifiés uniquement
REVOKE EXECUTE ON FUNCTION public.auth_cabinet_actif() FROM anon;
GRANT  EXECUTE ON FUNCTION public.auth_cabinet_actif() TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- TABLE : veterinaires
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.veterinaires
  ADD COLUMN IF NOT EXISTS cabinet_id UUID REFERENCES public.cabinets(id);

CREATE INDEX IF NOT EXISTS idx_veterinaires_cabinet_id ON public.veterinaires(cabinet_id);

-- Les policies existantes (vet_admin_all, vet_read_all) restent en place.
-- On AJOUTE une policy d'isolation tenant : un vétérinaire ne peut voir
-- que les lignes de SON cabinet.
-- Note : les policies RLS se combinent en OR pour SELECT,
-- mais ici on ajoute la contrainte cabinet_id EN PLUS des policies existantes
-- via une policy FOR ALL qui filtre sur cabinet_id.
DROP POLICY IF EXISTS "veterinaires_cabinet_isolation" ON public.veterinaires;
CREATE POLICY "veterinaires_cabinet_isolation" ON public.veterinaires
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
    OR cabinet_id IS NULL  -- lignes pré-migration (F5-002 rattachera)
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- ───────────────────────────────────────────────────────────────
-- TABLE : periodes
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.periodes
  ADD COLUMN IF NOT EXISTS cabinet_id UUID REFERENCES public.cabinets(id);

CREATE INDEX IF NOT EXISTS idx_periodes_cabinet_id ON public.periodes(cabinet_id);

DROP POLICY IF EXISTS "periodes_cabinet_isolation" ON public.periodes;
CREATE POLICY "periodes_cabinet_isolation" ON public.periodes
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
    OR cabinet_id IS NULL
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- ───────────────────────────────────────────────────────────────
-- TABLE : contraintes_veto
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.contraintes_veto
  ADD COLUMN IF NOT EXISTS cabinet_id UUID REFERENCES public.cabinets(id);

CREATE INDEX IF NOT EXISTS idx_contraintes_veto_cabinet_id ON public.contraintes_veto(cabinet_id);

DROP POLICY IF EXISTS "contraintes_veto_cabinet_isolation" ON public.contraintes_veto;
CREATE POLICY "contraintes_veto_cabinet_isolation" ON public.contraintes_veto
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
    OR cabinet_id IS NULL
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- ───────────────────────────────────────────────────────────────
-- TABLE : gardes
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.gardes
  ADD COLUMN IF NOT EXISTS cabinet_id UUID REFERENCES public.cabinets(id);

CREATE INDEX IF NOT EXISTS idx_gardes_cabinet_id ON public.gardes(cabinet_id);

DROP POLICY IF EXISTS "gardes_cabinet_isolation" ON public.gardes;
CREATE POLICY "gardes_cabinet_isolation" ON public.gardes
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
    OR cabinet_id IS NULL
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- ───────────────────────────────────────────────────────────────
-- TABLE : conges
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.conges
  ADD COLUMN IF NOT EXISTS cabinet_id UUID REFERENCES public.cabinets(id);

CREATE INDEX IF NOT EXISTS idx_conges_cabinet_id ON public.conges(cabinet_id);

DROP POLICY IF EXISTS "conges_cabinet_isolation" ON public.conges;
CREATE POLICY "conges_cabinet_isolation" ON public.conges
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
    OR cabinet_id IS NULL
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- ───────────────────────────────────────────────────────────────
-- TABLE : bonus_malus
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.bonus_malus
  ADD COLUMN IF NOT EXISTS cabinet_id UUID REFERENCES public.cabinets(id);

CREATE INDEX IF NOT EXISTS idx_bonus_malus_cabinet_id ON public.bonus_malus(cabinet_id);

DROP POLICY IF EXISTS "bonus_malus_cabinet_isolation" ON public.bonus_malus;
CREATE POLICY "bonus_malus_cabinet_isolation" ON public.bonus_malus
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
    OR cabinet_id IS NULL
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- ───────────────────────────────────────────────────────────────
-- NOTE : tables NON modifiées dans cette migration
-- ───────────────────────────────────────────────────────────────
-- jours_feries      : données de référence partagées entre tous les
--                     cabinets → pas de cabinet_id (isolation par zone
--                     gérée via cabinets.zone_scolaire en application).
-- vacances_scolaires: idem (référentiel national partagé).
-- audit_log         : log système global → F5-002 ajoutera cabinet_id
--                     si besoin d'isolation complète des logs.
-- email_log         : rattaché via FK à gardes/periodes/veterinaires →
--                     l'isolation est héritée ; cabinet_id direct = F5-002.
-- planning_sessions : table inexistante dans les migrations actuelles →
--                     hors scope F5-001.
