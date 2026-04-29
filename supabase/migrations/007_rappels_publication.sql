-- STORY-021 — Rappels automatiques de publication
-- Colonnes pour tracer les rappels déjà envoyés (anti-doublon)

ALTER TABLE periodes
  ADD COLUMN IF NOT EXISTS rappel_15j_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rappel_7j_at  timestamptz DEFAULT NULL;

COMMENT ON COLUMN periodes.rappel_15j_at IS 'Timestamp du rappel J-15 envoyé (NULL = pas encore envoyé)';
COMMENT ON COLUMN periodes.rappel_7j_at  IS 'Timestamp du rappel J-7 envoyé (NULL = pas encore envoyé)';
