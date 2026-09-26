-- ============================================================
-- B-134 — deux portes qui manquaient, trouvées en relisant le chantier
-- ============================================================
-- Le lot 5b a branché l'envoi « une demande de congé vient d'être posée ». Le
-- code était juste, les tests verts, et RIEN NE SERAIT ARRIVÉ À L'ADMIN.
--
-- LA CAUSE, UNE SEULE, ET ELLE VAUT D'ÊTRE RETENUE : un envoi tourne sous
-- l'identité de CELUI QUI DÉCLENCHE l'événement, jamais de son destinataire.
-- Ici, c'est un VÉTÉRINAIRE qui pose sa demande. Or les deux tables que l'envoi
-- doit écrire n'acceptaient l'insertion que d'un ADMIN :
--
--   · `notifications` → `notifications_insert_admin`  WITH CHECK (role = admin)
--   · `email_log`     → `email_log_admin_insert`      WITH CHECK (role = admin)
--
-- Les deux refus étaient SILENCIEUX : `creerNotification` avale son erreur par
-- conception (best-effort), et `logEmail` ne lisait même pas la sienne. On
-- aurait donc livré une fonctionnalité qui ne prévient personne, sans un mot
-- dans les logs, en croyant l'avoir livrée — la tête même du problème que
-- « preuve avant annonce » existe pour empêcher.
--
-- ⚠️ CE QUI A PERMIS DE LE VOIR : pas un test. Les tests lisent le code, et le
--    code appelait bien les deux écritures. Il a fallu SIMULER les deux
--    identités en base (`set local role authenticated` + le JWT) et compter les
--    lignes réellement écrites. Un `grep` prouve qu'un code est écrit, jamais
--    qu'il est exécuté — et jamais qu'il aboutit.
--
-- ── POURQUOI CES POLICIES SONT AUSSI ÉTROITES ───────────────────────────────
-- On n'ouvre PAS l'insertion aux vétérinaires. On ouvre UN type de ligne, vers
-- UN destinataire qualifié : un admin actif du même cabinet. Un vétérinaire ne
-- peut donc pas se servir de ces portes pour écrire autre chose, ni à quelqu'un
-- d'autre. Vérifié par mesure : le type `planning_publie` est refusé, une cible
-- non-admin est refusée.
-- ============================================================

-- ── La cloche de l'administratrice ──────────────────────────────────────────
drop policy if exists notifications_insert_demande_conge on public.notifications;
create policy notifications_insert_demande_conge on public.notifications
  for insert to authenticated
  with check (
    type = 'conge_demande'
    and veterinaire_id in (
      select v.id from public.veterinaires v
      where v.cabinet_id = public.auth_cabinet_actif()
        and v.role_app = 'admin'
        and v.actif = true
    )
  );

comment on policy notifications_insert_demande_conge on public.notifications is
  'B-134 — un vétérinaire peut créer UNE notification de type conge_demande, et uniquement vers un admin actif de son cabinet. Sans elle, poser une demande ne faisait sonner aucune cloche : la seule policy d''INSERT exigeait le rôle admin, et l''échec était silencieux.';

-- ── La trace de l'envoi, sans laquelle rien n'est vérifiable ─────────────────
-- MiKL demande de « vérifier que l'admin reçoit bien » : sans ligne de journal,
-- l'écran de réglages ne montre rien et le webhook Brevo ne peut pas rattacher
-- « remis » ou « rejeté ». Un envoi invisible est un envoi invérifiable — et on
-- retomberait sur les trois « Envoyé » affichés pour des messages rejetés du
-- 2026-08-21.
drop policy if exists email_log_insert_demande_conge on public.email_log;
create policy email_log_insert_demande_conge on public.email_log
  for insert to authenticated
  with check (
    type = 'conge_demande'
    and veterinaire_id in (
      select v.id from public.veterinaires v
      where v.cabinet_id = public.auth_cabinet_actif()
        and v.role_app = 'admin'
        and v.actif = true
    )
  );

comment on policy email_log_insert_demande_conge on public.email_log is
  'B-134 — un vétérinaire peut journaliser l''e-mail de type conge_demande envoyé à un admin actif de son cabinet. Sans elle, l''envoi partait sans trace : invisible dans l''écran de réglages et hors de portée du webhook Brevo, donc invérifiable.';

-- ROLLBACK :
--   DROP POLICY notifications_insert_demande_conge ON public.notifications;
--   DROP POLICY email_log_insert_demande_conge     ON public.email_log;
--   ⚠️ Les retirer REMET la panne silencieuse : l'e-mail de demande de congé
--      partira, mais sans cloche et sans trace.
