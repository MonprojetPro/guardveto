-- ============================================================
-- GUARDVETO — B-120 : la contrainte des modules gardait RIEN
-- ============================================================
-- Trouve le 2026-09-11 en essayant de la faire mordre, pas en la relisant.
--
-- CE QUI SE PASSAIT : sur un tableau vide, `array_length(modules_actifs, 1)`
-- rend **NULL**, jamais 0. En PostgreSQL, une contrainte CHECK qui s'evalue a
-- NULL est consideree SATISFAITE. L'UPDATE vers `ARRAY[]::TEXT[]` passait donc
-- sans la moindre erreur : le cabinet muet que la contrainte devait interdire
-- etait parfaitement autorise.
--
-- ⚠️ Le defaut n'etait pas visible : la contrainte existait, elle apparaissait
--    dans le schema, et un `\d cabinets` l'aurait montree. Un garde-fou qui ne
--    garde rien est pire qu'un garde-fou absent — il donne la fausse assurance
--    que la question est reglee. Meme famille que la lecon du 26/08 : le code
--    etait ECRIT, il n'etait pas EXECUTE.
--
-- `cardinality()` rend 0 sur un tableau vide. La contrainte mord enfin.
-- Preuve : un UPDATE vers un tableau vide leve maintenant `check_violation`.
-- ============================================================

ALTER TABLE cabinets
  DROP CONSTRAINT IF EXISTS cabinets_modules_actifs_non_vide;

ALTER TABLE cabinets
  ADD CONSTRAINT cabinets_modules_actifs_non_vide
  CHECK (cardinality(modules_actifs) >= 1);
