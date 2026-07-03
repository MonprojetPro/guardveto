-- ============================================================
-- GUARDVETO — Échanges slice 2 : proposition OUVERTE « à tous »
-- Date : 2026-07-03
-- ------------------------------------------------------------
-- `cible_id` devient NULLABLE : NULL = proposition ouverte à tous les
-- confrères du cabinet, PREMIER ARRIVÉ PREMIER SERVI. L'acceptation
-- « réclame » la proposition (UPDATE conditionnel cible_id IS NULL →
-- cible_id = moi, statut = acceptee) : la course est tranchée par la base.
--
-- Une proposition ouverte est forcément une CESSION (pas de contrepartie :
-- on ne peut pas s'engager à reprendre la garde de « n'importe qui »).
-- RÉVERSIBLE : repasser cible_id NOT NULL après avoir purgé les NULL.
-- ============================================================

ALTER TABLE public.echanges_gardes
  ALTER COLUMN cible_id DROP NOT NULL;

-- Une proposition ouverte n'a jamais de contrepartie.
ALTER TABLE public.echanges_gardes
  DROP CONSTRAINT IF EXISTS echanges_ouvert_sans_contrepartie;
ALTER TABLE public.echanges_gardes
  ADD CONSTRAINT echanges_ouvert_sans_contrepartie
  CHECK (cible_id IS NOT NULL OR garde_contrepartie_id IS NULL);

-- Lecture : les propositions OUVERTES sont visibles par tous les vétos du
-- cabinet (l'isolation RESTRICTIVE borne déjà au cabinet).
DROP POLICY IF EXISTS echanges_read_parties ON public.echanges_gardes;
CREATE POLICY echanges_read_parties
  ON public.echanges_gardes
  FOR SELECT
  USING (
    demandeur_id = get_veterinaire_id()
    OR cible_id = get_veterinaire_id()
    OR cible_id IS NULL
    OR get_user_role() = 'admin'
  );

-- Mise à jour : + « réclamer » une proposition ouverte (n'importe quel véto
-- du cabinet peut poser sa candidature ; la transition exacte — CAS sur
-- statut='proposee' AND cible_id IS NULL — est validée par la Server Action).
DROP POLICY IF EXISTS echanges_update_parties ON public.echanges_gardes;
CREATE POLICY echanges_update_parties
  ON public.echanges_gardes
  FOR UPDATE
  USING (
    demandeur_id = get_veterinaire_id()
    OR cible_id = get_veterinaire_id()
    OR (cible_id IS NULL AND statut = 'proposee')
    OR get_user_role() = 'admin'
  )
  WITH CHECK (
    demandeur_id = get_veterinaire_id()
    OR cible_id = get_veterinaire_id()
    OR get_user_role() = 'admin'
  );
