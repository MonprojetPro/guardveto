-- ============================================================
-- GUARDVETO — Horodater la DÉCISION, pas seulement la demande (B-066)
-- ============================================================
-- Demande de MiKL le 2026-08-27 : « un horodatage des demandes de congés et
-- d'absences pour garder un historique des demandes ».
--
-- ⚠️ CE QUI EXISTAIT DÉJÀ, ET QUE PERSONNE NE VOYAIT.
-- `conges` porte `created_at`, `saisi_par` et `valide_par` depuis la migration
-- 001. `absences` porte `created_at` et `declaree_par`. Ces colonnes sont
-- écrites à chaque création et à chaque validation — et lues par personne :
-- aucun composant de l'application ne les affiche.
--
-- Il ne manquait donc pas « un horodatage » : il manquait la date de la
-- DÉCISION. `created_at` date l'arrivée de la demande, jamais son traitement.
-- Une demande déposée le 3 et validée le 27 n'avait qu'une seule date, et
-- c'était la mauvaise pour répondre à « depuis quand attend-elle ? ».
--
-- `decide_le` reste NULL tant que la demande est en attente — et c'est ce
-- NULL qui porte l'information. Le remplir par défaut avec `now()` aurait
-- daté d'aujourd'hui des décisions prises il y a des mois, ou pas prises du
-- tout : une donnée fausse est pire qu'une donnée absente, parce qu'elle
-- s'affiche avec le même aplomb que la vraie.
--
-- Les lignes déjà en base gardent donc `decide_le IS NULL`, y compris celles
-- qui sont validées ou refusées depuis longtemps. L'écran doit se taire sur
-- celles-là plutôt que d'inventer une date (arbitrage MiKL, hypothèse 2).
-- ============================================================

-- ── CONGÉS ──────────────────────────────────────────────────
alter table public.conges
  add column if not exists decide_le timestamptz;

comment on column public.conges.decide_le is
  'Quand la demande a été validée ou refusée. NULL = encore en attente, ou décision antérieure au 2026-08-27 (non reconstituable). Ne jamais remplir rétroactivement : cf. la migration qui crée cette colonne.';

comment on column public.conges.created_at is
  'Quand la demande a été DÉPOSÉE. Ne date pas son traitement — voir decide_le.';

-- `valide_par` était renseigné à la validation, jamais au refus : on ne savait
-- pas qui avait dit non. Le nom de la colonne reste (le renommer casserait
-- toutes ses lectures) mais son sens s'élargit — d'où le commentaire.
comment on column public.conges.valide_par is
  'Qui a tranché la demande — validation OU refus. Le nom dit « valide » pour raisons historiques.';

-- ── ABSENCES ────────────────────────────────────────────────
-- Une absence est déclarée, pas demandée : elle n'a pas de circuit de
-- validation aujourd'hui. Elle reçoit quand même la colonne, pour que le jour
-- où une réparation ou une annulation se trace, il n'y ait pas à re-migrer et
-- à re-répondre à la même question.
alter table public.absences
  add column if not exists decide_le timestamptz;

comment on column public.absences.decide_le is
  'Quand l''absence a été traitée (réparation, annulation). NULL = déclarée et non traitée. Pas de circuit de validation sur les absences à ce jour.';

comment on column public.absences.created_at is
  'Quand l''absence a été DÉCLARÉE.';

-- ── LECTURE ─────────────────────────────────────────────────
-- Les écrans filtrent déjà par cabinet et par vétérinaire ; l'index sert les
-- tris par ordre d'arrivée demandés en B-067, sur la liste complète des congés
-- d'un cabinet.
create index if not exists conges_created_at_idx on public.conges (created_at desc);
