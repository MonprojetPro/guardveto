-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — P1 : Catalogue de créneaux (fondamentaux universels)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-01
-- Epic   : structure des gardes 100 % sur-mesure
--          (docs/v2/09-architecture-structure-sur-mesure.md) — Phase 1
-- ───────────────────────────────────────────────────────────────
-- ⚠️ MIGRATION DE SÉCURITÉ (crée des policies RLS). Appliquée sur mpvrok.
--
-- PRINCIPE (MiKL) : le moteur a ses fondamentaux universels ; l'IA traduit
-- le langage du cabinet vers ces fondamentaux. Le fondamental unique = le
-- CRÉNEAU : { jours, fenêtre horaire, nb places/rôles, relations }. Les 4
-- types historiques ne sont plus du code : ce sont 4 lignes de données.
--
-- ⚠️ AUCUN EFFET MOTEUR ICI (P1 = donnée seule). Le moteur ne lit ce
-- catalogue qu'en P2. Le seed reproduit EXACTEMENT les 4 types actuels pour
-- chaque cabinet → défaut = comportement d'aujourd'hui (filet de non-régression).
--
-- SÉCURITÉ — modèle F5-003 durci (isolation RESTRICTIVE + write admin + read auth).
-- IDEMPOTENCE : IF NOT EXISTS ; DROP POLICY IF EXISTS ; seed ON CONFLICT DO NOTHING.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE creneau_modele — un créneau = un primitif planifiable
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.creneau_modele (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       UUID NOT NULL REFERENCES public.cabinets(id),
  -- Code machine des 4 créneaux par défaut (semaine_soir…). NULL = sur-mesure.
  code             TEXT,
  nom              TEXT NOT NULL,
  -- Jours d'application (0=dim … 6=sam). Vide possible si sur_feries.
  jours_semaine    SMALLINT[] NOT NULL DEFAULT '{}',
  -- S'applique les jours fériés (au lieu / en plus des jours de semaine).
  sur_feries       BOOLEAN NOT NULL DEFAULT false,
  -- Fenêtre horaire (locale Europe/Paris). Libre : matin, après-midi, ou nuit.
  heure_debut      TIME NOT NULL,
  heure_fin        TIME NOT NULL,
  offset_jours_fin SMALLINT NOT NULL DEFAULT 1 CHECK (offset_jours_fin BETWEEN 0 AND 3),
  -- Nombre de places (vétos) et noms des rôles (longueur idéalement = nb_places).
  nb_places        SMALLINT NOT NULL DEFAULT 1 CHECK (nb_places BETWEEN 1 AND 10),
  roles            TEXT[] NOT NULL DEFAULT '{}',
  actif            BOOLEAN NOT NULL DEFAULT true,
  ordre            SMALLINT NOT NULL DEFAULT 0,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  mis_a_jour_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un seul créneau par (cabinet, code) pour les créneaux catalogués.
  CONSTRAINT creneau_modele_code_unique UNIQUE (cabinet_id, code),
  CONSTRAINT creneau_modele_nom_unique  UNIQUE (cabinet_id, nom)
);

CREATE INDEX IF NOT EXISTS idx_creneau_modele_cab ON public.creneau_modele (cabinet_id, actif);

COMMENT ON TABLE public.creneau_modele IS
  'Catalogue des créneaux par cabinet (fondamental universel du moteur). Les 4 types historiques = 4 lignes seed. RLS durcie F5-003. Consommé par le moteur à partir de P2.';
COMMENT ON COLUMN public.creneau_modele.code          IS 'Code des 4 créneaux par défaut (semaine_soir/vendredi_soir/weekend/ferie) ; NULL si sur-mesure';
COMMENT ON COLUMN public.creneau_modele.jours_semaine IS 'Jours d''application (0=dim … 6=sam)';
COMMENT ON COLUMN public.creneau_modele.roles         IS 'Noms des rôles/places (ex {premier,second}) ; longueur = nb_places';

-- ───────────────────────────────────────────────────────────────
-- TABLE relation_creneau — relations universelles entre créneaux
-- (remplace R8/R9 en dur : le cabinet/l'IA les expriment en donnée)
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.relation_creneau (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     UUID NOT NULL REFERENCES public.cabinets(id),
  source_id      UUID NOT NULL REFERENCES public.creneau_modele(id) ON DELETE CASCADE,
  cible_id       UUID NOT NULL REFERENCES public.creneau_modele(id) ON DELETE CASCADE,
  -- 'meme_binome' (ex R9), 'inversion_role' (ex R8), 'repos_apres' (repos après garde).
  genre          TEXT NOT NULL CHECK (genre IN ('meme_binome', 'inversion_role', 'repos_apres')),
  actif          BOOLEAN NOT NULL DEFAULT true,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT relation_creneau_unique UNIQUE (cabinet_id, source_id, cible_id, genre)
);

CREATE INDEX IF NOT EXISTS idx_relation_creneau_cab ON public.relation_creneau (cabinet_id);

COMMENT ON TABLE public.relation_creneau IS
  'Relations universelles entre créneaux par cabinet (remplace R8/R9 en dur). Consommé par le moteur à partir de P4.';

-- ───────────────────────────────────────────────────────────────
-- Trigger mis_a_jour_le sur creneau_modele
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_creneau_modele_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.mis_a_jour_le = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS creneau_modele_mis_a_jour_le ON public.creneau_modele;
CREATE TRIGGER creneau_modele_mis_a_jour_le
  BEFORE UPDATE ON public.creneau_modele
  FOR EACH ROW EXECUTE FUNCTION trigger_creneau_modele_updated_at();

-- ───────────────────────────────────────────────────────────────
-- SEED — les 4 types actuels pour CHAQUE cabinet (défaut = aujourd'hui)
-- ───────────────────────────────────────────────────────────────
INSERT INTO public.creneau_modele
  (cabinet_id, code, nom, jours_semaine, sur_feries, heure_debut, heure_fin, offset_jours_fin, nb_places, roles, ordre)
SELECT c.id, v.code, v.nom, v.jours, v.sur_feries, v.hd::time, v.hf::time, v.off, v.places, v.roles, v.ordre
FROM public.cabinets c
CROSS JOIN (VALUES
  ('semaine_soir',  'Soir de semaine (lun-jeu)', ARRAY[1,2,3,4]::smallint[], false, '18:30', '08:30', 1::smallint, 2::smallint, ARRAY['premier','second']::text[], 1::smallint),
  ('vendredi_soir', 'Soir du vendredi',          ARRAY[5]::smallint[],       false, '18:30', '08:30', 1::smallint, 2::smallint, ARRAY['premier','second']::text[], 2::smallint),
  ('weekend',       'Week-end (sam+dim)',         ARRAY[6]::smallint[],       false, '08:30', '08:30', 2::smallint, 2::smallint, ARRAY['premier','second']::text[], 3::smallint),
  ('ferie',         'Jour férié',                ARRAY[]::smallint[],        true,  '08:30', '08:30', 1::smallint, 2::smallint, ARRAY['premier','second']::text[], 4::smallint)
) AS v(code, nom, jours, sur_feries, hd, hf, off, places, roles, ordre)
ON CONFLICT (cabinet_id, code) DO NOTHING;

-- ───────────────────────────────────────────────────────────────
-- SÉCURITÉ — RLS (modèle F5-003 durci) sur les deux tables
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.creneau_modele ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "creneau_modele_isolation" ON public.creneau_modele;
CREATE POLICY "creneau_modele_isolation" ON public.creneau_modele
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

DROP POLICY IF EXISTS "creneau_modele_admin_write" ON public.creneau_modele;
CREATE POLICY "creneau_modele_admin_write" ON public.creneau_modele
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "creneau_modele_read_auth" ON public.creneau_modele;
CREATE POLICY "creneau_modele_read_auth" ON public.creneau_modele
  FOR SELECT TO authenticated
  USING (true);

ALTER TABLE public.relation_creneau ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "relation_creneau_isolation" ON public.relation_creneau;
CREATE POLICY "relation_creneau_isolation" ON public.relation_creneau
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

DROP POLICY IF EXISTS "relation_creneau_admin_write" ON public.relation_creneau;
CREATE POLICY "relation_creneau_admin_write" ON public.relation_creneau
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "relation_creneau_read_auth" ON public.relation_creneau;
CREATE POLICY "relation_creneau_read_auth" ON public.relation_creneau
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
