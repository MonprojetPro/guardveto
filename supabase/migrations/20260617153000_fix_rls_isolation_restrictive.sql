-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Fix faille RLS : isolation tenant en RESTRICTIVE
-- Auteur : ruflo — MonProjetPro
-- Date   : 2026-06-17
-- ───────────────────────────────────────────────────────────────
-- ⚠️ MIGRATION DE SÉCURITÉ — NE PAS APPLIQUER SANS RELECTURE DU LEAD
--    (test E2E `roles.spec.ts` a prouvé l'escalade : un véto a réussi
--     un INSERT dans `veterinaires`).
--
-- PROBLÈME (escalade de privilèges via combinaison OR de policies)
--   PostgreSQL combine les policies PERMISSIVES avec OR. Pour écrire,
--   il suffit qu'UNE policy permissive accorde le droit (WITH CHECK).
--
--   Les policies d'isolation tenant posées par F5-001 / F5-002 sont :
--     FOR ALL TO authenticated
--     USING      (cabinet_id = auth_cabinet_actif())
--     WITH CHECK (cabinet_id = auth_cabinet_actif())
--   → PERMISSIVES. Elles ACCORDENT donc INSERT/UPDATE/DELETE à TOUT
--     utilisateur authentifié du cabinet, court-circuitant les policies
--     de rôle V1 (`*_admin_all` réservées aux admins, `conges_veto_*`
--     bornées aux souhaits du véto lui-même).
--
--   Conséquence par table métier :
--     • veterinaires    : un véto peut créer/modifier/supprimer un véto
--                         (au-delà de vet_admin_all). [PROUVÉ]
--     • periodes        : un véto peut créer/modifier des périodes.
--     • gardes          : un véto peut créer/modifier des gardes.
--     • contraintes_veto: un véto peut créer/modifier des contraintes.
--     • bonus_malus     : un véto peut écrire des bilans.
--     • conges          : un véto peut insérer un congé de N'IMPORTE
--                         quel statut / pour un AUTRE véto de son cabinet
--                         (au-delà de conges_veto_insert_souhait).
--
-- CORRECTIF (approche propre : isolation RESTRICTIVE)
--   On remplace chaque policy d'isolation PERMISSIVE par une policy
--   AS RESTRICTIVE. Une policy restrictive est combinée en AND avec les
--   permissives : elle BORNE l'accès au cabinet SANS rien accorder.
--   Les policies de rôle V1 (permissives) redeviennent seules juges du
--   « qui peut faire quoi », tout en restant confinées au cabinet.
--
--   Effet net par opération (exemple veterinaires) :
--     INSERT véto  : permissive(vet_admin_all=FALSE) → AUCUNE permissive
--                    n'accorde → REFUSÉ. ✅ (escalade corrigée)
--     INSERT admin : permissive(vet_admin_all=TRUE) AND restrictive(
--                    cabinet_id = auth_cabinet_actif()=son cabinet=TRUE)
--                    → AUTORISÉ. ✅ (admin non enfermé)
--     SELECT véto  : permissive(vet_read_all=TRUE) AND restrictive(
--                    cabinet match=TRUE) → lit SON cabinet seulement. ✅
--     Cross-tenant : restrictive=FALSE → REFUSÉ quel que soit le rôle. ✅
--
-- NON-RÉGRESSION vérifiée logiquement
--   • L'admin garde tous ses droits sur SON cabinet (restrictive matche).
--   • Le véto garde sa lecture (vet_read_all) + ses souhaits congés
--     (conges_veto_*), bornés à son cabinet.
--   • Fail-closed : si auth_cabinet_actif() = NULL (app_metadata absent),
--     cabinet_id = NULL → NULL (faux) → l'utilisateur ne voit/écrit rien.
--     C'est le comportement strict déjà voulu par F5-002.
--
-- IDEMPOTENCE : DROP POLICY IF EXISTS avant chaque CREATE. Atomique
--   (transaction). Ne modifie AUCUNE donnée — uniquement des policies.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE : veterinaires
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "veterinaires_cabinet_isolation" ON public.veterinaires;
CREATE POLICY "veterinaires_cabinet_isolation" ON public.veterinaires
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- ───────────────────────────────────────────────────────────────
-- TABLE : periodes
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "periodes_cabinet_isolation" ON public.periodes;
CREATE POLICY "periodes_cabinet_isolation" ON public.periodes
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- ───────────────────────────────────────────────────────────────
-- TABLE : contraintes_veto
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "contraintes_veto_cabinet_isolation" ON public.contraintes_veto;
CREATE POLICY "contraintes_veto_cabinet_isolation" ON public.contraintes_veto
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- ───────────────────────────────────────────────────────────────
-- TABLE : gardes
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "gardes_cabinet_isolation" ON public.gardes;
CREATE POLICY "gardes_cabinet_isolation" ON public.gardes
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- ───────────────────────────────────────────────────────────────
-- TABLE : conges
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "conges_cabinet_isolation" ON public.conges;
CREATE POLICY "conges_cabinet_isolation" ON public.conges
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- ───────────────────────────────────────────────────────────────
-- TABLE : bonus_malus
-- ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "bonus_malus_cabinet_isolation" ON public.bonus_malus;
CREATE POLICY "bonus_malus_cabinet_isolation" ON public.bonus_malus
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- ───────────────────────────────────────────────────────────────
-- NOTE — Écritures applicatives via service_role
-- ───────────────────────────────────────────────────────────────
-- Le service_role BYPASSE la RLS : l'onboarding (création de cabinet,
-- d'admin, rattachement user_id) et les Server Actions qui utilisent le
-- service_role ne sont PAS impactés par ce durcissement.
--
-- ATTENTION — point à vérifier par le lead AVANT application :
--   Si des Server Actions « admin » écrivent dans ces tables via le
--   client ANON authentifié (et non le service_role), elles dépendent
--   désormais STRICTEMENT de :
--     (a) la policy de rôle permissive (*_admin_all) → l'utilisateur
--         doit bien avoir role_app='admin' ; ET
--     (b) la policy restrictive → cabinet_id de la ligne = cabinet du JWT.
--   C'est le comportement voulu, mais à valider sur les parcours admin
--   réels (création de période, génération de gardes, validation congés)
--   pour s'assurer qu'aucune écriture légitime ne passe par un chemin
--   qui ne renseignerait pas correctement cabinet_id.
-- ───────────────────────────────────────────────────────────────

COMMIT;
