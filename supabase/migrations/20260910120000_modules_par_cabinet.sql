-- ============================================================
-- GUARDVETO — B-120 chantier 1 : modules activables par cabinet
-- ============================================================
-- Decision ① de MiKL (09/09) : un seul produit, des modules qu'on allume
-- cabinet par cabinet. Cette colonne est aussi le ROBINET DE ROLLOUT de la
-- V3 (decision ⑨) : le planning journee reste eteint partout sauf sur le
-- bac a sable, et la bascule chez Val d'Allier sera un reglage, pas un
-- deploiement.
--
-- Valeur par defaut 'gardes' : tout cabinet existant garde EXACTEMENT ce
-- qu'il avait. Aucune migration de donnees, aucun changement visible.
-- ============================================================

ALTER TABLE cabinets
  ADD COLUMN IF NOT EXISTS modules_actifs TEXT[] NOT NULL DEFAULT ARRAY['gardes'];

COMMENT ON COLUMN cabinets.modules_actifs IS
  'Modules allumes pour ce cabinet. Catalogue de reference : src/lib/produit/modules.ts';

-- Un cabinet sans aucun module serait un compte muet : on l'interdit.
ALTER TABLE cabinets
  DROP CONSTRAINT IF EXISTS cabinets_modules_actifs_non_vide;

ALTER TABLE cabinets
  ADD CONSTRAINT cabinets_modules_actifs_non_vide
  CHECK (array_length(modules_actifs, 1) >= 1);
