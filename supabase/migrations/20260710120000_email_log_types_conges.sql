-- ============================================================
-- GUARDVETO — Migration : email_log accepte les types congés (D5)
-- Date : 2026-07-10
-- ============================================================
-- Audit Bloc 3 (doc 14, D5) — les e-mails de congé validé/refusé partaient
-- par sendBrevoEmail (brevo.ts) SANS être journalisés, contrairement aux
-- notifications passant par sendViaBrevo (notifications.ts).
--
-- On rebranche ces 2 e-mails sur email_log (côté applicatif, conges/actions.ts).
-- Cette migration ÉLARGIT la contrainte de type pour accepter les 2 nouveaux
-- types journalisés : 'conge_valide' et 'conge_refuse'. Le reste (RLS,
-- policies) est inchangé — l'insert admin sous RLS suffit (l'action tourne
-- avec le client RLS-aware de l'admin qui valide/refuse).
--
-- ROLLBACK :
--   ALTER TABLE public.email_log DROP CONSTRAINT email_log_type_check;
--   ALTER TABLE public.email_log ADD  CONSTRAINT email_log_type_check
--     CHECK (type IN ('planning_publie','garde_modifiee','rappel_publication',
--                     'appel_volontaires','depannage_confirme'));
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
    'conge_refuse'
  ));

COMMENT ON CONSTRAINT email_log_type_check ON public.email_log IS
  'Types réellement journalisés (élargi 2026-07-10 : conge_valide, conge_refuse — e-mails de congé, D5 audit Bloc 3).';
