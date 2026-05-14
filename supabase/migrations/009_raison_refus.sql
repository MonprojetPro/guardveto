-- ============================================================
-- GUARDVETO — Migration 009 : Raison du refus
-- ============================================================
ALTER TABLE conges ADD COLUMN IF NOT EXISTS raison_refus TEXT;
COMMENT ON COLUMN conges.raison_refus IS 'Motif de refus renseigné par l''admin';
