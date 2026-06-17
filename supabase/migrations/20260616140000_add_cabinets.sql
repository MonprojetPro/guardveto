-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — F5-001 : Multi-tenant — Table cabinets
-- Auteur : ruflo — MonProjetPro
-- Date   : 2026-06-16
-- ───────────────────────────────────────────────────────────────
-- Crée la table `cabinets` qui représente un tenant (un cabinet
-- vétérinaire). Toutes les tables métier recevront une colonne
-- cabinet_id dans la migration suivante.
-- ═══════════════════════════════════════════════════════════════

-- Table cabinets (un tenant = un cabinet vétérinaire)
CREATE TABLE IF NOT EXISTS cabinets (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom           TEXT        NOT NULL,
  slug          TEXT        NOT NULL UNIQUE,
  actif         BOOLEAN     NOT NULL DEFAULT true,
  groupement_id UUID        NULL,           -- V3 : groupement multi-cabinets (vide pour l'instant)
  zone_scolaire TEXT        NOT NULL DEFAULT 'C'
                              CHECK (zone_scolaire IN ('A', 'B', 'C')),
  region_feries TEXT        NOT NULL DEFAULT 'metropole',
  timezone      TEXT        NOT NULL DEFAULT 'Europe/Paris',
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  mis_a_jour_le TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  cabinets               IS 'Tenants — un cabinet vétérinaire = un tenant';
COMMENT ON COLUMN cabinets.slug          IS 'Identifiant URL-safe unique du cabinet (ex: cabinet-durand)';
COMMENT ON COLUMN cabinets.groupement_id IS 'V3 — groupement multi-cabinets, non utilisé en V2';
COMMENT ON COLUMN cabinets.zone_scolaire IS 'Zone académique pour les vacances scolaires (A/B/C)';
COMMENT ON COLUMN cabinets.region_feries IS 'Région pour les jours fériés locaux (metropole, alsace-moselle…)';

-- Index
CREATE INDEX IF NOT EXISTS idx_cabinets_slug  ON cabinets(slug);
CREATE INDEX IF NOT EXISTS idx_cabinets_actif ON cabinets(actif);

-- ───────────────────────────────────────────────────────────────
-- RLS : lecture autorisée pour tout utilisateur authentifié
-- (un vétérinaire connecté a besoin de lire les infos de son cabinet).
-- INSERT / UPDATE / DELETE : aucune policy → bloqué pour authenticated.
-- Le service_role bypass RLS et reste l'unique voie d'administration.
-- ───────────────────────────────────────────────────────────────
ALTER TABLE cabinets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cabinets_select" ON cabinets
  FOR SELECT TO authenticated
  USING (true);

-- Pas de policy INSERT/UPDATE/DELETE pour authenticated :
-- ces opérations sont réservées au service_role (onboarding admin).
