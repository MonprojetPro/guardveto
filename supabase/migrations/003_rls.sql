-- ============================================================
-- GUARDVETO — Migration 003 : Row Level Security (RLS)
-- Auteur : SPARK — MonProjetPro
-- Date   : 2026-04-24
-- ============================================================

-- ============================================================
-- Fonction utilitaire : récupère le rôle du user connecté
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role_app
  FROM veterinaires
  WHERE user_id = auth.uid()
    AND actif = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_user_role IS 'Retourne le rôle_app du vétérinaire connecté (admin/veto/secretaire)';

-- Fonction : retourne l'id du véto connecté
CREATE OR REPLACE FUNCTION get_veterinaire_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT id
  FROM veterinaires
  WHERE user_id = auth.uid()
    AND actif = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_veterinaire_id IS 'Retourne l UUID du vétérinaire connecté';

-- ============================================================
-- Activer RLS sur toutes les tables
-- ============================================================
ALTER TABLE veterinaires       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contraintes_veto   ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE gardes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE conges              ENABLE ROW LEVEL SECURITY;
ALTER TABLE bonus_malus         ENABLE ROW LEVEL SECURITY;
ALTER TABLE jours_feries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacances_scolaires  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log           ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE : veterinaires
-- ============================================================

-- Admin : accès total
CREATE POLICY "vet_admin_all" ON veterinaires
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Veto / Secrétaire : lecture de tous les vétérinaires actifs
CREATE POLICY "vet_read_all" ON veterinaires
  FOR SELECT TO authenticated
  USING (actif = true AND get_user_role() IN ('veto', 'secretaire'));

-- ============================================================
-- TABLE : contraintes_veto
-- ============================================================

CREATE POLICY "contraintes_admin_all" ON contraintes_veto
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Veto : lecture de ses propres contraintes
CREATE POLICY "contraintes_veto_own_read" ON contraintes_veto
  FOR SELECT TO authenticated
  USING (veterinaire_id = get_veterinaire_id() AND get_user_role() = 'veto');

-- ============================================================
-- TABLE : periodes
-- ============================================================

CREATE POLICY "periodes_admin_all" ON periodes
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Veto / Secrétaire : lecture des périodes publiées
CREATE POLICY "periodes_read_publie" ON periodes
  FOR SELECT TO authenticated
  USING (statut IN ('publie', 'verrouille') AND get_user_role() IN ('veto', 'secretaire'));

-- ============================================================
-- TABLE : gardes
-- ============================================================

CREATE POLICY "gardes_admin_all" ON gardes
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Veto : lecture des gardes (toutes, pour voir le planning complet)
CREATE POLICY "gardes_veto_read" ON gardes
  FOR SELECT TO authenticated
  USING (get_user_role() = 'veto');

-- Secrétaire : lecture des gardes uniquement
CREATE POLICY "gardes_secretaire_read" ON gardes
  FOR SELECT TO authenticated
  USING (get_user_role() = 'secretaire');

-- ============================================================
-- TABLE : conges
-- ============================================================

CREATE POLICY "conges_admin_all" ON conges
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Veto : lecture de ses propres congés
CREATE POLICY "conges_veto_read_own" ON conges
  FOR SELECT TO authenticated
  USING (veterinaire_id = get_veterinaire_id() AND get_user_role() = 'veto');

-- Veto : saisie de ses propres souhaits (statut='souhait' uniquement)
CREATE POLICY "conges_veto_insert_souhait" ON conges
  FOR INSERT TO authenticated
  WITH CHECK (
    veterinaire_id = get_veterinaire_id()
    AND statut = 'souhait'
    AND get_user_role() = 'veto'
  );

-- Veto : modification de ses propres souhaits (tant que statut='souhait')
CREATE POLICY "conges_veto_update_souhait" ON conges
  FOR UPDATE TO authenticated
  USING (
    veterinaire_id = get_veterinaire_id()
    AND statut = 'souhait'
    AND get_user_role() = 'veto'
  )
  WITH CHECK (
    veterinaire_id = get_veterinaire_id()
    AND statut = 'souhait'
  );

-- Veto : suppression de ses propres souhaits (non validés)
CREATE POLICY "conges_veto_delete_souhait" ON conges
  FOR DELETE TO authenticated
  USING (
    veterinaire_id = get_veterinaire_id()
    AND statut = 'souhait'
    AND get_user_role() = 'veto'
  );

-- ============================================================
-- TABLE : bonus_malus
-- ============================================================

CREATE POLICY "bonus_malus_admin_all" ON bonus_malus
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- Veto : lecture de son propre bilan
CREATE POLICY "bonus_malus_veto_read_own" ON bonus_malus
  FOR SELECT TO authenticated
  USING (veterinaire_id = get_veterinaire_id() AND get_user_role() = 'veto');

-- ============================================================
-- TABLES DE RÉFÉRENCE : jours_feries + vacances_scolaires
-- Lecture pour tous les utilisateurs authentifiés
-- ============================================================

CREATE POLICY "jours_feries_read_all" ON jours_feries
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "jours_feries_admin_write" ON jours_feries
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "vacances_read_all" ON vacances_scolaires
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "vacances_admin_write" ON vacances_scolaires
  FOR ALL TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- ============================================================
-- TABLE : audit_log
-- Admin uniquement (lecture + écriture via service_role)
-- ============================================================

CREATE POLICY "audit_admin_read" ON audit_log
  FOR SELECT TO authenticated
  USING (get_user_role() = 'admin');

-- Vues : les vues héritent les policies des tables sous-jacentes
-- Pas de RLS direct sur les vues dans Supabase
