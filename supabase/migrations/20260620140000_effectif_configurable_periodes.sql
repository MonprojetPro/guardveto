-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Effectif configurable : nb de vétos la nuit en semaine
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-06-20
-- Lot    : Règles structurelles configurables — Vague 1 (effectif)
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Rendre l'EFFECTIF de garde de semaine (1 ou 2 vétos la nuit) réglable
--   PAR PÉRIODE, au lieu d'être déduit en dur de la saison
--   (historique : hiver = 2 / 1er+2nd ; été = 1). Sert le besoin cabinet
--   « effectif été forçable » et le principe « toutes les règles réglables ».
--
-- SÛRETÉ
--   • Colonne NULLABLE : si NULL, le moteur retombe sur la saison (comportement
--     historique). Le loader la lit en best-effort → aucune contrainte d'ordre
--     de déploiement (le code marche avant ET après cette migration).
--   • Backfill explicite vers la valeur saison actuelle (hiver→2, été→1) :
--     ZÉRO changement de comportement, mais la valeur devient visible/éditable.
--   • CHECK (1,2) : seules ces deux valeurs sont gérées par le moteur.
--
-- IDEMPOTENCE : ADD COLUMN IF NOT EXISTS ; backfill scopé sur les NULL.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.periodes
  ADD COLUMN IF NOT EXISTS nb_vetos_semaine_soir INTEGER
  CHECK (nb_vetos_semaine_soir IN (1, 2));

COMMENT ON COLUMN public.periodes.nb_vetos_semaine_soir IS
  'Effectif configurable la nuit en semaine (1 ou 2). NULL = repli sur la saison (hiver 2 / été 1).';

-- Rendre explicite la valeur actuelle (déduite de la saison) sur les périodes existantes.
UPDATE public.periodes
SET    nb_vetos_semaine_soir = CASE WHEN saison = 'hiver' THEN 2 ELSE 1 END
WHERE  nb_vetos_semaine_soir IS NULL;

COMMIT;
