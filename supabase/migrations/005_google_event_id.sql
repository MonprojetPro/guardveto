-- ============================================================
-- GUARDVETO — Migration 005 : colonne google_event_id sur gardes
-- ============================================================
-- Stocke l'ID de l'événement Google Agenda associé à chaque garde
-- publiée. NULL si la synchro n'a pas encore eu lieu.
-- ============================================================

ALTER TABLE gardes
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

COMMENT ON COLUMN gardes.google_event_id IS 'ID événement Google Agenda — NULL si non synchronisé';
