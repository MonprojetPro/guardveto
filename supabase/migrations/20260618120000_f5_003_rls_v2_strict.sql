-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — F5-003 : Multi-tenant strict — durcissement RLS V2
-- Auteur : MAX (MPP) + ruflo — MonProjetPro
-- Date   : 2026-06-18
-- ───────────────────────────────────────────────────────────────
-- ⚠️ MIGRATION DE SÉCURITÉ — NE PAS APPLIQUER SANS RELECTURE DU LEAD.
--
-- CONTEXTE
--   Le fix 20260617153000 a corrigé l'escalade de privilèges sur les
--   6 tables V1 (isolation passée en RESTRICTIVE). Les tables V2 créées
--   par les Fondations (F1-001, F8-001) ont reproduit le MÊME pattern
--   vulnérable : une unique policy d'isolation PERMISSIVE `FOR ALL`.
--
-- PROBLÈME (escalade intra-cabinet)
--   Une policy PERMISSIVE `FOR ALL USING/WITH CHECK (cabinet_id =
--   auth_cabinet_actif())` ACCORDE INSERT/UPDATE/DELETE à TOUT
--   utilisateur authentifié du cabinet — y compris un simple `veto`.
--   Conséquences sur les tables V2 :
--     • attributions          : un véto peut réécrire / supprimer le
--                               planning de son cabinet. [escalade]
--     • snapshots_regles      : un véto peut falsifier l'historique
--                               d'audit des règles. [escalade]
--     • regles_version_courante : idem.
--   Fuite de métadonnées :
--     • cabinets : `cabinets_select USING (true)` laisse tout user lire
--                  la liste de TOUS les cabinets (nom, slug, zone).
--
-- CORRECTIF (modèle identique à V1 : isolation RESTRICTIVE + rôle PERMISSIVE)
--   1. attributions : isolation RESTRICTIVE (borne au cabinet sans rien
--      accorder) + écriture PERMISSIVE réservée à l'admin + lecture
--      PERMISSIVE pour tout authentifié (les vétos voient le planning).
--   2. snapshots_regles / regles_version_courante : isolation
--      RESTRICTIVE + lecture seule. AUCUNE écriture directe : le seul
--      chemin d'écriture légitime est la RPC `prendre_snapshot`
--      (SECURITY DEFINER + garde cabinet → bypasse la RLS proprement).
--   3. cabinets : lecture restreinte à SON propre cabinet.
--
--   Effet net (exemple attributions) :
--     INSERT véto  : aucune permissive INSERT n'accorde (admin_write
--                    WITH CHECK get_user_role()='admin' = FALSE) → REFUSÉ ✅
--     INSERT admin : admin_write (TRUE) AND restrictive (cabinet match)
--                    → AUTORISÉ ✅
--     SELECT véto  : read_auth (TRUE) AND restrictive (cabinet match)
--                    → lit SON cabinet uniquement ✅
--     Cross-tenant : restrictive = FALSE → REFUSÉ quel que soit le rôle ✅
--
-- INSPECTION CONSUMERS (règle MPP — vérifié avant écriture)
--   • src/data/persisterResultat.ts écrit `attributions` via le client
--     AUTHENTIFIÉ de l'admin qui génère → couvert par attributions_admin_write.
--   • src/engine/loader.ts lit `cabinets` filtré `.eq('id', cabinetId)`
--     (= cabinet courant) → couvert par cabinets_select (id = actif).
--   • src/app/api/generate/replay lit `snapshots_regles` (admin) → couvert
--     par snapshots_read_auth.
--
-- IDEMPOTENCE : DROP POLICY IF EXISTS avant chaque CREATE. Transaction
--   atomique. Ne modifie AUCUNE donnée — uniquement des policies.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE : attributions  (le planning — vérité des affectations)
-- ───────────────────────────────────────────────────────────────
-- 1. Isolation cabinet → RESTRICTIVE (combinée en AND, ne donne aucun droit)
DROP POLICY IF EXISTS "attributions_cabinet_isolation" ON public.attributions;
CREATE POLICY "attributions_cabinet_isolation" ON public.attributions
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- 2. Écriture réservée à l'admin (PERMISSIVE)
DROP POLICY IF EXISTS "attributions_admin_write" ON public.attributions;
CREATE POLICY "attributions_admin_write" ON public.attributions
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 3. Lecture pour tout authentifié (PERMISSIVE) — la restrictive borne au cabinet
DROP POLICY IF EXISTS "attributions_read_auth" ON public.attributions;
CREATE POLICY "attributions_read_auth" ON public.attributions
  FOR SELECT TO authenticated
  USING (true);

-- ───────────────────────────────────────────────────────────────
-- TABLE : snapshots_regles  (audit / rejouabilité — lecture seule)
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "snapshots_cabinet_isolation" ON public.snapshots_regles;
CREATE POLICY "snapshots_cabinet_isolation" ON public.snapshots_regles
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

DROP POLICY IF EXISTS "snapshots_read_auth" ON public.snapshots_regles;
CREATE POLICY "snapshots_read_auth" ON public.snapshots_regles
  FOR SELECT TO authenticated
  USING (true);
-- ⚠️ Aucune policy INSERT/UPDATE/DELETE pour authenticated.
--    L'écriture légitime passe par prendre_snapshot() (SECURITY DEFINER).

-- ───────────────────────────────────────────────────────────────
-- TABLE : regles_version_courante  (compteur de versions — lecture seule)
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "regles_version_cabinet_isolation" ON public.regles_version_courante;
CREATE POLICY "regles_version_cabinet_isolation" ON public.regles_version_courante
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

DROP POLICY IF EXISTS "regles_version_read_auth" ON public.regles_version_courante;
CREATE POLICY "regles_version_read_auth" ON public.regles_version_courante
  FOR SELECT TO authenticated
  USING (true);
-- ⚠️ Aucune écriture directe : réservée au service_role / triggers (hors RLS).

-- ───────────────────────────────────────────────────────────────
-- TABLE : cabinets  (défense en profondeur — lecture de SON cabinet)
-- ───────────────────────────────────────────────────────────────
-- Avant : USING (true) → un user voyait la liste de tous les cabinets.
-- Après : un user ne lit que la ligne de son propre cabinet.
-- L'onboarding (création de cabinet) reste via service_role (bypass RLS).
DROP POLICY IF EXISTS "cabinets_select" ON public.cabinets;
CREATE POLICY "cabinets_select" ON public.cabinets
  FOR SELECT TO authenticated
  USING (id = auth_cabinet_actif());

COMMIT;
