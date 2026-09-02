-- ============================================================
-- GUARDVETO — Tracer les générations, y compris celles qui MEURENT (B-104)
-- ============================================================
-- MiKL, le 2026-09-02 : « des fois ça déconne, je lance, ça commence quelques
-- secondes puis la fenêtre se ferme… on avait déjà abordé cette histoire, tu
-- avais soi-disant réglé le problème, apparemment non. »
--
-- Il a raison, et voici pourquoi le correctif précédent ne pouvait pas tenir :
-- **rien ne trace les générations**. Ni durée, ni issue, ni erreur. Mesuré le
-- 02/09 : `audit_log` ne porte AUCUNE ligne sur `periodes` depuis 12 h. Après
-- coup, il n'y a rien à lire — donc chaque diagnostic repart d'hypothèses, et
-- un correctif sur hypothèse tombe juste une fois sur trois.
--
-- ── LA DÉCISION DE CONCEPTION QUI FAIT TOUT ────────────────────────────────
--
-- La ligne s'ouvre AU DÉBUT de la génération, pas à la fin.
--
-- Une trace écrite à la sortie ne garde que les générations qui ABOUTISSENT —
-- c'est-à-dire jamais celles qu'on cherche. Quand la fonction serverless est
-- tuée (timeout, crash), aucun code de sortie ne s'exécute : ni la libération
-- du verrou, ni l'écriture d'un rapport.
--
-- D'où l'inversion : **une ligne ouverte et jamais refermée EST la preuve que
-- la fonction est morte**, et `ouverte_le` en donne l'heure exacte. C'est le
-- seul dispositif qui observe un processus incapable de raconter sa propre
-- mort. On lit l'absence, pas la présence.
--
-- ── POURQUOI UNE TABLE, ET PAS `audit_log` ─────────────────────────────────
--
-- `audit_log` enregistre des changements de lignes. Ici on veut la vie d'une
-- OPÉRATION : quand elle commence, ce qu'elle traverse, si elle finit. Deux
-- objets différents ; les mélanger rendrait les deux illisibles.
--
-- ── CE QUE CETTE TABLE N'EST PAS ───────────────────────────────────────────
--
-- Ni une source de vérité, ni un verrou. Le verrou reste `generation_lock_at`
-- sur `periodes` — un compare-and-swap SQL, seul mécanisme correct pour ça.
-- Ceci est une trace : rien ne doit jamais la relire pour DÉCIDER.
--
-- ⚠️ VOLONTAIREMENT HORS DE LA PUBLICATION `supabase_realtime`. La page
-- planning s'abonne à `gardes` et `periodes` et se rafraîchit à chaque
-- écriture. Publier cette table ajouterait des écritures pendant la génération
-- — donc des rafraîchissements de plus, pendant précisément l'incident qu'on
-- observe. Un instrument de mesure ne doit pas peser sur ce qu'il mesure.
-- ============================================================

create table if not exists public.generations_trace (
  id             uuid primary key default gen_random_uuid(),
  cabinet_id     uuid not null references public.cabinets(id) on delete cascade,
  periode_id     uuid not null references public.periodes(id) on delete cascade,

  -- Qui a lancé : un incident qui ne touche qu'une personne oriente ailleurs
  -- (navigateur, réseau) qu'un incident qui les touche toutes.
  lance_par      uuid,

  ouverte_le     timestamptz not null default now(),
  -- NULL tant que la génération n'a pas rendu la main. Une ligne qui reste à
  -- NULL est le signal recherché : personne n'a pu écrire la fin.
  fermee_le      timestamptz,
  duree_ms       integer,

  -- 'complet' | 'partiel' | 'echec' : les trois issues de B-053.
  -- 'erreur' : une exception a traversé la route.
  -- NULL = jamais fermée (voir ci-dessus).
  issue          text check (issue in ('complet', 'partiel', 'echec', 'erreur')),

  nb_gardes      integer,
  -- Le calcul a-t-il été coupé par ses propres plafonds (seed, rattrapage) ?
  -- À distinguer d'une mort par timeout de plateforme, qui ne s'écrit jamais.
  interrompu     boolean not null default false,
  erreur         text,

  -- Les étapes traversées, horodatées. C'est ce qui dira OÙ le temps part
  -- quand une génération frôle les 60 s de la fonction.
  etapes         jsonb not null default '[]'::jsonb,

  -- Ce que le NAVIGATEUR rapporte, quand il peut encore parler (B-104).
  -- Le symptôme de MiKL — « la fenêtre se ferme » — est côté client : le
  -- serveur ne le voit pas. Rempli par balise `sendBeacon`, qui survit au
  -- démontage d'un composant et à la fermeture d'un onglet.
  incident_client jsonb
);

-- L'usage réel, et le premier qu'on fera : « les générations de ce cabinet, la
-- plus récente d'abord », puis « celles qui ne se sont jamais refermées ».
create index if not exists generations_trace_cabinet_idx
  on public.generations_trace (cabinet_id, ouverte_le desc);

create index if not exists generations_trace_jamais_fermees_idx
  on public.generations_trace (ouverte_le desc)
  where fermee_le is null;

alter table public.generations_trace enable row level security;

-- Isolation du cabinet : RESTRICTIVE, donc elle s'AJOUTE aux autres au lieu de
-- s'y substituer. En PERMISSIVE, la policy admin ci-dessous suffirait à lire
-- les traces d'un AUTRE cabinet — défaut déjà corrigé ailleurs dans ce projet.
drop policy if exists generations_trace_cabinet_isolation on public.generations_trace;
create policy generations_trace_cabinet_isolation
  on public.generations_trace
  as restrictive
  for all
  using (cabinet_id = auth_cabinet_actif())
  with check (cabinet_id = auth_cabinet_actif());

-- La génération est un outil d'administration ; sa trace aussi.
drop policy if exists generations_trace_admin_all on public.generations_trace;
create policy generations_trace_admin_all
  on public.generations_trace
  for all
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

-- ⚠️ RETIRER LES DROITS DE `anon`, ET NE PAS S'EN REMETTRE À LA RLS SEULE.
-- Quatrième application de la même leçon : vues `security_invoker` (22/08),
-- tables `_backup_*` (25/08), fonctions `SECURITY DEFINER` (27/08). La clé
-- `anon` vit dans le bundle du navigateur ; aucun accès anonyme n'a de raison
-- d'exister ici. On coupe la branche au lieu de vérifier qu'on ne s'y assoit pas.
revoke all on public.generations_trace from anon;

comment on table public.generations_trace is
  'Trace des generations (B-104). Ouverte AU DEBUT : une ligne jamais refermee prouve que la fonction est morte. Historique seul, rien ne la relit pour decider.';

-- ── FERMER LA TRACE — et pourquoi la durée se calcule EN BASE ──────────────
--
-- `duree_ms` est dérivée de `ouverte_le` par Postgres, pas chronométrée dans le
-- code. Un chronomètre côté serveur mesure le temps du PROCESSUS ; ce qu'on
-- veut, c'est le temps que l'admin a réellement attendu. Les deux divergent
-- précisément quand quelque chose va mal — c'est-à-dire dans les seuls cas
-- qui nous intéressent ici.
--
-- `SECURITY INVOKER` (et non DEFINER) : la RLS de la table s'applique donc
-- normalement, et un admin ne peut fermer que les traces de son cabinet. La
-- leçon du 27/08 (huit fonctions `SECURITY DEFINER` exécutables par `anon`) a
-- coûté assez cher pour qu'on n'ouvre pas la neuvième sans nécessité.
create or replace function public.fermer_trace_generation(
  p_trace_id   uuid,
  p_issue      text,
  p_nb_gardes  integer,
  p_interrompu boolean,
  p_erreur     text,
  p_etapes     jsonb
) returns boolean
language sql
security invoker
set search_path = public
as $$
  update public.generations_trace
     set fermee_le  = now(),
         duree_ms   = (extract(epoch from (now() - ouverte_le)) * 1000)::integer,
         issue      = p_issue,
         nb_gardes  = p_nb_gardes,
         interrompu = coalesce(p_interrompu, false),
         erreur     = p_erreur,
         etapes     = coalesce(p_etapes, '[]'::jsonb)
   where id = p_trace_id
  returning true;
$$;

revoke all on function public.fermer_trace_generation(uuid, text, integer, boolean, text, jsonb) from anon;

comment on function public.fermer_trace_generation is
  'Ferme une trace de generation (B-104). SECURITY INVOKER : la RLS s applique. Duree calculee EN BASE depuis ouverte_le.';
