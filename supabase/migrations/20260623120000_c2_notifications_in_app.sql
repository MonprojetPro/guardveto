-- ============================================================
-- GUARDVETO — C2 : Notifications in-app (la cloche)
-- Auteur : MAX — MonProjetPro
-- Date   : 2026-06-23
-- ------------------------------------------------------------
-- OBJECTIF : doter GuardVeto d'un système de notifications IN-APP (cloche dans
-- le header) en PARALLÈLE des emails Brevo existants. Chaque événement qui
-- envoie déjà un email (planning publié, garde modifiée, rappel publication,
-- appel aux volontaires, dépannage confirmé) crée AUSSI une notif in-app.
--
-- Données PERSONNELLES : une notif appartient à UN vétérinaire. Chacun ne voit
-- QUE ses propres notifs (RLS personnelle via get_veterinaire_id()), en plus de
-- l'isolation multi-cabinet RESTRICTIVE (auth_cabinet_actif()).
--
-- REALTIME : la table est ajoutée à la publication supabase_realtime. Realtime
-- applique la RLS SELECT → un client ne reçoit un event QUE sur une notif qu'il
-- a le droit de lire (= les siennes). On ne diffuse jamais la notif d'autrui.
--
-- RÉVERSIBLE : DROP TABLE public.notifications;  (+ retrait publication)
-- ============================================================

-- ── Table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid        REFERENCES public.cabinets(id) ON DELETE CASCADE,
  veterinaire_id uuid        NOT NULL REFERENCES public.veterinaires(id) ON DELETE CASCADE,
  -- type libre (pas de CHECK strict) : de nouveaux types seront ajoutés au fil
  -- du développement de l'app (cf. audit notifs prévu en fin de dev). Valeurs
  -- actuelles : planning_publie | garde_modifiee | rappel_publication |
  --             appel_volontaires | depannage_confirme
  type           text        NOT NULL,
  titre          text        NOT NULL,
  message        text        NOT NULL,
  -- lien interne optionnel vers l'écran concerné (ex: /planning, /crise)
  lien           text,
  lu             boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS
  'Notifications in-app (cloche). Une ligne = une notif personnelle pour un véto.';

-- ── Index ─────────────────────────────────────────────────────
-- Listing + compteur non-lus : on filtre par véto, on trie par date desc.
CREATE INDEX IF NOT EXISTS idx_notifications_vet_created
  ON public.notifications (veterinaire_id, created_at DESC);

-- Compteur de non-lus (badge) : index partiel sur les non-lues uniquement.
CREATE INDEX IF NOT EXISTS idx_notifications_vet_unread
  ON public.notifications (veterinaire_id)
  WHERE lu = false;

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Isolation multi-cabinet (RESTRICTIVE) : barrière dure, s'applique en plus de
-- toute policy PERMISSIVE. Aucune fuite inter-cabinets, même en lecture.
DROP POLICY IF EXISTS notifications_cabinet_isolation ON public.notifications;
CREATE POLICY notifications_cabinet_isolation
  ON public.notifications
  AS RESTRICTIVE
  FOR ALL
  USING (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- Lecture PERSONNELLE : un véto ne lit QUE ses propres notifs.
DROP POLICY IF EXISTS notifications_read_own ON public.notifications;
CREATE POLICY notifications_read_own
  ON public.notifications
  FOR SELECT
  USING (veterinaire_id = get_veterinaire_id());

-- Mise à jour PERSONNELLE : un véto ne peut marquer comme lues QUE ses notifs
-- (et ne peut pas se les réattribuer — WITH CHECK identique).
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own
  ON public.notifications
  FOR UPDATE
  USING (veterinaire_id = get_veterinaire_id())
  WITH CHECK (veterinaire_id = get_veterinaire_id());

-- Insertion : réservée aux admins authentifiés (publication, modif manuelle…).
-- Les contextes sans session (cron rappels, dépannage volontaire via lien email)
-- passent par le client service_role, qui contourne nativement la RLS.
DROP POLICY IF EXISTS notifications_insert_admin ON public.notifications;
CREATE POLICY notifications_insert_admin
  ON public.notifications
  FOR INSERT
  WITH CHECK (get_user_role() = 'admin');

-- ── Realtime ──────────────────────────────────────────────────
-- Ajout à la publication (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
