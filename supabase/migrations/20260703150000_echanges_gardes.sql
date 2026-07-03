-- ============================================================
-- GUARDVETO — Échanges de gardes self-service (backlog n°2)
-- Date : 2026-07-03
-- ------------------------------------------------------------
-- Un véto propose SA garde à UN confrère : soit en cession (le confrère la
-- prend), soit en échange contre une garde du confrère (contrepartie).
-- Le confrère accepte/refuse ; l'ADMIN valide (garde le contrôle) ; la
-- validation applique le changement via le chemin d'édition manuelle
-- existant (agenda + placements + emails + bilan hérités).
--
-- Statuts : proposee → acceptee → validee (appliquée)
--                    ↘ refusee            ↘ refusee_admin
--           proposee → annulee (par le demandeur)
--
-- RLS : modèle F5-003 — isolation cabinet AS RESTRICTIVE + policies
-- permissives bornées (demandeur / cible / admin). Pas de DELETE :
-- l'historique des échanges est conservé.
-- RÉVERSIBLE : DROP TABLE public.echanges_gardes; (+ retrait publication)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.echanges_gardes (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id            uuid        NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  -- La garde que le demandeur cède (toujours renseignée).
  garde_id              uuid        NOT NULL REFERENCES public.gardes(id) ON DELETE CASCADE,
  role_demandeur        text        NOT NULL CHECK (role_demandeur IN ('premier', 'second')),
  demandeur_id          uuid        NOT NULL REFERENCES public.veterinaires(id) ON DELETE CASCADE,
  cible_id              uuid        NOT NULL REFERENCES public.veterinaires(id) ON DELETE CASCADE,
  -- Contrepartie optionnelle : une garde de la cible reprise par le demandeur.
  -- NULL = cession simple (la cible prend la garde, rien en retour).
  garde_contrepartie_id uuid        REFERENCES public.gardes(id) ON DELETE SET NULL,
  role_contrepartie     text        CHECK (role_contrepartie IN ('premier', 'second')),
  message               text,
  statut                text        NOT NULL DEFAULT 'proposee'
    CHECK (statut IN ('proposee', 'acceptee', 'refusee', 'annulee', 'validee', 'refusee_admin')),
  motif_refus           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  -- Cohérence : une contrepartie va toujours avec son rôle, et on ne
  -- s'échange pas une garde avec soi-même.
  CONSTRAINT echanges_contrepartie_coherente
    CHECK ((garde_contrepartie_id IS NULL) = (role_contrepartie IS NULL)),
  CONSTRAINT echanges_pas_soi_meme CHECK (demandeur_id <> cible_id)
);

COMMENT ON TABLE public.echanges_gardes IS
  'Échanges de gardes entre vétérinaires (proposition → acceptation confrère → validation admin → application).';

-- ── Index ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_echanges_cabinet_statut
  ON public.echanges_gardes (cabinet_id, statut, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_echanges_demandeur
  ON public.echanges_gardes (demandeur_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_echanges_cible
  ON public.echanges_gardes (cible_id, created_at DESC);

-- ── updated_at (search_path épinglé — durcissement CERBÈRE) ──
CREATE OR REPLACE FUNCTION public.trigger_echanges_gardes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_echanges_gardes_updated_at ON public.echanges_gardes;
CREATE TRIGGER trg_echanges_gardes_updated_at
  BEFORE UPDATE ON public.echanges_gardes
  FOR EACH ROW EXECUTE FUNCTION public.trigger_echanges_gardes_updated_at();

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.echanges_gardes ENABLE ROW LEVEL SECURITY;

-- Isolation multi-cabinet : barrière dure RESTRICTIVE (modèle F5-003).
DROP POLICY IF EXISTS echanges_cabinet_isolation ON public.echanges_gardes;
CREATE POLICY echanges_cabinet_isolation
  ON public.echanges_gardes
  AS RESTRICTIVE
  FOR ALL
  USING (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- Lecture : les deux parties concernées + l'admin.
DROP POLICY IF EXISTS echanges_read_parties ON public.echanges_gardes;
CREATE POLICY echanges_read_parties
  ON public.echanges_gardes
  FOR SELECT
  USING (
    demandeur_id = get_veterinaire_id()
    OR cible_id = get_veterinaire_id()
    OR get_user_role() = 'admin'
  );

-- Insertion : uniquement en son propre nom, au statut initial.
DROP POLICY IF EXISTS echanges_insert_demandeur ON public.echanges_gardes;
CREATE POLICY echanges_insert_demandeur
  ON public.echanges_gardes
  FOR INSERT
  WITH CHECK (
    demandeur_id = get_veterinaire_id()
    AND statut = 'proposee'
  );

-- Mise à jour : demandeur (annuler), cible (accepter/refuser), admin (tout).
-- Les TRANSITIONS précises sont validées par les Server Actions (frontière
-- de confiance applicative) ; la RLS borne QUI peut toucher la ligne.
DROP POLICY IF EXISTS echanges_update_parties ON public.echanges_gardes;
CREATE POLICY echanges_update_parties
  ON public.echanges_gardes
  FOR UPDATE
  USING (
    demandeur_id = get_veterinaire_id()
    OR cible_id = get_veterinaire_id()
    OR get_user_role() = 'admin'
  )
  WITH CHECK (
    demandeur_id = get_veterinaire_id()
    OR cible_id = get_veterinaire_id()
    OR get_user_role() = 'admin'
  );

-- Pas de policy DELETE : l'historique est conservé (annulation = statut).

-- ── Realtime ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'echanges_gardes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.echanges_gardes;
  END IF;
END $$;
