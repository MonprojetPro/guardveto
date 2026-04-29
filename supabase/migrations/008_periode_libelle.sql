-- STORY-021 addendum — Titre personnalisé de la période
ALTER TABLE periodes ADD COLUMN IF NOT EXISTS libelle text DEFAULT NULL;
COMMENT ON COLUMN periodes.libelle IS 'Titre personnalisé de la période (optionnel)';
