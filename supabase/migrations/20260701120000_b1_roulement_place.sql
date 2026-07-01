-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — B1/B2 : Table roulement_place (roulement ordonné par place)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-01
-- Epic   : structure configurable + roulement ordonné
--          (docs/v2/07-epic-structure-roulement.md) — Fondation B
-- ───────────────────────────────────────────────────────────────
-- ⚠️ MIGRATION DE SÉCURITÉ — crée des policies RLS. Appliquée sur mpvrok.
--
-- OBJET
--   Chaque PLACE d'une garde (couple type de créneau × rôle 1er/2nd) peut
--   être, PAR CABINET, soit `genere` (le moteur optimise, défaut historique)
--   soit `roulement` (un ordre figé qui tourne : Manon → Antoine → …).
--   C'est le modèle « par place » validé par MiKL : le moteur ne touche pas
--   au figé et optimise le reste.
--
--   politique_conge (quand mode=roulement) : que faire si le véto dont c'est
--   le tour est en congé ?
--     - 'saute'       : on passe au suivant, le tour est perdu.
--     - 'garde_place' : un autre prend ce créneau, mais l'absent repasse en
--                        priorité dès qu'il est de nouveau disponible.
--
--   sequence_vets : ordre du roulement (tableau d'UUID de vétérinaires).
--     Pas de FK possible sur un tableau → intégrité validée côté application.
--   position_reprise : index où le roulement reprend d'une période à l'autre
--     (sinon il repartirait de zéro chaque saison → équité cassée).
--
--   ⚠️ Table vide / mode 'genere' partout = comportement ACTUEL inchangé.
--   Le moteur ne consomme cette table qu'en B4 (à venir). Ici : stockage seul.
--
-- SÉCURITÉ — modèle F5-003 durci (identique à regles_cabinet / creneaux_cabinet) :
--   isolation RESTRICTIVE + écriture admin-only + lecture authentifiés.
-- IDEMPOTENCE : IF NOT EXISTS ; DROP POLICY IF EXISTS. Transaction atomique.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.roulement_place (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       UUID NOT NULL REFERENCES public.cabinets(id),
  -- Type de créneau (aligné TypeGardeEngine).
  code             TEXT NOT NULL,
  -- Place dans la garde : 1er ou 2nd.
  role             TEXT NOT NULL CHECK (role IN ('premier', 'second')),
  -- Mode de génération de CETTE place.
  mode             TEXT NOT NULL DEFAULT 'genere'
                     CHECK (mode IN ('genere', 'roulement')),
  -- Que faire si le véto de tour est en congé (mode=roulement).
  politique_conge  TEXT NOT NULL DEFAULT 'saute'
                     CHECK (politique_conge IN ('saute', 'garde_place')),
  -- Ordre du roulement (UUID de vétérinaires). Vide si mode=genere.
  sequence_vets    UUID[] NOT NULL DEFAULT '{}',
  -- Index de reprise du roulement d'une période à l'autre.
  position_reprise INTEGER NOT NULL DEFAULT 0 CHECK (position_reprise >= 0),
  actif            BOOLEAN NOT NULL DEFAULT true,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  mis_a_jour_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un seul réglage par (cabinet, type de créneau, place).
  CONSTRAINT roulement_place_unique UNIQUE (cabinet_id, code, role)
);

CREATE INDEX IF NOT EXISTS idx_roulement_place_cab
  ON public.roulement_place (cabinet_id);

COMMENT ON TABLE public.roulement_place IS
  'Mode de génération PAR PLACE (type de créneau × rôle) par cabinet : genere (moteur) ou roulement (ordre figé). Vide/genere = comportement actuel. RLS durcie F5-003.';
COMMENT ON COLUMN public.roulement_place.sequence_vets    IS 'Ordre du roulement (UUID vétérinaires) — intégrité validée côté application (pas de FK sur array)';
COMMENT ON COLUMN public.roulement_place.position_reprise IS 'Index de reprise du roulement entre périodes (continuité de l''équité)';
COMMENT ON COLUMN public.roulement_place.politique_conge  IS 'saute = tour perdu ; garde_place = l''absent repasse en priorité dès dispo';

CREATE OR REPLACE FUNCTION trigger_roulement_place_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.mis_a_jour_le = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roulement_place_mis_a_jour_le ON public.roulement_place;
CREATE TRIGGER roulement_place_mis_a_jour_le
  BEFORE UPDATE ON public.roulement_place
  FOR EACH ROW EXECUTE FUNCTION trigger_roulement_place_updated_at();

ALTER TABLE public.roulement_place ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roulement_place_isolation" ON public.roulement_place;
CREATE POLICY "roulement_place_isolation" ON public.roulement_place
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

DROP POLICY IF EXISTS "roulement_place_admin_write" ON public.roulement_place;
CREATE POLICY "roulement_place_admin_write" ON public.roulement_place
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "roulement_place_read_auth" ON public.roulement_place;
CREATE POLICY "roulement_place_read_auth" ON public.roulement_place
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
