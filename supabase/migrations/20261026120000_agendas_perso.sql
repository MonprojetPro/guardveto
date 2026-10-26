-- ============================================================
-- GUARDVETO — B-173 : l'agenda Google PERSONNEL de chaque membre
-- ============================================================
-- MiKL, 24/10 : au Val d'Allier, chaque véto superpose l'agenda du cabinet à
-- son agenda perso. Y poser les journées de toute l'équipe aux heures réelles
-- ferait des faux conflits partout. D'où un agenda « GuardVeto — Prénom » par
-- personne, créé et tenu par GuardVeto, que chacun règle dans « Mon agenda ».
--
-- Trois pièces :
--   · cabinets.agenda_perso_ouvert — la fonction n'existe que là où elle est
--     ouverte. FAUX par défaut : rien ne change chez un cabinet qui n'a rien
--     demandé (et Google enverrait une invitation à chaque membre).
--   · agendas_perso — les réglages d'UNE personne + l'état de son agenda.
--   · agenda_perso_evenements — ce que GuardVeto a écrit dans cet agenda, pour
--     pouvoir le mettre à jour et le retirer. Sans cette mémoire, une journée
--     supprimée resterait dans l'agenda pour toujours.
--
-- ⚠️ RLS ACTIVÉE, AUCUNE POLICY. Personne ne lit ni n'écrit ces tables depuis
--    le navigateur : tout passe par le serveur, qui vérifie d'abord QUI est
--    connecté puis agit avec la clé de service. Une policy ouverte par erreur
--    sur une table de réglages personnels exposerait l'adresse et l'agenda de
--    chacun à toute l'équipe.
-- ============================================================

ALTER TABLE public.cabinets
  ADD COLUMN IF NOT EXISTS agenda_perso_ouvert BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cabinets.agenda_perso_ouvert IS
  'B-173 — la fonction « Mon agenda » (un agenda Google par membre) est-elle ouverte à ce cabinet ? Faux par défaut.';

CREATE TABLE IF NOT EXISTS public.agendas_perso (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id              UUID NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  -- Exactement l'un des deux : un véto (admin compris) ou une secrétaire.
  veterinaire_id          UUID REFERENCES public.veterinaires(id) ON DELETE CASCADE,
  secretaire_id           UUID REFERENCES public.secretaires(id) ON DELETE CASCADE,

  -- ── Réglages ──
  actif                   BOOLEAN NOT NULL DEFAULT true,
  personnalise            BOOLEAN NOT NULL DEFAULT false,
  journees                TEXT    NOT NULL DEFAULT 'miennes'
                            CHECK (journees IN ('miennes', 'equipe', 'aucune')),
  placement               TEXT    NOT NULL DEFAULT 'heures'
                            CHECK (placement IN ('heures', 'haut')),
  mes_gardes              BOOLEAN NOT NULL DEFAULT true,
  gardes_autres           BOOLEAN NOT NULL DEFAULT true,

  -- ── État de l'agenda Google ──
  google_calendar_id      TEXT,
  partage_email           TEXT,
  invitation_envoyee_le   TIMESTAMPTZ,
  -- Le partage de l'agenda du CABINET, retiré quand la personne personnalise
  -- (sinon ses gardes apparaîtraient deux fois) et rendu quand elle revient au
  -- mode par défaut ou coupe la fonction.
  --   non_concerne : rien à faire (mode par défaut, ou fonction coupée)
  --   retire       : GuardVeto le lui a retiré ; role_cabinet_retire dit quoi rendre
  --   absent       : son adresse n'a aucun partage nominatif → à masquer elle-même
  --   impossible   : GuardVeto n'a pas le droit de gérer ce partage
  partage_cabinet         TEXT NOT NULL DEFAULT 'non_concerne'
                            CHECK (partage_cabinet IN ('non_concerne', 'retire', 'absent', 'impossible')),
  role_cabinet_retire     TEXT,

  -- ── Synchronisation ──
  sync_depuis             TIMESTAMPTZ,   -- verrou : non nul = une synchro tourne
  a_refaire               BOOLEAN NOT NULL DEFAULT false,
  progression_faite       INTEGER NOT NULL DEFAULT 0,
  progression_total       INTEGER NOT NULL DEFAULT 0,
  derniere_sync_le        TIMESTAMPTZ,
  derniere_erreur         TEXT,

  cree_le                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  mis_a_jour_le           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT agendas_perso_un_membre CHECK (
    (veterinaire_id IS NOT NULL)::int + (secretaire_id IS NOT NULL)::int = 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS agendas_perso_veterinaire_uniq
  ON public.agendas_perso (veterinaire_id) WHERE veterinaire_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agendas_perso_secretaire_uniq
  ON public.agendas_perso (secretaire_id) WHERE secretaire_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agendas_perso_cabinet_idx
  ON public.agendas_perso (cabinet_id);

CREATE TABLE IF NOT EXISTS public.agenda_perso_evenements (
  agenda_id        UUID NOT NULL REFERENCES public.agendas_perso(id) ON DELETE CASCADE,
  -- Clé stable de ce que l'événement représente (« j|2026-11-09|<bloc> »,
  -- « g|<garde>|2026-11-09|0 »…). C'est elle qui permet de RAPPROCHER plutôt
  -- que de recréer : relancée deux fois, la synchro produit le même agenda.
  cle              TEXT NOT NULL,
  google_event_id  TEXT NOT NULL,
  -- Ce qui a été écrit (titre, bornes, couleur). Identique → aucun appel Google.
  empreinte        TEXT NOT NULL,
  mis_a_jour_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agenda_id, cle)
);

ALTER TABLE public.agendas_perso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_perso_evenements ENABLE ROW LEVEL SECURITY;
-- Aucune policy, volontairement (voir l'en-tête).
