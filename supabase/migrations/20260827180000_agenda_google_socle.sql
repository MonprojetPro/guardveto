-- ============================================================
-- GUARDVETO — Agenda Google : LE SOCLE (chantier agenda, lot base de données)
-- ============================================================
-- Pose les colonnes et la table dont a besoin la synchronisation Google Agenda
-- événement-par-personne-et-par-jour. Ne touche à AUCUN code applicatif — la
-- lecture/écriture de ces colonnes vit dans d'autres lots, en cours en
-- parallèle (`src/lib/google-calendar.ts`, `src/lib/sync-calendrier.ts`,
-- `src/components/v2/*`, `src/lib/agenda/*`).
--
-- ── POURQUOI UNE TABLE À PART POUR LES ÉVÉNEMENTS, ET PAS UNE COLONNE DE PLUS
--    SUR `gardes` ────────────────────────────────────────────────────────────
--
-- `gardes.google_event_id` porte UN SEUL identifiant par ligne de garde. Le
-- nouveau schéma crée un événement Google PAR PERSONNE ET PAR JOUR — une garde
-- de week-end à deux vétérinaires sur trois jours, c'est jusqu'à six
-- événements. Une seule colonne ne peut pas porter ça ; une table à part le
-- peut, sans qu'il faille toucher `gardes` ni l'ancien chemin qui lit encore
-- `google_event_id` (bascule prévue dans un autre lot — CE N'EST PAS ICI).
--
-- ── L'ANTICIPATION V3 SUR `creneau_modele.libelle_agenda` ───────────────────
--
-- Le libellé de base de l'intitulé Google (« garde ») est porté par le
-- CRÉNEAU, pas codé en dur ni recalculé depuis `nom`. Un créneau de journée
-- ajouté plus tard (P5/V3) apporte directement son propre libellé sans
-- reprise de code — c'est le même raisonnement que `creneau_modele.nom`
-- lui-même : le moteur ne connaît que des créneaux génériques.
--
-- ── INSPECTION CONSUMERS (faite AVANT d'écrire) ─────────────────────────────
--   `veterinaires` : 66 fichiers la lisent (cf. migration secretariat_socle) ;
--   deux colonnes NULLABLE de plus ne changent le comportement d'AUCUN
--   d'entre eux (`select(...)` explicite partout dans ce projet, jamais de
--   `select('*')` sur cette table) — vérifié par grep, voir plus bas.
--   `creneau_modele` : lu par `chargerCreneauModele` (src/data/) via une liste
--   de colonnes explicite ; `libelle_agenda` n'y figure pas encore, l'ajouter
--   en base ne change donc rien tant que le loader n'est pas mis à jour dans
--   son propre lot.
--   `cabinets` : lu au cas par cas (pas de loader central) ; deux colonnes
--   `NOT NULL DEFAULT` ne cassent aucune lecture existante.
--   `garde_evenements` : table NEUVE, aucun lecteur existant.
--   Realtime : aucun écran ne s'abonne à ces colonnes ni à cette table —
--   la synchronisation Google est un job serveur, pas un affichage temps réel.
--   Rien à ajouter à `supabase_realtime` dans ce lot.
--
-- IDEMPOTENCE : `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
-- `DROP POLICY IF EXISTS`, une seule transaction — même discipline que le
-- reste du projet (cf. support_demandes, secretaires).
--
-- ⚠️ Cette migration N'EST PAS appliquée par cet agent — MiKL l'applique.
-- ============================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- 1. veterinaires : identité affichée côté Google Agenda
-- ───────────────────────────────────────────────────────────────

ALTER TABLE public.veterinaires
  ADD COLUMN IF NOT EXISTS couleur_google TEXT
    CHECK (couleur_google IS NULL OR couleur_google IN ('1','2','3','4','5','6','7','8','9','10','11'));

COMMENT ON COLUMN public.veterinaires.couleur_google IS
  'Identifiant de couleur Google Agenda (''1'' à ''11''), choisi par l''admin. '
  'NULL = l''événement garde la couleur par défaut de l''agenda.';

ALTER TABLE public.veterinaires
  ADD COLUMN IF NOT EXISTS libelle_agenda TEXT;

COMMENT ON COLUMN public.veterinaires.libelle_agenda IS
  'Nom affiché dans Google Agenda, personnalisé par l''admin. '
  'NULL = on calcule les initiales.';

-- ───────────────────────────────────────────────────────────────
-- 2. creneau_modele : la base de l'intitulé, par créneau (anticipation V3)
-- ───────────────────────────────────────────────────────────────

ALTER TABLE public.creneau_modele
  ADD COLUMN IF NOT EXISTS libelle_agenda TEXT;

COMMENT ON COLUMN public.creneau_modele.libelle_agenda IS
  'Base de l''intitulé Google Agenda pour ce créneau (ex. « garde »). '
  'NULL = on reprend `creneau_modele.nom`. Porté par le créneau et non codé '
  'en dur : un créneau ajouté plus tard (journée, V3) apporte son propre '
  'libellé sans reprise de code.';

-- ───────────────────────────────────────────────────────────────
-- 3. cabinets : réglages d'affichage de l'agenda
-- ───────────────────────────────────────────────────────────────

ALTER TABLE public.cabinets
  ADD COLUMN IF NOT EXISTS agenda_journee_entiere BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.cabinets.agenda_journee_entiere IS
  'Les événements Google Agenda sont posés en journée entière (true) ou avec '
  'des horaires précis (false).';

ALTER TABLE public.cabinets
  ADD COLUMN IF NOT EXISTS agenda_afficher_horaires BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cabinets.agenda_afficher_horaires IS
  'Les horaires du créneau apparaissent-ils dans le titre/la description de '
  'l''événement Google Agenda ?';

-- ───────────────────────────────────────────────────────────────
-- 4. garde_evenements : un événement Google par personne ET par jour
-- ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.garde_evenements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      UUID NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  garde_id        UUID NOT NULL REFERENCES public.gardes(id) ON DELETE CASCADE,
  jour            DATE NOT NULL,

  -- MÊME CONVENTION que `garde_placements.place_index` : 0 = 1er de garde,
  -- 1 = 2nd, 2+ = places suivantes (créneaux sur-mesure à 3/4 places).
  place_index     SMALLINT NOT NULL CHECK (place_index >= 0 AND place_index < 10),

  google_event_id TEXT NOT NULL,

  cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  mis_a_jour_le   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (garde_id, jour, place_index)
);

COMMENT ON TABLE public.garde_evenements IS
  'Un événement Google Agenda par (garde, jour, place) — `gardes.google_event_id` '
  'ne porte qu''UN identifiant par garde et reste utilisé par l''ancien chemin '
  'de synchronisation ; la bascule se fait dans un autre lot, pas ici.';

COMMENT ON COLUMN public.garde_evenements.place_index IS
  'Position 0-based de la place (0 = 1re place, 1 = 2e, …) — même convention '
  'que `garde_placements.place_index`.';

CREATE INDEX IF NOT EXISTS idx_garde_evenements_garde
  ON public.garde_evenements (garde_id);

ALTER TABLE public.garde_evenements ENABLE ROW LEVEL SECURITY;

-- Le visiteur non connecté n'a rien à faire ici (même discipline que
-- `demandes_support` / `secretaires` : deux verrous, pas un).
REVOKE ALL ON public.garde_evenements FROM anon;

-- Isolation cabinet, RESTRICTIVE : elle borne, elle n'accorde rien — même
-- motif que toutes les tables multi-cabinets du projet
-- (20260617153000_fix_rls_isolation_restrictive, secretaires, demandes_support).
DROP POLICY IF EXISTS "garde_evenements_cabinet_isolation" ON public.garde_evenements;
CREATE POLICY "garde_evenements_cabinet_isolation" ON public.garde_evenements
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = public.auth_cabinet_actif())
  WITH CHECK (cabinet_id = public.auth_cabinet_actif());

-- Écriture réservée à l'admin : c'est lui qui déclenche/gère la
-- synchronisation Google Agenda, comme pour le reste de la configuration
-- (`veterinaires`, `creneau_modele`, `cabinets`).
DROP POLICY IF EXISTS "garde_evenements_admin_all" ON public.garde_evenements;
CREATE POLICY "garde_evenements_admin_all" ON public.garde_evenements
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Lecture pour tout le cabinet : un vétérinaire (et la secrétaire, déjà
-- lectrice du planning) peut avoir besoin de savoir qu'un événement existe,
-- sans pouvoir le modifier.
DROP POLICY IF EXISTS "garde_evenements_read" ON public.garde_evenements;
CREATE POLICY "garde_evenements_read" ON public.garde_evenements
  FOR SELECT TO authenticated
  USING (get_user_role() IN ('admin', 'veto', 'secretaire'));

COMMIT;
