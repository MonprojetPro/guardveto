-- ============================================================
-- GUARDVETO — Migration : durcissement email_log (monitoring, audit 360°)
-- Date   : 2026-07-06
-- Backlog : #9 (traçabilité des emails) + #10a (fuite inter-tenant)
-- ============================================================
-- Trois corrections, toutes RÉVERSIBLES et idempotentes :
--
--   1. CHECK type élargi — la contrainte d'origine (migration 006) n'autorise
--      que 'planning_publie' et 'garde_modifiee'. Or le code journalise DÉJÀ
--      trois autres types ('rappel_publication', 'appel_volontaires',
--      'depannage_confirme'). Ces INSERT sont SILENCIEUSEMENT rejetés par la
--      contrainte → trou de traçabilité. On élargit la liste aux 5 types réels.
--
--   2. FUITE INTER-TENANT (🔴, #10a) — la policy de lecture existante
--      `admin_read_email_log` est USING (get_user_role() = 'admin') SANS aucune
--      borne cabinet : dès 2 cabinets, un admin lit les logs email de TOUS les
--      cabinets. On la remplace par un couple :
--        • PERMISSIVE  : qui peut lire  → un admin
--        • RESTRICTIVE : jusqu'où       → uniquement les lignes de SON cabinet
--      (borne dérivée via veterinaire_id/periode_id, email_log n'ayant pas de
--       colonne cabinet_id — décision F5-001 : isolation héritée par FK).
--      Modèle « isolation = policy RESTRICTIVE » (leçon rls-isolation-doit-etre-
--      restrictive : une PERMISSIVE FOR ALL laisserait une brèche).
--
--   3. INSERT sous RLS — la RLS est active mais AUCUNE policy INSERT n'existe :
--      les écritures via un client RLS-aware (session admin, ex. publication)
--      sont bloquées ; seul le service_role (cron, crise) passe. On autorise
--      l'INSERT aux admins pour que la journalisation fonctionne aussi hors
--      service_role. WITH CHECK borné au rôle admin (le contenu est construit
--      côté serveur ; la lecture reste, elle, bornée au cabinet).
--
-- RÉVERSIBLE :
--   ALTER TABLE email_log DROP CONSTRAINT email_log_type_check;
--   ALTER TABLE email_log ADD  CONSTRAINT email_log_type_check
--     CHECK (type IN ('planning_publie','garde_modifiee'));
--   DROP POLICY email_log_admin_read       ON email_log;
--   DROP POLICY email_log_cabinet_isolation ON email_log;
--   DROP POLICY email_log_admin_insert      ON email_log;
--   (et recréer admin_read_email_log si besoin)
-- ============================================================

-- 1. Élargir la contrainte de type aux 5 types réellement journalisés ────────
ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_type_check;
ALTER TABLE public.email_log
  ADD CONSTRAINT email_log_type_check
  CHECK (type IN (
    'planning_publie',
    'garde_modifiee',
    'rappel_publication',
    'appel_volontaires',
    'depannage_confirme'
  ));

-- 2. RLS de lecture : admin (permissive) BORNÉ au cabinet (restrictive) ──────
-- On retire l'ancienne policy fuyante quelque soit son nom historique.
DROP POLICY IF EXISTS admin_read_email_log            ON public.email_log;
DROP POLICY IF EXISTS email_log_admin_read            ON public.email_log;
DROP POLICY IF EXISTS email_log_cabinet_isolation     ON public.email_log;

-- Qui peut lire : un administrateur authentifié.
CREATE POLICY email_log_admin_read ON public.email_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (get_user_role() = 'admin');

-- Jusqu'où : uniquement les lignes rattachées à SON cabinet (anti-fuite).
-- La borne est dérivée du destinataire (veterinaire_id) ou de la période.
-- Les lignes orphelines (véto ET période supprimés) sont exclues de toute vue.
CREATE POLICY email_log_cabinet_isolation ON public.email_log
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    veterinaire_id IN (
      SELECT id FROM public.veterinaires WHERE cabinet_id = auth_cabinet_actif()
    )
    OR periode_id IN (
      SELECT id FROM public.periodes WHERE cabinet_id = auth_cabinet_actif()
    )
  );

-- 3. INSERT sous RLS pour les admins (service_role continue de bypasser) ─────
DROP POLICY IF EXISTS email_log_admin_insert ON public.email_log;
CREATE POLICY email_log_admin_insert ON public.email_log
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'admin');

COMMENT ON CONSTRAINT email_log_type_check ON public.email_log IS
  'Types réellement journalisés (élargi 2026-07-06 : rappel_publication, appel_volontaires, depannage_confirme).';
