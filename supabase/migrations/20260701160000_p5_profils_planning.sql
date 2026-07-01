-- ============================================================
-- GUARDVETO — P5 slice 2 : profils de planning nommés (fondation données)
-- ============================================================
-- Un CABINET compose des PROFILS de planning nommés (« Hiver », « Été »,
-- « Vacances »…). Chaque profil = un jeu de types de garde (catalogue). À la
-- génération d'une période, le cabinet sélectionnera un profil (slice 3).
--
-- Cette migration pose UNIQUEMENT la structure (effet nul, byte-identique) :
--   1. table `profils_planning` (RLS restrictive, modèle F5-003).
--   2. seed d'UN profil défaut par cabinet (« Configuration standard »).
--   3. `creneau_modele.profil_id` → rattache les types existants au profil
--      défaut de leur cabinet.
-- Le loader lira le catalogue du profil défaut → MÊMES types qu'aujourd'hui.
-- L'effectif (nb_vetos_semaine_soir) reste sur la période ; il rejoindra le
-- profil en slice 3 (sélection à la génération).
-- ============================================================

BEGIN;

-- ── 1. Table profils_planning ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.profils_planning (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      uuid NOT NULL REFERENCES public.cabinets(id) ON DELETE CASCADE,
  nom             text NOT NULL,
  actif           boolean NOT NULL DEFAULT true,
  -- Exactement un profil défaut par cabinet (cf. index partiel plus bas).
  est_defaut      boolean NOT NULL DEFAULT false,
  -- Saison proposée par défaut à la génération (pure suggestion UI, nullable).
  saison_suggeree text NULL CHECK (saison_suggeree IN ('ete', 'hiver')),
  ordre           smallint NOT NULL DEFAULT 1,
  cree_le         timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profils_planning_nom_unique UNIQUE (cabinet_id, nom)
);

COMMENT ON TABLE public.profils_planning IS
  'Profils de planning nommés d''un cabinet (structure réutilisable, sélectionnée à la génération d''une période)';
COMMENT ON COLUMN public.profils_planning.est_defaut IS
  'Le profil utilisé quand aucun n''est explicitement choisi (un seul par cabinet)';
COMMENT ON COLUMN public.profils_planning.saison_suggeree IS
  'Saison proposée par défaut à la génération pour ce profil (suggestion UI, nullable)';

CREATE INDEX IF NOT EXISTS idx_profils_planning_cab
  ON public.profils_planning (cabinet_id, actif);
-- Un seul profil défaut par cabinet.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profils_planning_defaut
  ON public.profils_planning (cabinet_id) WHERE est_defaut;

-- Trigger mis_a_jour_le
CREATE OR REPLACE FUNCTION public.trigger_profils_planning_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.mis_a_jour_le = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profils_planning_mis_a_jour_le ON public.profils_planning;
CREATE TRIGGER profils_planning_mis_a_jour_le
  BEFORE UPDATE ON public.profils_planning
  FOR EACH ROW EXECUTE FUNCTION public.trigger_profils_planning_updated_at();

-- ── 2. Seed : un profil défaut par cabinet ─────────────────
INSERT INTO public.profils_planning (cabinet_id, nom, est_defaut, ordre)
SELECT c.id, 'Configuration standard', true, 1
FROM public.cabinets c
ON CONFLICT (cabinet_id, nom) DO NOTHING;

-- ── 3. creneau_modele.profil_id + rattachement au profil défaut ──
ALTER TABLE public.creneau_modele
  ADD COLUMN IF NOT EXISTS profil_id uuid
  REFERENCES public.profils_planning(id) ON DELETE CASCADE;

UPDATE public.creneau_modele cm
SET profil_id = p.id
FROM public.profils_planning p
WHERE p.cabinet_id = cm.cabinet_id
  AND p.est_defaut
  AND cm.profil_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_creneau_modele_profil
  ON public.creneau_modele (profil_id);

-- ── 4. RLS (modèle F5-003 durci) — miroir de creneau_modele ──
ALTER TABLE public.profils_planning ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profils_planning_isolation" ON public.profils_planning;
CREATE POLICY "profils_planning_isolation" ON public.profils_planning
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

DROP POLICY IF EXISTS "profils_planning_admin_write" ON public.profils_planning;
CREATE POLICY "profils_planning_admin_write" ON public.profils_planning
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "profils_planning_read_auth" ON public.profils_planning;
CREATE POLICY "profils_planning_read_auth" ON public.profils_planning
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
