-- ============================================================
-- GUARDVETO — Nettoyage dette technique : DROP de la table `creneaux_cabinet`
-- Date : 2026-07-06 (backlog v2 §« Dettes techniques » — cluster dormant)
-- ------------------------------------------------------------
-- `creneaux_cabinet` était la surcouche cabinet-large des HORAIRES (migration
-- A1, 20260630120000). Elle est devenue DORMANTE avec P5 slice 4b : les horaires
-- sont désormais réglés PAR PROFIL, lus depuis `creneau_modele`
-- (`chargerStructureProfil`). Preuve de mort (code) — plus AUCUN référent vivant :
--   • lecteur `chargerStructureCabinet` : supprimé (aucun import) ;
--   • écrivains `upsertCreneauCabinet` / `resetCreneauCabinet` : supprimés
--     (seul appelant = composant orphelin `StructureCreneauxClient`, supprimé) ;
--   • composant `GenerateurPlanning` : orphelin, supprimé.
-- Le loader/persistance/agenda passent tous par `chargerStructureProfil`
-- (creneau_modele), jamais par `creneaux_cabinet`.
--
-- ⚠️ SÉCURITÉ DONNÉES (base client en PRODUCTION) : ce script REFUSE de dropper
-- si la table contient encore des lignes (surcharge historique d'un cabinet non
-- migrée) — il faut alors migrer ces horaires vers `creneau_modele` AVANT.
-- L'orchestrateur applique après vérification du project_ref.
--
-- RÉVERSIBLE : re-créer via la migration A1 (20260630120000).
-- ============================================================

-- 1. Garde-fou : abandonner si des données subsistent (à migrer d'abord).
DO $$
DECLARE
  n bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'creneaux_cabinet'
  ) THEN
    EXECUTE 'SELECT count(*) FROM public.creneaux_cabinet' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION
        'creneaux_cabinet contient % ligne(s) : migration ABANDONNÉE. Migrer ces horaires vers creneau_modele (par profil) AVANT de dropper.', n;
    END IF;
  END IF;
END $$;

-- 2. Drop de la table (emporte policies + trigger + index par CASCADE).
DROP TABLE IF EXISTS public.creneaux_cabinet CASCADE;

-- 3. Drop de la fonction de trigger dédiée (spécifique à cette table).
DROP FUNCTION IF EXISTS public.trigger_creneaux_cabinet_updated_at() CASCADE;
