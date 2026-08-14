-- ============================================================
-- GUARDVETO — Migration : email_log accepte le type « email_test »
-- Date : 2026-08-14
-- ============================================================
-- Audit de l'écran Réglages (2026-08-14) — l'envoi d'e-mails était cassé en
-- production depuis 11 jours (le serveur d'envoi refusait l'adresse IP de
-- l'hébergeur) sans que rien ne le signale : pour découvrir la panne, il
-- fallait publier un planning et attendre qu'un vétérinaire ne reçoive rien.
--
-- On ajoute donc un bouton « Envoyer un e-mail de test » dans /reglages
-- (action `envoyerEmailDeTest`, src/app/(v2)/reglages/actions.ts). Cet essai
-- emprunte le chemin réel des envois et doit se journaliser comme les autres,
-- pour apparaître dans le journal affiché juste en dessous.
--
-- Cette migration ÉLARGIT la contrainte de type pour accepter 'email_test'.
-- Rien d'autre ne change : ni RLS, ni policies, ni colonnes. L'insert se fait
-- sous le client RLS-aware de l'administrateur qui déclenche l'essai, et
-- `email_log_admin_insert` l'autorise déjà.
--
-- ⚠️ TANT QUE CETTE MIGRATION N'EST PAS APPLIQUÉE : le bouton fonctionne et
--    l'e-mail part réellement — seule la LIGNE DE JOURNAL est refusée par la
--    contrainte. L'action le détecte et le trace dans les logs serveur ; elle
--    ne fait jamais passer un envoi réussi pour un échec.
--
-- ROLLBACK :
--   DELETE FROM public.email_log WHERE type = 'email_test';
--   ALTER TABLE public.email_log DROP CONSTRAINT email_log_type_check;
--   ALTER TABLE public.email_log ADD  CONSTRAINT email_log_type_check
--     CHECK (type IN ('planning_publie','garde_modifiee','rappel_publication',
--                     'appel_volontaires','depannage_confirme',
--                     'conge_valide','conge_refuse'));
-- ============================================================

ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_type_check;
ALTER TABLE public.email_log
  ADD CONSTRAINT email_log_type_check
  CHECK (type IN (
    'planning_publie',
    'garde_modifiee',
    'rappel_publication',
    'appel_volontaires',
    'depannage_confirme',
    'conge_valide',
    'conge_refuse',
    'email_test'
  ));

COMMENT ON CONSTRAINT email_log_type_check ON public.email_log IS
  'Types réellement journalisés (élargi 2026-08-14 : email_test — essai d''envoi déclenché depuis /reglages).';
