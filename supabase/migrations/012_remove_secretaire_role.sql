-- ============================================================
-- GUARDVETO — Migration 012 : Suppression des résidus du rôle « secretaire »
-- Auteur : MAX — MonProjetPro
-- Date   : 2026-06-01
-- ------------------------------------------------------------
-- Le rôle « secretaire » a été retiré du modèle (la contrainte CHECK sur
-- veterinaires.role_app n'autorise plus que 'admin' et 'veto', et aucun
-- utilisateur n'a ce rôle). Il restait toutefois des références mortes
-- dans les policies RLS. On les nettoie pour aligner la sécurité sur le
-- modèle réel à 2 rôles.
--
-- Aucun changement de comportement effectif : la condition `= 'secretaire'`
-- était déjà toujours fausse. On supprime simplement le code mort.
-- ============================================================

-- Policy entièrement dédiée aux secrétaires : devenue inutile.
DROP POLICY IF EXISTS "gardes_secretaire_read" ON gardes;

-- Lecture de l'annuaire des vétos : retirer 'secretaire'.
DROP POLICY IF EXISTS "vet_read_all" ON veterinaires;
CREATE POLICY "vet_read_all" ON veterinaires
  FOR SELECT TO authenticated
  USING (actif = true AND get_user_role() = 'veto');

-- Lecture des périodes publiées : retirer 'secretaire'.
DROP POLICY IF EXISTS "periodes_read_publie" ON periodes;
CREATE POLICY "periodes_read_publie" ON periodes
  FOR SELECT TO authenticated
  USING (statut IN ('publie', 'verrouille') AND get_user_role() = 'veto');
