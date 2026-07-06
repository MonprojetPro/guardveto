-- ============================================================
-- GUARDVETO — RG1 (relations génériques, tranche 1) : relation_creneau
-- devient PROFIL-AWARE + seed des 2 relations historiques (ex R8/R9)
-- ============================================================
-- Epic : structure des gardes 100 % sur-mesure — verrou n°4 du doc 09
--        (docs/v2/09-architecture-structure-sur-mesure.md, phase P4).
--
-- CONTEXTE : la table `relation_creneau` existe depuis P1 (20260701150000)
-- mais n'a JAMAIS été seedée ni consommée. Depuis P5, le catalogue
-- `creneau_modele` est rattaché à un PROFIL de planning (profil_id, unicité
-- par profil). Les relations lient des créneaux d'un profil : elles doivent
-- donc être profil-aware elles aussi, sinon impossible de les dupliquer avec
-- un profil ou de les filtrer proprement.
--
-- CETTE MIGRATION (donnée seule — AUCUN EFFET MOTEUR, le moteur ne lit les
-- relations qu'en tranche 2) :
--   1. `relation_creneau.profil_id` (FK profils_planning, CASCADE) + backfill
--      depuis le profil du créneau source + index.
--   2. Garde d'intégrité (trigger) : source, cible et relation doivent
--      appartenir au MÊME cabinet et au MÊME profil.
--   3. Seed : pour CHAQUE profil de CHAQUE cabinet, les 2 relations
--      historiques vendredi_soir → weekend :
--        • meme_binome    (ex R9 — même équipe le vendredi soir et le WE)
--        • inversion_role (ex R8 — rôles différents entre les deux)
--      Défaut = comportement d'aujourd'hui : quand le moteur les consommera
--      (tranche 2), ces lignes reproduiront EXACTEMENT R8/R9 actuels.
--
-- SÉCURITÉ : RLS déjà en place depuis P1 (modèle F5-003 durci : isolation
-- RESTRICTIVE + write admin + read auth) — inchangée ici.
-- IDEMPOTENCE : IF NOT EXISTS ; ON CONFLICT DO NOTHING ; OR REPLACE.
-- RÉVERSIBLE : DROP COLUMN profil_id + DROP TRIGGER + DELETE du seed.
-- ============================================================

BEGIN;

-- ── 1. profil_id + backfill + index ─────────────────────────
ALTER TABLE public.relation_creneau
  ADD COLUMN IF NOT EXISTS profil_id uuid
  REFERENCES public.profils_planning(id) ON DELETE CASCADE;

-- Backfill depuis le profil du créneau source (table vide en pratique :
-- le seed P1 ne créait aucune relation — défensif si des lignes existent).
UPDATE public.relation_creneau rc
SET profil_id = cm.profil_id
FROM public.creneau_modele cm
WHERE cm.id = rc.source_id
  AND rc.profil_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_relation_creneau_profil
  ON public.relation_creneau (profil_id);

COMMENT ON COLUMN public.relation_creneau.profil_id IS
  'Profil de planning auquel la relation appartient (= profil de ses deux créneaux)';

-- ── 2. Garde d'intégrité : cabinet + profil cohérents ───────
-- Une relation ne peut lier que deux créneaux du MÊME cabinet et du MÊME
-- profil que la relation elle-même (un CHECK ne peut pas regarder une autre
-- table → trigger). Écritures admin (UI tranche 4 / assistant IA) protégées.
CREATE OR REPLACE FUNCTION public.trigger_relation_creneau_coherence()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_src RECORD;
  v_cib RECORD;
BEGIN
  SELECT cabinet_id, profil_id INTO v_src FROM public.creneau_modele WHERE id = NEW.source_id;
  SELECT cabinet_id, profil_id INTO v_cib FROM public.creneau_modele WHERE id = NEW.cible_id;
  IF v_src IS NULL OR v_cib IS NULL THEN
    RAISE EXCEPTION 'relation_creneau: créneau source ou cible introuvable';
  END IF;
  IF v_src.cabinet_id <> NEW.cabinet_id OR v_cib.cabinet_id <> NEW.cabinet_id THEN
    RAISE EXCEPTION 'relation_creneau: source/cible d''un autre cabinet';
  END IF;
  IF NEW.profil_id IS NOT NULL
     AND (v_src.profil_id IS DISTINCT FROM NEW.profil_id
          OR v_cib.profil_id IS DISTINCT FROM NEW.profil_id) THEN
    RAISE EXCEPTION 'relation_creneau: source/cible d''un autre profil que la relation';
  END IF;
  IF NEW.source_id = NEW.cible_id THEN
    RAISE EXCEPTION 'relation_creneau: un créneau ne peut pas être lié à lui-même';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS relation_creneau_coherence ON public.relation_creneau;
CREATE TRIGGER relation_creneau_coherence
  BEFORE INSERT OR UPDATE ON public.relation_creneau
  FOR EACH ROW EXECUTE FUNCTION public.trigger_relation_creneau_coherence();

-- ── 3. Seed : les 2 relations historiques pour chaque profil ─
-- vendredi_soir (source) → weekend (cible), dans le MÊME profil.
INSERT INTO public.relation_creneau (cabinet_id, profil_id, source_id, cible_id, genre)
SELECT src.cabinet_id, src.profil_id, src.id, cib.id, g.genre
FROM public.creneau_modele src
JOIN public.creneau_modele cib
  ON  cib.cabinet_id = src.cabinet_id
  AND cib.profil_id IS NOT DISTINCT FROM src.profil_id
  AND cib.code = 'weekend'
CROSS JOIN (VALUES ('meme_binome'), ('inversion_role')) AS g(genre)
WHERE src.code = 'vendredi_soir'
ON CONFLICT (cabinet_id, source_id, cible_id, genre) DO NOTHING;

COMMIT;
