-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — P3b slice 1 : table `garde_placements` (stockage N places)
-- Date : 2026-07-02
-- ───────────────────────────────────────────────────────────────
-- OBJECTIF (« on ajoute, on migre, on retire » — étape « on ajoute »)
--   La table `gardes` (V1) ne stocke que 2 rôles en dur (premier_id/second_id).
--   Pour permettre N vétérinaires par garde, on ajoute une table ENFANT de
--   `gardes` : une ligne par PLACE occupée (place_index + label de rôle + véto).
--
-- ADDITIF & SANS RISQUE (P3b-1)
--   • AUCUN lecteur pour l'instant : la double écriture (route /api/generate)
--     remplit cette table EN PARALLÈLE de gardes.premier_id/second_id ; rien ne
--     lit encore garde_placements → zéro effet visuel, entièrement réversible.
--   • Enfant de gardes via ON DELETE CASCADE : quand la génération supprime les
--     gardes brouillon, leurs placements partent automatiquement (pas d'orphelin).
--   • veterinaire_id RESTRICT (miroir de gardes.premier_id) : on ne peut pas
--     supprimer physiquement un véto encore placé (les vétos sont archivés, pas
--     supprimés) → parité avec le comportement V1.
--
-- SÉCURITÉ — RLS modèle F5-003 (identique à `attributions`)
--   Isolation cabinet RESTRICTIVE (ne donne aucun droit, borne au cabinet)
--   + écriture PERMISSIVE réservée à l'admin + lecture PERMISSIVE tout authentifié.
--   La génération écrit via le client AUTHENTIFIÉ de l'admin → couvert par
--   garde_placements_admin_write. Cross-tenant = restrictive FALSE → refusé.
--
-- IDEMPOTENT : IF NOT EXISTS + DROP POLICY IF EXISTS. Transaction atomique.
-- Ne modifie AUCUNE donnée existante — création pure.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.garde_placements (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid        NOT NULL REFERENCES public.cabinets(id)      ON DELETE CASCADE,
  garde_id       uuid        NOT NULL REFERENCES public.gardes(id)        ON DELETE CASCADE,
  place_index    smallint    NOT NULL CHECK (place_index >= 0 AND place_index < 10),
  role           text        NOT NULL,
  veterinaire_id uuid        NOT NULL REFERENCES public.veterinaires(id),
  cree_le        timestamptz NOT NULL DEFAULT now(),
  mis_a_jour_le  timestamptz NOT NULL DEFAULT now(),
  -- Une place au plus par index sur une garde (idempotence de la double écriture).
  UNIQUE (garde_id, place_index)
);

COMMENT ON TABLE  public.garde_placements            IS 'P3b : 1 ligne = 1 place occupée d''une garde (généralise premier_id/second_id vers N places).';
COMMENT ON COLUMN public.garde_placements.place_index IS 'Position 0-based de la place (0 = 1re place, 1 = 2e, …).';
COMMENT ON COLUMN public.garde_placements.role        IS 'Label du rôle du catalogue (premier, second, …) — pas de sémantique en dur.';

CREATE INDEX IF NOT EXISTS idx_garde_placements_garde   ON public.garde_placements(garde_id);
CREATE INDEX IF NOT EXISTS idx_garde_placements_veto    ON public.garde_placements(veterinaire_id);
CREATE INDEX IF NOT EXISTS idx_garde_placements_cabinet ON public.garde_placements(cabinet_id);

-- ───────────────────────────────────────────────────────────────
-- TRIGGER updated_at (mis_a_jour_le) — dédié, comme les autres tables V2
-- ───────────────────────────────────────────────────────────────
-- search_path épinglé (durcissement CERBÈRE : évite le WARN function_search_path_mutable).
CREATE OR REPLACE FUNCTION public.trigger_garde_placements_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.mis_a_jour_le = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS garde_placements_mis_a_jour_le ON public.garde_placements;
CREATE TRIGGER garde_placements_mis_a_jour_le
  BEFORE UPDATE ON public.garde_placements
  FOR EACH ROW EXECUTE FUNCTION public.trigger_garde_placements_updated_at();

-- ───────────────────────────────────────────────────────────────
-- RLS — modèle F5-003 (miroir exact de attributions)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.garde_placements ENABLE ROW LEVEL SECURITY;

-- 1. Isolation cabinet → RESTRICTIVE (borne au cabinet, n'accorde aucun droit).
DROP POLICY IF EXISTS "garde_placements_cabinet_isolation" ON public.garde_placements;
CREATE POLICY "garde_placements_cabinet_isolation" ON public.garde_placements
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING      (cabinet_id = auth_cabinet_actif())
  WITH CHECK (cabinet_id = auth_cabinet_actif());

-- 2. Écriture réservée à l'admin (PERMISSIVE).
DROP POLICY IF EXISTS "garde_placements_admin_write" ON public.garde_placements;
CREATE POLICY "garde_placements_admin_write" ON public.garde_placements
  FOR ALL TO authenticated
  USING      (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 3. Lecture pour tout authentifié (PERMISSIVE) — la restrictive borne au cabinet.
DROP POLICY IF EXISTS "garde_placements_read_auth" ON public.garde_placements;
CREATE POLICY "garde_placements_read_auth" ON public.garde_placements
  FOR SELECT TO authenticated
  USING (true);

COMMIT;
