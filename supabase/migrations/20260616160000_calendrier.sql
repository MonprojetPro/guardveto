-- ============================================================
-- GUARDVETO V2 — F3-001 : Tables de référentiel calendaire
-- Migration idempotente (DROP TABLE CASCADE + recréation, ON CONFLICT DO NOTHING)
-- Auteur : ruflo — 2026-06-16
-- ============================================================
--
-- ⚠️ TRANSITION DE SCHÉMA V1 → V2
-- Les tables `jours_feries` et `vacances_scolaires` existent déjà au schéma V1
-- (cf. migration-complete-client.sql) avec des colonnes différentes :
--   jours_feries V1       : (id, date, nom)
--   vacances_scolaires V1 : (id, date_debut, date_fin, nom, zone)
-- Le schéma V2 cible est incompatible (libelle/region ; debut/fin/label/annee…).
--
-- Ces deux tables sont du RÉFÉRENTIEL PARTAGÉ (pas de cabinet_id). Vérification
-- faite : AUCUNE table métier n'a de clé étrangère (REFERENCES) vers elles
-- (gardes, attributions, conges, periodes… ne les référencent pas). Le seul
-- consumer applicatif est src/app/api/export-pdf/route.ts (lecture seule) —
-- voir le rapport d'impact consumers.
--
-- On peut donc DROP ... CASCADE en sécurité : cela supprime aussi les anciennes
-- policies V1 (jours_feries_read_all, jours_feries_admin_write,
-- vacances_read_all, vacances_admin_write) sans dépendance résiduelle.
-- Idempotent : DROP IF EXISTS + CREATE TABLE + ON CONFLICT DO NOTHING.

-- ─────────────────────────────────────────────────────────────
-- 0. TRANSITION : supprimer les tables V1 (et leurs policies)
-- ─────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.jours_feries        CASCADE;
DROP TABLE IF EXISTS public.vacances_scolaires  CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 1. TABLE : jours_feries (schéma V2)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.jours_feries (
  id      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  annee   INTEGER NOT NULL,
  date    DATE    NOT NULL,
  libelle TEXT    NOT NULL,
  -- Région de France concernée par ce jour férié
  region  TEXT    NOT NULL DEFAULT 'metropole'
             CHECK (region IN (
               'metropole',
               'alsace-moselle',
               'guadeloupe',
               'martinique',
               'guyane',
               'reunion',
               'mayotte',
               'polynesie'
             ))
);

-- Index d'unicité : une date est unique par région
CREATE UNIQUE INDEX IF NOT EXISTS idx_jours_feries_date_region
  ON public.jours_feries(date, region);

-- Index de recherche par année
CREATE INDEX IF NOT EXISTS idx_jours_feries_annee
  ON public.jours_feries(annee);

-- ─────────────────────────────────────────────────────────────
-- 2. TABLE : vacances_scolaires
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vacances_scolaires (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Année scolaire de début (ex : 2025 pour 2025-2026)
  annee_debut INTEGER NOT NULL,
  -- Année scolaire de fin (ex : 2026 pour 2025-2026)
  annee_fin   INTEGER NOT NULL,
  -- Zone scolaire académique (A, B ou C)
  zone        TEXT    NOT NULL CHECK (zone IN ('A', 'B', 'C')),
  -- Libellé humain (ex : "Vacances de Noël 2025-2026")
  label       TEXT    NOT NULL,
  -- Premier jour des vacances (inclusif)
  debut       DATE    NOT NULL,
  -- Dernier jour des vacances (inclusif)
  fin         DATE    NOT NULL
);

-- Index de recherche par zone
CREATE INDEX IF NOT EXISTS idx_vacances_zone
  ON public.vacances_scolaires(zone);

-- Index d'unicité : une période est unique par (zone, debut, fin)
-- → rend le ON CONFLICT du seed déterministe et la migration idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vacances_zone_debut_fin
  ON public.vacances_scolaires(zone, debut, fin);

-- ─────────────────────────────────────────────────────────────
-- 3. RLS — Row Level Security
-- ─────────────────────────────────────────────────────────────

-- Activer RLS sur jours_feries (idempotent — pas de IF NOT ENABLED)
ALTER TABLE public.jours_feries        ENABLE ROW LEVEL SECURITY;
-- Activer RLS sur vacances_scolaires
ALTER TABLE public.vacances_scolaires  ENABLE ROW LEVEL SECURITY;

-- Les anciennes policies V1 (jours_feries_admin_write, vacances_admin_write,
-- jours_feries_read_all, vacances_read_all) ont déjà été supprimées par le
-- DROP TABLE ... CASCADE de la section 0. On (re)crée les policies V2.
-- ⚠️ CREATE POLICY IF NOT EXISTS n'existe PAS en PostgreSQL → on utilise
--    DROP POLICY IF EXISTS puis CREATE POLICY (idempotent, re-jouable).

-- Policy de lecture : tout utilisateur authentifié peut lire les référentiels
DROP POLICY IF EXISTS "jours_feries_read_auth" ON public.jours_feries;
CREATE POLICY "jours_feries_read_auth"
  ON public.jours_feries
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "vacances_read_auth" ON public.vacances_scolaires;
CREATE POLICY "vacances_read_auth"
  ON public.vacances_scolaires
  FOR SELECT
  TO authenticated
  USING (true);

-- ⚠️ Aucune policy INSERT/UPDATE/DELETE pour authenticated.
-- Les écritures sont réservées au service_role (hors RLS) — contrainte C3 archi §6.2.

-- ─────────────────────────────────────────────────────────────
-- 4. SEED — Jours fériés 2025 (métropole)
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.jours_feries (annee, date, libelle, region) VALUES
  (2025, '2025-01-01', '1er janvier — Jour de l''An',       'metropole'),
  (2025, '2025-04-21', 'Lundi de Pâques',                   'metropole'),
  (2025, '2025-05-01', '1er mai — Fête du Travail',         'metropole'),
  (2025, '2025-05-08', '8 mai — Victoire 1945',             'metropole'),
  (2025, '2025-05-29', 'Ascension',                         'metropole'),
  (2025, '2025-06-09', 'Lundi de Pentecôte',                'metropole'),
  (2025, '2025-07-14', '14 juillet — Fête Nationale',       'metropole'),
  (2025, '2025-08-15', '15 août — Assomption',              'metropole'),
  (2025, '2025-11-01', '1er novembre — Toussaint',          'metropole'),
  (2025, '2025-11-11', '11 novembre — Armistice',           'metropole'),
  (2025, '2025-12-25', '25 décembre — Noël',                'metropole')
ON CONFLICT (date, region) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 5. SEED — Jours fériés 2026 (métropole)
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.jours_feries (annee, date, libelle, region) VALUES
  (2026, '2026-01-01', '1er janvier — Jour de l''An',       'metropole'),
  (2026, '2026-04-06', 'Lundi de Pâques',                   'metropole'),
  (2026, '2026-05-01', '1er mai — Fête du Travail',         'metropole'),
  (2026, '2026-05-08', '8 mai — Victoire 1945',             'metropole'),
  (2026, '2026-05-14', 'Ascension',                         'metropole'),
  (2026, '2026-05-25', 'Lundi de Pentecôte',                'metropole'),
  (2026, '2026-07-14', '14 juillet — Fête Nationale',       'metropole'),
  (2026, '2026-08-15', '15 août — Assomption',              'metropole'),
  (2026, '2026-11-01', '1er novembre — Toussaint',          'metropole'),
  (2026, '2026-11-11', '11 novembre — Armistice',           'metropole'),
  (2026, '2026-12-25', '25 décembre — Noël',                'metropole')
ON CONFLICT (date, region) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 5b. SEED — Jours fériés 2027 (métropole)
--    Complète le référentiel : un planning d'hiver 2026-2027
--    s'étend sur 2027 et a besoin de ses fériés.
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.jours_feries (annee, date, libelle, region) VALUES
  (2027, '2027-01-01', '1er janvier — Jour de l''An',       'metropole'),
  (2027, '2027-03-29', 'Lundi de Pâques',                   'metropole'),
  (2027, '2027-05-01', '1er mai — Fête du Travail',         'metropole'),
  (2027, '2027-05-06', 'Ascension',                         'metropole'),
  (2027, '2027-05-08', '8 mai — Victoire 1945',             'metropole'),
  (2027, '2027-05-17', 'Lundi de Pentecôte',                'metropole'),
  (2027, '2027-07-14', '14 juillet — Fête Nationale',       'metropole'),
  (2027, '2027-08-15', '15 août — Assomption',              'metropole'),
  (2027, '2027-11-01', '1er novembre — Toussaint',          'metropole'),
  (2027, '2027-11-11', '11 novembre — Armistice',           'metropole'),
  (2027, '2027-12-25', '25 décembre — Noël',                'metropole')
ON CONFLICT (date, region) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 6a. SEED — Vacances scolaires Zone C (Paris/Île-de-France)
--    Données extraites de src/engine/utils.ts (VACANCES_SCOLAIRES)
--    Conservées comme référentiel multi-cabinet (zone C).
-- ─────────────────────────────────────────────────────────────

-- Année scolaire 2025-2026
INSERT INTO public.vacances_scolaires (annee_debut, annee_fin, zone, label, debut, fin) VALUES
  (2025, 2026, 'C', 'Toussaint 2025',      '2025-10-18', '2025-11-03'),
  (2025, 2026, 'C', 'Noël 2025-2026',      '2025-12-20', '2026-01-05'),
  (2025, 2026, 'C', 'Hiver 2026',          '2026-02-14', '2026-03-02'),
  (2025, 2026, 'C', 'Pâques 2026',         '2026-04-11', '2026-04-27'),
  (2025, 2026, 'C', 'Été 2026',            '2026-07-04', '2026-08-31')
ON CONFLICT (zone, debut, fin) DO NOTHING;

-- Année scolaire 2026-2027
INSERT INTO public.vacances_scolaires (annee_debut, annee_fin, zone, label, debut, fin) VALUES
  (2026, 2027, 'C', 'Toussaint 2026',      '2026-10-17', '2026-11-02'),
  (2026, 2027, 'C', 'Noël 2026-2027',      '2026-12-19', '2027-01-04'),
  (2026, 2027, 'C', 'Hiver 2027',          '2027-02-13', '2027-03-01'),
  (2026, 2027, 'C', 'Pâques 2027',         '2027-04-10', '2027-04-26'),
  (2026, 2027, 'C', 'Été 2027',            '2027-07-03', '2027-08-31')
ON CONFLICT (zone, debut, fin) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 6b. SEED — Vacances scolaires Zone A (cabinet pilote : Cusset,
--    Allier, académie de Clermont-Ferrand → zone_scolaire = 'A')
--    OBLIGATOIRE : sans ces lignes, get_calendrier renvoie un
--    tableau de vacances vide pour le cabinet pilote.
--
--    ⚠️ Les dates zone A diffèrent de la zone C (notamment Hiver et
--    Printemps). Dates officielles vérifiées (juin 2026) sur :
--      - vacances-scolaires-education.fr (académie Clermont-Ferrand)
--      - vacances-scolaires-gouv.com (zone A)
--    Convention : 'fin' = jour de reprise des cours (inclusif côté
--    chevauchement), aligné sur le seed zone C existant.
-- ─────────────────────────────────────────────────────────────

-- Année scolaire 2025-2026 (zone A)
INSERT INTO public.vacances_scolaires (annee_debut, annee_fin, zone, label, debut, fin) VALUES
  (2025, 2026, 'A', 'Toussaint 2025',      '2025-10-18', '2025-11-03'),
  (2025, 2026, 'A', 'Noël 2025-2026',      '2025-12-20', '2026-01-05'),
  (2025, 2026, 'A', 'Hiver 2026',          '2026-02-07', '2026-02-23'),
  (2025, 2026, 'A', 'Pâques 2026',         '2026-04-04', '2026-04-20'),
  (2025, 2026, 'A', 'Été 2026',            '2026-07-04', '2026-09-01')
ON CONFLICT (zone, debut, fin) DO NOTHING;

-- Année scolaire 2026-2027 (zone A)
INSERT INTO public.vacances_scolaires (annee_debut, annee_fin, zone, label, debut, fin) VALUES
  (2026, 2027, 'A', 'Toussaint 2026',      '2026-10-17', '2026-11-02'),
  (2026, 2027, 'A', 'Noël 2026-2027',      '2026-12-19', '2027-01-04'),
  (2026, 2027, 'A', 'Hiver 2027',          '2027-02-13', '2027-03-01'),
  (2026, 2027, 'A', 'Pâques 2027',         '2027-04-10', '2027-04-26'),
  (2026, 2027, 'A', 'Été 2027',            '2027-07-03', '2027-09-01')
ON CONFLICT (zone, debut, fin) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 7. FONCTION : get_calendrier
--    Retourne fériés + vacances scolaires pour une période,
--    scopé sur la région et la zone scolaire du cabinet.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_calendrier(
  p_cabinet_id UUID,
  p_date_debut DATE,
  p_date_fin   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_region   TEXT;
  v_zone     TEXT;
  v_feries   JSONB;
  v_vacances JSONB;
BEGIN
  -- Récupérer la région et la zone scolaire du cabinet
  SELECT region_feries, zone_scolaire
    INTO v_region, v_zone
    FROM public.cabinets
   WHERE id = p_cabinet_id
     AND actif = true;

  -- Cabinet introuvable ou inactif : retourner NULL
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Fériés dans la plage de dates, filtrés par région du cabinet
  SELECT jsonb_agg(
           jsonb_build_object(
             'date',    date::TEXT,
             'libelle', libelle
           )
           ORDER BY date
         )
    INTO v_feries
    FROM public.jours_feries
   WHERE region = v_region
     AND date BETWEEN p_date_debut AND p_date_fin;

  -- Vacances scolaires qui chevauchent la plage, filtrées par zone du cabinet
  SELECT jsonb_agg(
           jsonb_build_object(
             'debut', debut::TEXT,
             'fin',   fin::TEXT,
             'label', label
           )
           ORDER BY debut
         )
    INTO v_vacances
    FROM public.vacances_scolaires
   WHERE zone  = v_zone
     AND debut <= p_date_fin
     AND fin   >= p_date_debut;

  -- Retourner le calendrier complet (tableaux vides si aucune donnée)
  RETURN jsonb_build_object(
    'feries',   COALESCE(v_feries,   '[]'::JSONB),
    'vacances', COALESCE(v_vacances, '[]'::JSONB)
  );
END;
$$;

-- Sécurité : anon n'a pas accès à cette fonction
REVOKE EXECUTE ON FUNCTION public.get_calendrier(UUID, DATE, DATE) FROM anon;
-- Les utilisateurs authentifiés (admins + vétos) peuvent appeler cette fonction
GRANT  EXECUTE ON FUNCTION public.get_calendrier(UUID, DATE, DATE) TO authenticated;
