-- ============================================================
-- GUARDVETO — P5 slice 4a : unicité des créneaux PAR PROFIL (prérequis builder)
-- ============================================================
-- PROBLÈME découvert en implémentant le builder de profils : `creneau_modele`
-- portait deux contraintes d'unicité CABINET-larges, héritées d'avant les
-- profils (slice 2 n'y avait pas touché) :
--     UNIQUE (cabinet_id, code)   et   UNIQUE (cabinet_id, nom)
-- Elles empêchent un cabinet d'avoir DEUX profils comportant chacun un créneau
-- `semaine_soir` (même code / même nom) → dupliquer un profil échoue.
--
-- CORRECTIF : rendre l'unicité PAR PROFIL. Un profil ne peut toujours pas avoir
-- deux fois le même code / nom, mais des profils DIFFÉRENTS le peuvent.
--     UNIQUE (cabinet_id, profil_id, code)   et   UNIQUE (cabinet_id, profil_id, nom)
--
-- SÛRETÉ : strictement PLUS permissif. Les données actuelles (1 profil/cabinet,
-- 4 codes/noms distincts) satisfont l'ancienne ET la nouvelle contrainte →
-- byte-identique. Aucun consommateur ne s'appuie sur l'unicité globale du code
-- (le loader scope toujours par profil ; le seul upsert onConflict cabinet_id,code
-- porte sur `creneaux_cabinet`, une autre table). `code` reste nullable (types
-- sur-mesure) : NULL distinct en SQL → plusieurs types sur-mesure possibles.
--
-- IDEMPOTENCE : DROP IF EXISTS + ADD (garde-fou anti-double-application via noms).
-- ============================================================

BEGIN;

ALTER TABLE public.creneau_modele DROP CONSTRAINT IF EXISTS creneau_modele_code_unique;
ALTER TABLE public.creneau_modele DROP CONSTRAINT IF EXISTS creneau_modele_nom_unique;

ALTER TABLE public.creneau_modele
  DROP CONSTRAINT IF EXISTS creneau_modele_profil_code_unique,
  ADD  CONSTRAINT creneau_modele_profil_code_unique UNIQUE (cabinet_id, profil_id, code);

ALTER TABLE public.creneau_modele
  DROP CONSTRAINT IF EXISTS creneau_modele_profil_nom_unique,
  ADD  CONSTRAINT creneau_modele_profil_nom_unique UNIQUE (cabinet_id, profil_id, nom);

COMMIT;
