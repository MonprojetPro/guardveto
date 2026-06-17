-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — F5-002 : Bootstrap du cabinet pilote
-- Auteur : ruflo — MonProjetPro
-- Date   : 2026-06-16
-- ───────────────────────────────────────────────────────────────
-- 1. Insère le cabinet pilote (Cabinet Vetovaldallie) avec un UUID
--    déterministe pour faciliter les seeds et la cohérence des refs.
-- 2. Rattache toutes les lignes existantes (cabinet_id IS NULL)
--    au cabinet pilote via UPDATE idempotent.
-- 3. Retire la clause transitoire « OR cabinet_id IS NULL » des
--    6 policies d'isolation tenant posées par F5-001.
--    Après cette migration, le multi-tenant est STRICT :
--    toute ligne sans cabinet_id valide est invisible pour les
--    utilisateurs authentifiés.
-- ═══════════════════════════════════════════════════════════════

-- UUID fixe et déterministe pour le cabinet pilote.
-- Facilite les références croisées dans les seeds futurs.
-- NOTE : ce UUID est dans la table `cabinets`, pas dans
-- `veterinaires` — aucun conflit avec les UUIDs des vétos
-- (004_seed.sql utilise les mêmes préfixes dans veterinaires).

-- ───────────────────────────────────────────────────────────────
-- 1. INSERTION DU CABINET PILOTE (idempotente)
-- ───────────────────────────────────────────────────────────────
INSERT INTO public.cabinets (
  id,
  nom,
  slug,
  actif,
  zone_scolaire,
  region_feries,
  timezone
)
VALUES (
  '00000000-0000-0000-0000-000000000001'::UUID,
  'Cabinet Vetovaldallie',
  'vetovaldallie',
  true,
  'A',
  'metropole',
  'Europe/Paris'
)
ON CONFLICT (slug) DO NOTHING;

-- ───────────────────────────────────────────────────────────────
-- 2. RATTACHEMENT DES DONNÉES EXISTANTES AU CABINET PILOTE
--    Idempotent : WHERE cabinet_id IS NULL garantit qu'une
--    2e exécution ne ré-écrase pas un cabinet_id déjà posé.
-- ───────────────────────────────────────────────────────────────

-- Vétérinaires (7 profils du cabinet pilote)
UPDATE public.veterinaires
  SET cabinet_id = '00000000-0000-0000-0000-000000000001'::UUID
  WHERE cabinet_id IS NULL;

-- Périodes de planification
UPDATE public.periodes
  SET cabinet_id = '00000000-0000-0000-0000-000000000001'::UUID
  WHERE cabinet_id IS NULL;

-- Contraintes individuelles des vétérinaires
UPDATE public.contraintes_veto
  SET cabinet_id = '00000000-0000-0000-0000-000000000001'::UUID
  WHERE cabinet_id IS NULL;

-- Gardes planifiées
UPDATE public.gardes
  SET cabinet_id = '00000000-0000-0000-0000-000000000001'::UUID
  WHERE cabinet_id IS NULL;

-- Congés et indisponibilités
UPDATE public.conges
  SET cabinet_id = '00000000-0000-0000-0000-000000000001'::UUID
  WHERE cabinet_id IS NULL;

-- Bonus/malus inter-périodes
UPDATE public.bonus_malus
  SET cabinet_id = '00000000-0000-0000-0000-000000000001'::UUID
  WHERE cabinet_id IS NULL;

-- ───────────────────────────────────────────────────────────────
-- 3. REMPLACEMENT DES POLICIES D'ISOLATION TENANT — VERSION STRICTE
--    Suppression de la clause transitoire « OR cabinet_id IS NULL »
--    posée par F5-001 pour permettre la migration en douceur.
--    Après cette migration, seules les lignes avec un cabinet_id
--    valide et correspondant au JWT sont visibles.
-- ───────────────────────────────────────────────────────────────

-- TABLE : veterinaires
DROP POLICY IF EXISTS "veterinaires_cabinet_isolation" ON public.veterinaires;
CREATE POLICY "veterinaires_cabinet_isolation" ON public.veterinaires
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- TABLE : periodes
DROP POLICY IF EXISTS "periodes_cabinet_isolation" ON public.periodes;
CREATE POLICY "periodes_cabinet_isolation" ON public.periodes
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- TABLE : contraintes_veto
DROP POLICY IF EXISTS "contraintes_veto_cabinet_isolation" ON public.contraintes_veto;
CREATE POLICY "contraintes_veto_cabinet_isolation" ON public.contraintes_veto
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- TABLE : gardes
DROP POLICY IF EXISTS "gardes_cabinet_isolation" ON public.gardes;
CREATE POLICY "gardes_cabinet_isolation" ON public.gardes
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- TABLE : conges
DROP POLICY IF EXISTS "conges_cabinet_isolation" ON public.conges;
CREATE POLICY "conges_cabinet_isolation" ON public.conges
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- TABLE : bonus_malus
DROP POLICY IF EXISTS "bonus_malus_cabinet_isolation" ON public.bonus_malus;
CREATE POLICY "bonus_malus_cabinet_isolation" ON public.bonus_malus
  FOR ALL TO authenticated
  USING (
    cabinet_id = auth_cabinet_actif()
  )
  WITH CHECK (
    cabinet_id = auth_cabinet_actif()
  );

-- ───────────────────────────────────────────────────────────────
-- NOTE POST-MIGRATION : action manuelle requise sur le 1er admin
-- ───────────────────────────────────────────────────────────────
-- L'admin pilote (Anne-So) doit avoir son app_metadata mis à jour
-- pour que auth_cabinet_actif() lui retourne le bon UUID.
--
-- Via Supabase Dashboard → Authentication → Users → Anne-So :
-- app_metadata : { "cabinet_id": "00000000-0000-0000-0000-000000000001" }
--
-- Ou via API service_role :
-- UPDATE auth.users
--   SET raw_app_meta_data = raw_app_meta_data ||
--       '{"cabinet_id": "00000000-0000-0000-0000-000000000001"}'::jsonb
--   WHERE email = '<email anne-so>';
-- ───────────────────────────────────────────────────────────────
