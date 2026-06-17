-- ============================================================
-- GUARDVETO — Migration 20260616160001 : brique_type sur contraintes_veto
-- Story : F4-001 — Normaliser le schéma config des contraintes
-- Auteur : ruflo — MonProjetPro
-- Date   : 2026-06-16
-- ============================================================
--
-- Ajoute une colonne discriminante qui indique le format du config_json.
-- 'legacy' = format V1 hétérogène (valeur par défaut pour les lignes existantes)
-- 'v2'     = grammaire 6-axes normalisée (archi §4.4)
--
-- La migration des données existantes vers 'v2' se fait en F4-002.
-- Cette migration est non-breaking : aucune contrainte existante n'est modifiée.

ALTER TABLE public.contraintes_veto
  ADD COLUMN IF NOT EXISTS brique_type TEXT NOT NULL DEFAULT 'legacy'
    CHECK (brique_type IN ('legacy', 'v2'));

COMMENT ON COLUMN public.contraintes_veto.brique_type IS
  'Format du config_json : legacy = format V1 hétérogène, v2 = grammaire 6-axes normalisée';
