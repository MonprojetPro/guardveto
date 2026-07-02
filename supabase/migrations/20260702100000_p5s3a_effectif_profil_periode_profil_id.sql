-- ============================================================
-- GUARDVETO — P5 slice 3a : effectif au profil + periode.profil_id
-- ============================================================
-- FONDATION DONNÉES de la slice 3 (effet nul, byte-identique).
--
-- Deux ajouts, aucune lecture branchée ici (le branchement moteur est en 3b) :
--   1. profils_planning.nb_vetos_semaine_soir (nullable) — l'effectif « 1 ou 2
--      de garde la nuit en semaine » devient une propriété du PROFIL (ex.
--      Hiver=2, Été=1). Laissé NULL sur le profil défaut → aucune surcharge :
--      la précédence de lecture (3b) sera `période ?? profil ?? saison`, donc
--      les périodes existantes (déjà backfillées 2/1) gardent leur valeur.
--   2. periodes.profil_id (nullable, FK) — mémorise le profil choisi à la
--      génération (slice 3c). NULL = profil défaut du cabinet → même catalogue
--      et même effectif qu'aujourd'hui. ON DELETE SET NULL : supprimer un profil
--      ne supprime JAMAIS une période, elle retombe sur le défaut.
--
-- SÛRETÉ : colonnes nullables, aucun backfill, aucune valeur seedée → le code
-- d'avant comme d'après cette migration se comporte à l'identique. La RLS
-- restrictive existante (F5-003) de chaque table couvre déjà les nouvelles
-- colonnes (pas de policy à ajouter).
--
-- IDEMPOTENCE : ADD COLUMN IF NOT EXISTS. RÉVERSIBLE : DROP COLUMN.
-- ============================================================

BEGIN;

-- ── 1. Effectif → propriété du profil (miroir du CHECK de la période) ──
ALTER TABLE public.profils_planning
  ADD COLUMN IF NOT EXISTS nb_vetos_semaine_soir INTEGER
  CHECK (nb_vetos_semaine_soir IN (1, 2));

COMMENT ON COLUMN public.profils_planning.nb_vetos_semaine_soir IS
  'Effectif de garde la nuit en semaine (1 ou 2) porté par le profil. NULL = pas de surcharge profil → la période décide (sa valeur, sinon repli saison hiver 2 / été 1).';

-- ── 2. Période → profil choisi (nullable, repli défaut) ──────
ALTER TABLE public.periodes
  ADD COLUMN IF NOT EXISTS profil_id uuid
  REFERENCES public.profils_planning(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.periodes.profil_id IS
  'Profil de planning choisi pour cette période (structure + effectif). NULL = profil défaut du cabinet (byte-identique). Figé dans le snapshot à la génération (slice 3d).';

CREATE INDEX IF NOT EXISTS idx_periodes_profil
  ON public.periodes (profil_id);

COMMIT;
