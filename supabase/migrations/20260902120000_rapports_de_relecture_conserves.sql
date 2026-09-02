-- ============================================================
-- GUARDVETO — Les rapports de relecture ne disparaissent plus avec l'écran
-- ============================================================
-- MiKL, le 2026-09-02, devant un planning où Antoine faisait un week-end sur
-- deux : « Filou il a fait quoi ? Rien. »
--
-- Il avait raison sur le fond, et personne n'a pu le vérifier. La relecture
-- tourne bien à chaque génération, elle affiche ses constats à l'écran… et
-- rien n'en reste. Impossible de savoir, une heure plus tard, ce que Filou
-- avait dit — ni de comparer avant et après un correctif.
--
-- ── POURQUOI C'EST LA PREMIÈRE PIERRE DE B-096 ─────────────────────────────
--
-- Les quatre autres lots donnent à Filou de quoi voir et de quoi agir. Sans
-- cette table, on ne saurait pas s'ils ont servi : on remplacerait « je crois
-- qu'il ne voit rien » par « je crois qu'il voit mieux ». Le projet a déjà payé
-- ce prix — trois mois à supposer qu'un moteur tournait.
--
-- Ce qu'on conserve est exactement ce que l'écran affiche : la synthèse, la
-- revue critère par critère (Y COMPRIS les « rien à signaler », qui disent ce
-- qui a été REGARDÉ), les critères non traités, les propositions appliquées et
-- celles que le moteur a refusées.
--
-- ── ON GARDE AUSSI LES ÉCHECS ──────────────────────────────────────────────
--
-- `issue = 'indisponible'` est une ligne comme une autre. Ne conserver que les
-- relectures réussies donnerait un historique où tout s'est toujours bien
-- passé — et c'est précisément quand Filou ne répond pas qu'on veut le savoir.
--
-- ── CE QUE CETTE TABLE N'EST PAS ───────────────────────────────────────────
--
-- Ni une source de vérité, ni un cache. Le planning vit dans `gardes` et
-- `garde_placements` ; ceci est une trace, en lecture seule pour le produit.
-- Rien ne doit jamais la relire pour décider quoi que ce soit.
-- ============================================================

create table if not exists public.relectures_planning (
  id             uuid primary key default gen_random_uuid(),
  cabinet_id     uuid not null references public.cabinets(id) on delete cascade,
  periode_id     uuid not null references public.periodes(id) on delete cascade,

  -- 'relu' = Filou a répondu · 'indisponible' = il n'a pas pu (on garde aussi).
  issue          text not null check (issue in ('relu', 'indisponible')),
  -- Le modèle qui a répondu : une relecture ne se compare qu'à modèle connu.
  modele         text,

  synthese       text,
  -- La revue critère par critère, telle qu'affichée.
  revue          jsonb not null default '[]'::jsonb,
  -- Les critères que Filou n'a pas traités. Le silence se conserve aussi.
  criteres_non_traites jsonb not null default '[]'::jsonb,
  -- Les propositions appliquées, et celles que le moteur a refusées.
  appliques      jsonb not null default '[]'::jsonb,
  a_trancher     jsonb not null default '[]'::jsonb,
  -- Combien de propositions ne visaient rien d'existant.
  ecartes        integer not null default 0,
  planning_modifie boolean not null default false,
  -- Le message d'erreur quand `issue = 'indisponible'`.
  erreur         text,

  cree_le        timestamptz not null default now()
);

-- L'usage réel : « les relectures de cette période, la plus récente d'abord ».
create index if not exists relectures_planning_periode_idx
  on public.relectures_planning (periode_id, cree_le desc);

alter table public.relectures_planning enable row level security;

-- Isolation du cabinet : RESTRICTIVE, donc elle s'ajoute à toutes les autres
-- au lieu de s'y substituer. En PERMISSIVE, la policy admin ci-dessous
-- suffirait à voir les relectures d'un AUTRE cabinet — le défaut que ce projet
-- a déjà corrigé ailleurs.
drop policy if exists relectures_planning_cabinet_isolation on public.relectures_planning;
create policy relectures_planning_cabinet_isolation
  on public.relectures_planning
  as restrictive
  for all
  using (cabinet_id = auth_cabinet_actif())
  with check (cabinet_id = auth_cabinet_actif());

-- La relecture est un outil d'administration : elle ne se déclenche que depuis
-- le parcours de génération, réservé à l'admin. Les vétérinaires n'ont aucune
-- raison de lire les brouillons de raisonnement sur leur propre charge.
drop policy if exists relectures_planning_admin_all on public.relectures_planning;
create policy relectures_planning_admin_all
  on public.relectures_planning
  for all
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

-- ⚠️ RETIRER LES DROITS DE `anon`, ET NE PAS S'EN REMETTRE À LA RLS SEULE.
--
-- Supabase accorde par défaut tous les droits de table à `anon` et
-- `authenticated` sur le schéma public. La RLS ci-dessus suffit à bloquer un
-- visiteur non connecté — mais c'est la TROISIÈME fois que ce projet découvre
-- une porte ouverte à `anon` (les vues `security_invoker` le 22/08, les tables
-- `_backup_*` le 25/08, huit fonctions `SECURITY DEFINER` le 27/08). À chaque
-- fois la protection tenait à un seul fil, et à chaque fois la clé `anon` vit
-- dans le bundle du navigateur. Aucun accès anonyme n'a de raison d'exister
-- ici : on coupe la branche au lieu de vérifier qu'on ne s'assied pas dessus.
revoke all on public.relectures_planning from anon;

comment on table public.relectures_planning is
  'Trace des relectures de Filou (B-096). Historique seul : rien ne doit la relire pour décider.';
