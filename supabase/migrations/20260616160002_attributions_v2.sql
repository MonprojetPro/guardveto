-- ============================================================
-- GUARDVETO — Migration : Attributions V2 + Créneaux catalogue
-- Story   : F1-001
-- Auteur  : ruflo — MonProjetPro
-- Date    : 2026-06-16
-- ============================================================
-- Crée deux tables :
--   1. creneaux_catalogue  — référentiel des types de créneaux avec leurs horaires
--   2. attributions        — table de vérité complète d'une affectation (remplace gardes V2)
--
-- La table `gardes` reste inchangée — la migration des données est prévue en F1-002.
-- Cette migration est idempotente (IF NOT EXISTS, ON CONFLICT DO NOTHING).
-- ============================================================

-- ============================================================
-- TABLE : creneaux_catalogue
-- Référentiel des types de créneaux avec leurs offsets horaires par défaut.
-- Code unique, identique aux valeurs TypeGardeEngine du moteur.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.creneaux_catalogue (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Code machine — aligné sur TypeGardeEngine : 'semaine_soir' | 'vendredi_soir' | 'weekend' | 'ferie'
  code         TEXT        NOT NULL UNIQUE,
  libelle      TEXT        NOT NULL,
  heure_debut  TIME        NOT NULL DEFAULT '18:30',
  heure_fin    TIME        NOT NULL DEFAULT '08:30',
  -- Indique si le créneau couvre une nuit (et donc chevauche 2 jours calendaires)
  est_nuit     BOOLEAN     NOT NULL DEFAULT true,
  -- Indique si le créneau tombe en week-end (samedi/dimanche)
  est_weekend  BOOLEAN     NOT NULL DEFAULT false,
  -- Durée en heures (calculée une fois pour éviter de la recalculer partout)
  duree_heures NUMERIC(4,1)
);

COMMENT ON TABLE  public.creneaux_catalogue              IS 'Référentiel des types de créneaux de garde avec leurs horaires par défaut';
COMMENT ON COLUMN public.creneaux_catalogue.code         IS 'Code machine — aligné sur TypeGardeEngine (semaine_soir, vendredi_soir, weekend, ferie)';
COMMENT ON COLUMN public.creneaux_catalogue.heure_debut  IS 'Heure de prise de garde (locale, Europe/Paris)';
COMMENT ON COLUMN public.creneaux_catalogue.heure_fin    IS 'Heure de fin de garde (locale, Europe/Paris) — peut être le lendemain si est_nuit = true';
COMMENT ON COLUMN public.creneaux_catalogue.est_nuit     IS 'Vrai si le créneau couvre une nuit et chevauche deux jours calendaires';
COMMENT ON COLUMN public.creneaux_catalogue.est_weekend  IS 'Vrai si le créneau est un week-end (samedi/dimanche)';
COMMENT ON COLUMN public.creneaux_catalogue.duree_heures IS 'Durée totale du créneau en heures (précalculée)';

-- Seed des types de créneaux standard (idempotent via ON CONFLICT DO NOTHING)
INSERT INTO public.creneaux_catalogue (code, libelle, heure_debut, heure_fin, est_nuit, est_weekend, duree_heures)
VALUES
  ('semaine_soir',  'Soir de semaine (lun-jeu)',  '18:30', '08:30', true,  false, 14.0),
  ('vendredi_soir', 'Soir du vendredi',           '18:30', '08:30', true,  false, 14.0),
  ('weekend',       'Week-end (sam+dim)',          '08:30', '08:30', false, true,  48.0),
  ('ferie',         'Jour férié',                 '08:30', '08:30', false, false, 24.0)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- RLS — creneaux_catalogue (référentiel partagé, lecture seule)
-- Sans RLS, toute table Supabase est lisible ET modifiable par tout
-- authenticated → un cabinet pourrait altérer le catalogue partagé.
-- On verrouille : lecture pour les authentifiés, écriture réservée
-- au service_role (hors RLS).
-- DROP avant CREATE pour rester idempotent (CREATE POLICY n'a pas de IF NOT EXISTS).
-- ============================================================
ALTER TABLE public.creneaux_catalogue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "creneaux_read_auth" ON public.creneaux_catalogue;
CREATE POLICY "creneaux_read_auth" ON public.creneaux_catalogue
  FOR SELECT TO authenticated USING (true);
-- ⚠️ Aucune policy INSERT/UPDATE/DELETE : écritures réservées au service_role.

-- ============================================================
-- TABLE : attributions
-- Table de vérité complète d'une affectation.
-- Une ligne = un vétérinaire, un créneau, un rôle.
-- Remplace la logique premier_id/second_id de la table gardes.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attributions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Isolation multi-tenant — scopé sur le cabinet
  cabinet_id       UUID        NOT NULL REFERENCES public.cabinets(id),
  -- FK vers periodes (sera renommée en plannings lors de F6-002)
  planning_id      UUID        NOT NULL,
  -- Créneau de référence (type, horaires par défaut)
  creneau_id       UUID        REFERENCES public.creneaux_catalogue(id),
  -- Vétérinaire affecté
  veterinaire_id   UUID        NOT NULL REFERENCES public.veterinaires(id),
  -- Rôle dans la garde : 'premier' = responsable principal, 'second' = backup
  role             TEXT        NOT NULL DEFAULT 'premier'
                                 CHECK (role IN ('premier', 'second')),
  -- Mode de présence : sur_place ou astreinte téléphonique
  type_presence    TEXT        NOT NULL DEFAULT 'sur_place'
                                 CHECK (type_presence IN ('sur_place', 'astreinte')),
  -- Dates réelles horodatées (timezone incluse) — permettent le chevauchement de jours
  date_debut_reel  TIMESTAMPTZ NOT NULL,
  date_fin_reel    TIMESTAMPTZ NOT NULL,
  -- Lien vers le snapshot des règles actives au moment de la génération (peuplé en F8-001)
  snapshot_id      UUID        NULL,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
  mis_a_jour_le    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attributions_dates_coherentes CHECK (date_fin_reel > date_debut_reel)
);

COMMENT ON TABLE  public.attributions                    IS 'Table de vérité complète des affectations de garde — une ligne par vétérinaire par créneau';
COMMENT ON COLUMN public.attributions.cabinet_id         IS 'Isolation multi-tenant — scopé sur le cabinet propriétaire';
COMMENT ON COLUMN public.attributions.planning_id        IS 'FK vers periodes (sera renommée plannings en F6-002)';
COMMENT ON COLUMN public.attributions.creneau_id         IS 'Type de créneau de référence (NULL si créneau manuel non catalogué)';
COMMENT ON COLUMN public.attributions.role               IS 'Rôle dans la garde : premier = responsable principal, second = backup';
COMMENT ON COLUMN public.attributions.type_presence      IS 'Mode de présence : sur_place (physique) ou astreinte (téléphonique)';
COMMENT ON COLUMN public.attributions.date_debut_reel    IS 'Début réel de la garde avec timezone — peut différer du début théorique du créneau';
COMMENT ON COLUMN public.attributions.date_fin_reel      IS 'Fin réelle de la garde avec timezone — peut différer de la fin théorique du créneau';
COMMENT ON COLUMN public.attributions.snapshot_id        IS 'Référence au snapshot des règles actives au moment de la génération (FK peuplée en F8-001)';

-- Trigger : mise à jour automatique de mis_a_jour_le
-- Réutilise trigger_set_updated_at() créé dans 001_tables.sql si elle existe,
-- sinon crée une variante locale nommée différemment pour éviter les conflits.
CREATE OR REPLACE FUNCTION trigger_attributions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.mis_a_jour_le = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER attributions_mis_a_jour_le
  BEFORE UPDATE ON public.attributions
  FOR EACH ROW EXECUTE FUNCTION trigger_attributions_updated_at();

-- ============================================================
-- INDEX — Requêtes typiques de l'application
-- ============================================================

-- Requête principale : toutes les attributions d'un planning pour un cabinet
CREATE INDEX IF NOT EXISTS idx_attributions_cabinet_planning
  ON public.attributions(cabinet_id, planning_id);

-- Historique d'un vétérinaire dans un cabinet, trié par date
CREATE INDEX IF NOT EXISTS idx_attributions_cabinet_vet_date
  ON public.attributions(cabinet_id, veterinaire_id, date_debut_reel);

-- Jointure avec les snapshots de règles (partiel : uniquement les lignes liées)
CREATE INDEX IF NOT EXISTS idx_attributions_snapshot
  ON public.attributions(snapshot_id) WHERE snapshot_id IS NOT NULL;

-- ============================================================
-- RLS — Row Level Security
-- Isolation stricte par cabinet via auth_cabinet_actif()
-- (Fonction définie dans F5-001 : retourne le cabinet_id depuis app_metadata du JWT)
-- ============================================================
ALTER TABLE public.attributions ENABLE ROW LEVEL SECURITY;

-- Politique unique : un utilisateur authentifié ne voit et ne modifie
-- que les attributions de son propre cabinet.
-- DROP avant CREATE pour rester idempotent (CREATE POLICY n'a pas de IF NOT EXISTS).
DROP POLICY IF EXISTS "attributions_cabinet_isolation" ON public.attributions;
CREATE POLICY "attributions_cabinet_isolation" ON public.attributions
  FOR ALL TO authenticated
  USING     (cabinet_id = auth_cabinet_actif())
  WITH CHECK(cabinet_id = auth_cabinet_actif());

COMMENT ON POLICY "attributions_cabinet_isolation" ON public.attributions
  IS 'Isolation multi-tenant stricte — chaque cabinet voit uniquement ses propres attributions';
