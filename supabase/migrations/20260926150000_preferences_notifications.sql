-- ============================================================
-- B-134 lot 5a — chacun règle les e-mails qu'il reçoit
-- ============================================================
-- MiKL, le 26/09, retour de réunion client : « faudrait prévoir un toggle pour
-- ces demandes de réception de mail pour les congés et pour d'autres
-- notifications qui viendraient après, dans les réglages… prévoir aussi que ce
-- soit le cas du côté des autres profils ».
--
-- ── POURQUOI `user_id` ET PAS `veterinaire_id` ──────────────────────────────
-- `preferences_affichage` (03/08) est clée sur `veterinaires.id`. Reprendre
-- cette clé aurait exclu le SECRÉTARIAT, qui n'a pas de fiche vétérinaire
-- depuis B-017 : il vit dans `secretaires`, table séparée. Or MiKL demande
-- explicitement « les autres profils ». Une clé sur `auth.users` couvre les
-- trois rôles d'un seul schéma, sans fabriquer un faux vétérinaire — un faux
-- vétérinaire qui circule dans le code finit toujours par arriver quelque part
-- où on le prend pour un vrai.
--
-- ── POURQUOI UNE TABLE À PART ───────────────────────────────────────────────
-- Même raison que `preferences_affichage`, et elle reste valable : la RLS de
-- `veterinaires` n'accorde l'écriture qu'aux admins. Pour qu'un vétérinaire
-- règle ses propres notifications sur sa fiche, il faudrait lui ouvrir
-- l'UPDATE dessus — donc aussi sur `role_app`, `dernier_recours` et `actif`.
-- Une policy ne se restreint pas à une colonne.
--
-- ⚠️ POURQUOI ON STOCKE CE QUI EST COUPÉ, ET PAS CE QUI EST ALLUMÉ
--    C'est le choix le plus important de cette migration, et il est
--    irréversible sans migration de données.
--
--    Avec une liste d'ACTIVÉS, deux silences s'installent tout seuls :
--      • quelqu'un qui n'a jamais ouvert l'écran n'a pas de ligne, donc ne
--        reçoit RIEN — la fonction que le client demande n'arriverait jamais
--        chez lui, puisqu'il ne connaît pas l'écran ;
--      • un type de notification ajouté plus tard naîtrait muet pour tout le
--        monde, et personne ne le saurait.
--
--    Avec une liste de COUPÉS, l'absence de ligne vaut « je reçois tout », et
--    une notification nouvelle arrive par défaut. Se taire demande un geste
--    explicite ; c'est la seule disposition où l'oubli ne produit pas de
--    silence. Même famille que « le tableau ne peut pas se taire ».
-- ============================================================

create table if not exists public.preferences_notifications (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  cabinet_id    uuid not null references public.cabinets(id) on delete cascade,
  -- Les types d'e-mails que cette personne a explicitement COUPÉS.
  -- Volontairement sans CHECK : les types naissent côté applicatif (même
  -- raisonnement que `notifications.type`), et une contrainte figée ici
  -- ferait échouer une écriture au lieu de simplement ignorer un type inconnu.
  desactivees   text[] not null default '{}',
  mis_a_jour_le timestamptz not null default now()
);

alter table public.preferences_notifications enable row level security;

-- Isolation cabinet : RESTRICTIVE, jamais permissive (leçon multi-tenant).
drop policy if exists prefs_notifs_cabinet_isolation on public.preferences_notifications;
create policy prefs_notifs_cabinet_isolation on public.preferences_notifications
  as restrictive for all to authenticated
  using (cabinet_id = public.auth_cabinet_actif())
  with check (cabinet_id = public.auth_cabinet_actif());

-- ÉCRITURE strictement personnelle — y compris pour un admin. Un réglage de
-- réception appartient à celui qui le porte : personne n'a à couper les e-mails
-- d'un collègue à sa place.
drop policy if exists prefs_notifs_self on public.preferences_notifications;
create policy prefs_notifs_self on public.preferences_notifications
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ⚠️ LECTURE OUVERTE AU CABINET — ET C'EST INDISPENSABLE, PAS UN RELÂCHEMENT.
--
-- Le défaut a été trouvé en relisant ce chantier, et PROUVÉ en base avant
-- d'être corrigé : avec la seule policy `self` ci-dessus, Antoine (véto) ne
-- voyait qu'1 ligne sur 2 dans son propre cabinet — la sienne.
--
-- Pourquoi c'est fatal ici : UN ENVOI TOURNE SOUS L'IDENTITÉ DE CELUI QUI
-- DÉCLENCHE L'ÉVÉNEMENT, JAMAIS DE SON DESTINATAIRE.
--   · un véto pose un congé  → le code lit la préférence de L'ADMIN ;
--   · l'admin tranche         → le code lit la préférence du VÉTO ;
--   · l'admin publie          → le code lit celle des SEPT vétérinaires.
-- Dans les trois cas, `self` rendait la ligne du destinataire invisible. Le
-- filtre trouvait donc toujours « rien de coupé » et envoyait quand même :
-- CHAQUE INTERRUPTEUR AURAIT ÉTÉ DÉCORATIF. On aurait livré précisément le
-- défaut que ce chantier existe pour empêcher — un réglage qui affiche
-- « e-mail coupé » pendant que les e-mails continuent de partir.
--
-- ⚠️ `using (true)` NE VEUT PAS DIRE « ouvert à tous » : la policy RESTRICTIVE
--    d'isolation ci-dessus s'applique EN PLUS (un AND, jamais un OR). Vérifié
--    par lecture simulée : un véto d'un autre cabinet voit 0 ligne, `anon` voit
--    0 ligne. C'est la leçon `security_invoker` du 22/08 — on ne suppose plus
--    qu'une borne tient, on la mesure.
--
-- Ce qui est donc réellement exposé : un collègue du MÊME cabinet peut voir
-- quels e-mails un autre a coupés. Assumé — le produit montre déjà les
-- compteurs de gardes de toute l'équipe à toute l'équipe, et l'alternative
-- (une fonction SECURITY DEFINER) exposerait la même information à la même
-- population, pour plus de code.
drop policy if exists prefs_notifs_read_cabinet on public.preferences_notifications;
create policy prefs_notifs_read_cabinet on public.preferences_notifications
  for select to authenticated
  using (true);

comment on policy prefs_notifs_read_cabinet on public.preferences_notifications is
  'B-134 — LECTURE ouverte aux membres du cabinet (bornée par la policy RESTRICTIVE d''isolation). Nécessaire : un envoi tourne sous l''identité de celui qui déclenche l''événement, jamais du destinataire. Sans elle, chaque interrupteur était décoratif. L''ÉCRITURE reste strictement personnelle (prefs_notifs_self).';

grant select, insert, update, delete on public.preferences_notifications to authenticated;

comment on table public.preferences_notifications is
  'B-134 — les e-mails que chacun a choisi de NE PLUS recevoir. Clée sur auth.users pour couvrir les trois rôles (admin, véto, secrétariat — ce dernier n''a pas de fiche vétérinaire, B-017). Pas de ligne = tout arrive : l''absence de réglage ne doit jamais produire un silence.';

comment on column public.preferences_notifications.desactivees is
  'Types d''e-mails explicitement coupés par cette personne. On stocke les COUPÉS et non les ALLUMÉS, pour qu''un utilisateur sans ligne et qu''un type ajouté plus tard reçoivent par défaut.';

-- ── L'ENVOI DES DEMANDES DE CONGÉ DOIT POUVOIR ÊTRE JOURNALISÉ ─────────────
-- `email_log.type` porte un CHECK fermé (élargi le 10/07 pour les congés, le
-- 14/08 pour l'e-mail d'essai). Sans cet élargissement, l'e-mail de demande de
-- congé PART bien, mais sa ligne de journal est refusée — on aurait un envoi
-- réel invisible dans `/reglages`, donc impossible à vérifier. C'est exactement
-- le piège documenté par la migration du 14/08.
--
-- ROLLBACK :
--   ALTER TABLE public.email_log DROP CONSTRAINT email_log_type_check;
--   ALTER TABLE public.email_log ADD  CONSTRAINT email_log_type_check
--     CHECK (type IN ('planning_publie','garde_modifiee','rappel_publication',
--                     'appel_volontaires','depannage_confirme',
--                     'conge_valide','conge_refuse','email_test'));
alter table public.email_log drop constraint if exists email_log_type_check;
alter table public.email_log
  add constraint email_log_type_check
  check (type in (
    'planning_publie',
    'garde_modifiee',
    'rappel_publication',
    'appel_volontaires',
    'depannage_confirme',
    'conge_valide',
    'conge_refuse',
    'email_test',
    'conge_demande'
  ));

comment on constraint email_log_type_check on public.email_log is
  'Types réellement journalisés (élargi 2026-09-26 : conge_demande — l''admin est prévenu qu''un véto a posé une demande, B-134).';
