-- ============================================================
-- GUARDVETO — Les propositions de Filou survivent à l'onglet (B-122 lot 2)
-- ============================================================
-- MiKL, le 2026-09-15, en corrigeant l'hypothèse par défaut de MAX :
--
--   « il faut prevoir une fonction que tant que l'utilisateur n'a pas rejete
--    ou fait les modifs, ca ne s'efface pas malgre le changement d'onglet ou
--    une reconnexion. Sinon ca fait refaire la generation, et c'est pas pour
--    nous arranger »
--
-- Avant cette table, une proposition que le moteur refuse (verdict `refuse`
-- de `engine/relecture/arbitrer.ts`) ne vivait QUE dans la réponse HTTP de
-- `/api/planning/relecture` — le tableau `a_trancher`, jeté dès que l'écran se
-- ferme. Or une génération complète coûte 42 s mesurées (B-104), plus la
-- relecture de Filou : perdre la proposition en changeant d'onglet forçait à
-- tout rejouer pour la revoir.
--
-- ── CE QU'ON PERSISTE, ET CE QU'ON NE PERSISTE PAS ──────────────────────────
--
-- Une ligne par proposition REFUSÉE PAR LE MOTEUR (`verdict = 'refuse'`) —
-- c'est précisément le sous-ensemble sur lequel l'admin doit trancher.
--
-- ⚠️ CE N'EST PAS UN CACHE. Le contenu du changement (`changement`) est celui
-- que Filou a proposé — la source de vérité sur ce qu'il faut ÉCRIRE si on
-- accepte reste le moteur, rejoué au moment du clic
-- (`engine/relecture/appliquerProposition.ts`), jamais cette ligne relue telle
-- quelle : le planning a pu bouger entre la proposition et la décision.
--
-- ── LE STATUT SUIT `types/index.ts` (StatutPropositionRelecture) ───────────
--
-- `en_attente` (aperçu) → `appliquee` | `rejetee` | `perimee` (planning changé
-- sous elle). C'est un nouvel état qui attend quelqu'un : la règle « LE
-- TABLEAU NE PEUT PAS SE TAIRE » (`lib/produit/attentes.ts`) s'applique.
-- ============================================================

create table if not exists public.propositions_relecture (
  id                  uuid primary key default gen_random_uuid(),
  cabinet_id          uuid not null references public.cabinets(id) on delete cascade,
  periode_id          uuid not null references public.periodes(id) on delete cascade,
  -- La relecture qui l'a fait naître — pour remonter au rapport complet
  -- (revue, synthèse) sans dupliquer ce contenu ici.
  relecture_id        uuid references public.relectures_planning(id) on delete set null,

  -- L'identifiant du changement TEL QUE FILOU L'A NOMMÉ (`ChangementPropose.id`
  -- de `engine/relecture/arbitrer.ts`) — pas un nouvel identifiant maison, pour
  -- que l'écran et le journal parlent du même changement sans traduction.
  changement_id       text not null,

  statut              text not null default 'en_attente'
    check (statut in ('en_attente', 'appliquee', 'rejetee', 'perimee')),

  -- Le `ChangementPropose` complet (motif, critère, affectations) : c'est ce
  -- qu'on rejoue au moment de l'appliquer, PAS ce qu'on réaffiche tel quel.
  changement          jsonb not null,
  -- Les violations que le moteur reprochait au moment de la relecture — pour
  -- que le bouton « appliquer quand même » DISE ce qu'il enfreint, doctrine
  -- maison (« le système informe, il n'interdit pas »).
  violations          jsonb not null default '[]'::jsonb,
  -- « Antoine 27 -> 25 » (B-122 lot 1), calculé au moment de la relecture.
  -- Recalculé au moment du clic si le planning a bougé — celui-ci ne sert
  -- qu'à l'AFFICHAGE de l'aperçu, jamais à décider quoi écrire.
  compteurs_projetes  jsonb not null default '[]'::jsonb,

  cree_le             timestamptz not null default now(),
  decidee_le          timestamptz
);

-- L'usage réel : « les propositions en attente de cette période ». Filtré sur
-- le statut parce que c'est la question posée à chaque ouverture du planning.
create index if not exists propositions_relecture_en_attente_idx
  on public.propositions_relecture (periode_id, statut);

-- Un même changement (même relecture, même id de changement) ne doit pas se
-- dupliquer si la relecture est rejouée avant que l'admin ait tranché — la
-- ligne existante est mise à jour, pas doublée (cf. `perimerPropositions`).
create unique index if not exists propositions_relecture_changement_unique
  on public.propositions_relecture (periode_id, changement_id)
  where statut = 'en_attente';

alter table public.propositions_relecture enable row level security;

-- Isolation du cabinet : RESTRICTIVE, même raisonnement que
-- `relectures_planning` — elle s'ajoute à la policy admin au lieu de s'y
-- substituer, sans quoi la policy admin ci-dessous suffirait à voir les
-- propositions d'un AUTRE cabinet.
drop policy if exists propositions_relecture_cabinet_isolation on public.propositions_relecture;
create policy propositions_relecture_cabinet_isolation
  on public.propositions_relecture
  as restrictive
  for all
  using (cabinet_id = auth_cabinet_actif())
  with check (cabinet_id = auth_cabinet_actif());

-- Une proposition touche la composition du planning : c'est un outil
-- d'administration, comme la relecture qui la produit.
drop policy if exists propositions_relecture_admin_all on public.propositions_relecture;
create policy propositions_relecture_admin_all
  on public.propositions_relecture
  for all
  using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

-- ⚠️ RETIRER `anon`, TOUJOURS EXPLICITEMENT — troisième fois payée sur ce
-- projet que la RLS seule ne suffit pas à documenter l'intention (vues
-- security_invoker le 22/08, tables `_backup_*` le 25/08, `relectures_planning`
-- le 02/09).
revoke all on public.propositions_relecture from anon;

comment on table public.propositions_relecture is
  'Propositions de Filou refusées par le moteur, en attente de decision admin sur le planning (B-122 lot 2). Etat du produit, pas etat d ecran : ne s efface pas au changement d onglet.';

-- ── TEMPS RÉEL ───────────────────────────────────────────────────────────
-- Sans cette ligne, un abonnement à la table ne renvoie AUCUNE erreur : il ne
-- se déclenche simplement jamais (leçon déjà payée pour `conges`,
-- `echanges_gardes`, `compensations` — migration `realtime_attentes`).
alter publication supabase_realtime add table public.propositions_relecture;
