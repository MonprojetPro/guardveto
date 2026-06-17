-- ============================================================
-- GUARDVETO — Migration 001 : Tables
-- Auteur : SPARK — MonProjetPro
-- Date   : 2026-04-24
-- ============================================================

-- Extension UUID (disponible par défaut sur Supabase)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLE : veterinaires
-- ============================================================
CREATE TABLE IF NOT EXISTS veterinaires (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- user_id est NULL jusqu'à ce que le vét ait un compte Supabase Auth
  nom            TEXT        NOT NULL,
  prenom         TEXT        NOT NULL,
  email          TEXT        UNIQUE NOT NULL,
  statut         TEXT        NOT NULL CHECK (statut IN ('associe', 'salarie')),
  role_app       TEXT        NOT NULL DEFAULT 'veto' CHECK (role_app IN ('admin', 'veto')),
  actif          BOOLEAN     NOT NULL DEFAULT true,
  dernier_recours BOOLEAN   NOT NULL DEFAULT false,
  -- couleur hex pour le calendrier (ex: #3B82F6)
  couleur        TEXT        NOT NULL DEFAULT '#6B7280',
  -- invite_pending : true tant que le véto n'a pas défini son mot de passe (badge "invitation envoyée")
  invite_pending BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE  veterinaires          IS 'Profils des vétérinaires et secrétaires';
COMMENT ON COLUMN veterinaires.user_id  IS 'Lié à auth.users après invitation Supabase';
COMMENT ON COLUMN veterinaires.dernier_recours IS 'Anne-Cat : garde uniquement si aucun autre dispo';

-- ============================================================
-- TABLE : contraintes_veto
-- ============================================================
CREATE TABLE IF NOT EXISTS contraintes_veto (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  veterinaire_id  UUID    NOT NULL REFERENCES veterinaires(id) ON DELETE CASCADE,
  type            TEXT    NOT NULL CHECK (type IN (
    'jour_repos_fixe',         -- ex : mercredi fixe
    'jour_repos_conditionnel', -- ex : jeudi si garde WE, vendredi sinon
    'indisponibilite_cyclique',-- ex : Anne-So semaines impaires
    'duo_interdit'             -- ex : Manon + Antoine ne peuvent être seuls
  )),
  config          JSONB   NOT NULL,
  -- Exemples config :
  -- jour_repos_fixe             : { "jour": "mercredi", "exception_vacances_scolaires": true }
  -- jour_repos_conditionnel     : { "si_garde_we": "jeudi", "sinon": "vendredi" }
  -- indisponibilite_cyclique    : { "semaines": "impaires", "periodes": ["soir", "weekend"] }
  -- duo_interdit                : { "avec_veterinaire_id": "uuid..." }
  actif           BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE contraintes_veto IS 'Contraintes individuelles permanentes de chaque vétérinaire';

-- ============================================================
-- TABLE : periodes
-- ============================================================
CREATE TABLE IF NOT EXISTS periodes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  saison      TEXT        NOT NULL CHECK (saison IN ('ete', 'hiver')),
  numero      INTEGER,    -- 1, 2, 3 pour hiver ; NULL pour été
  date_debut  DATE        NOT NULL,  -- toujours un lundi
  date_fin    DATE        NOT NULL,  -- toujours un dimanche
  statut      TEXT        NOT NULL DEFAULT 'brouillon'
                CHECK (statut IN ('brouillon', 'publie', 'verrouille')),
  publie_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT dates_coherentes CHECK (date_fin > date_debut),
  CONSTRAINT debut_lundi      CHECK (EXTRACT(DOW FROM date_debut) = 1)
);

COMMENT ON TABLE periodes IS 'Périodes de planification (12 sem hiver, 17 sem été)';

-- ============================================================
-- TABLE : gardes
-- ============================================================
CREATE TABLE IF NOT EXISTS gardes (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  periode_id            UUID    NOT NULL REFERENCES periodes(id) ON DELETE CASCADE,
  date                  DATE    NOT NULL,
  type                  TEXT    NOT NULL CHECK (type IN ('semaine', 'weekend', 'ferie')),
  premier_id            UUID    REFERENCES veterinaires(id),
  second_id             UUID    REFERENCES veterinaires(id), -- NULL en été semaine
  verrouille            BOOLEAN NOT NULL DEFAULT false,
  modifie_manuellement  BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, type)   -- une seule garde par jour par type
);

COMMENT ON TABLE  gardes              IS '1 ligne = 1 jour de garde. Une garde WE couvre ven soir → lun matin.';
COMMENT ON COLUMN gardes.premier_id   IS '1er de garde (responsable principal)';
COMMENT ON COLUMN gardes.second_id    IS '2nd de garde (backup) — NULL en été pour gardes de semaine';
COMMENT ON COLUMN gardes.verrouille   IS 'Garde passée ou publiée — bloquée en modification automatique';

-- Trigger : mise à jour automatique de updated_at
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER gardes_updated_at
  BEFORE UPDATE ON gardes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ============================================================
-- TABLE : conges
-- ============================================================
CREATE TABLE IF NOT EXISTS conges (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  veterinaire_id  UUID    NOT NULL REFERENCES veterinaires(id) ON DELETE CASCADE,
  date_debut      DATE    NOT NULL,
  date_fin        DATE    NOT NULL,
  type            TEXT    NOT NULL CHECK (type IN ('vacances', 'formation', 'sante', 'autre', 'indisponibilite')),
  statut          TEXT    NOT NULL DEFAULT 'souhait'
                    CHECK (statut IN ('souhait', 'valide', 'refuse')),
  -- creneau : précise la demi-journée pour une indisponibilité ponctuelle
  creneau         TEXT    CHECK (creneau IS NULL OR creneau IN ('journee', 'matin', 'apres-midi', 'soiree')),
  commentaire     TEXT,
  saisi_par       UUID    REFERENCES veterinaires(id),
  valide_par      UUID    REFERENCES veterinaires(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT dates_conges_coherentes CHECK (date_fin >= date_debut)
);

COMMENT ON TABLE conges IS 'Congés, formations, indisponibilités ponctuelles';

-- ============================================================
-- TABLE : bonus_malus
-- ============================================================
CREATE TABLE IF NOT EXISTS bonus_malus (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  veterinaire_id  UUID    NOT NULL REFERENCES veterinaires(id) ON DELETE CASCADE,
  periode_id      UUID    NOT NULL REFERENCES periodes(id) ON DELETE CASCADE,
  -- Positif = a fait PLUS que sa part (crédité sur période suivante)
  -- Négatif = a fait MOINS que sa part (doit compenser)
  ecart_we        INTEGER NOT NULL DEFAULT 0,
  ecart_semaine   INTEGER NOT NULL DEFAULT 0,
  ecart_feries    INTEGER NOT NULL DEFAULT 0,
  ecart_grands_we INTEGER NOT NULL DEFAULT 0, -- salariés uniquement
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(veterinaire_id, periode_id)
);

COMMENT ON TABLE bonus_malus IS 'Écarts de gardes inter-périodes pour rééquilibrage automatique';

-- ============================================================
-- TABLE : jours_feries
-- ============================================================
CREATE TABLE IF NOT EXISTS jours_feries (
  id    UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  date  DATE  NOT NULL UNIQUE,
  nom   TEXT  NOT NULL
);

COMMENT ON TABLE jours_feries IS 'Jours fériés français (table de référence)';

-- ============================================================
-- TABLE : vacances_scolaires
-- ============================================================
CREATE TABLE IF NOT EXISTS vacances_scolaires (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  date_debut  DATE  NOT NULL,
  date_fin    DATE  NOT NULL,
  nom         TEXT  NOT NULL,  -- ex : "Vacances d'hiver 2027 Zone B"
  zone        TEXT  NOT NULL DEFAULT 'B'
                CHECK (zone IN ('A', 'B', 'C')),
  CONSTRAINT dates_vacances_coherentes CHECK (date_fin >= date_debut)
);

COMMENT ON TABLE vacances_scolaires IS 'Vacances scolaires (pour règle Fanny mercredi)';

-- ============================================================
-- TABLE : audit_log
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name  TEXT  NOT NULL,
  record_id   UUID  NOT NULL,
  action      TEXT  NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  old_data    JSONB,
  new_data    JSONB,
  user_id     UUID  REFERENCES veterinaires(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE audit_log IS 'Journal des modifications — traçabilité complète';

-- ============================================================
-- INDEX pour les requêtes fréquentes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_gardes_date         ON gardes(date);
CREATE INDEX IF NOT EXISTS idx_gardes_periode       ON gardes(periode_id);
CREATE INDEX IF NOT EXISTS idx_gardes_premier       ON gardes(premier_id);
CREATE INDEX IF NOT EXISTS idx_gardes_second        ON gardes(second_id);
CREATE INDEX IF NOT EXISTS idx_conges_veterinaire   ON conges(veterinaire_id);
CREATE INDEX IF NOT EXISTS idx_conges_dates         ON conges(date_debut, date_fin);
CREATE INDEX IF NOT EXISTS idx_contraintes_veto     ON contraintes_veto(veterinaire_id);
CREATE INDEX IF NOT EXISTS idx_audit_table_record   ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_vet_user_id          ON veterinaires(user_id);
-- ============================================================
-- GUARDVETO — Migration 002 : Vues calculées
-- Auteur : SPARK — MonProjetPro
-- Date   : 2026-04-24
-- ============================================================

-- ============================================================
-- VUE : compteurs_gardes
-- Compteurs par vétérinaire et par période
-- ============================================================
CREATE OR REPLACE VIEW compteurs_gardes AS
SELECT
  g.periode_id,
  v.id                                                            AS veterinaire_id,
  v.prenom,
  v.nom,
  v.statut,
  v.couleur,
  -- Week-ends
  COUNT(*) FILTER (WHERE g.type = 'weekend' AND g.premier_id = v.id) AS we_premier,
  COUNT(*) FILTER (WHERE g.type = 'weekend' AND g.second_id  = v.id) AS we_second,
  -- Total week-ends
  COUNT(*) FILTER (WHERE g.type = 'weekend' AND (g.premier_id = v.id OR g.second_id = v.id)) AS we_total,
  -- Gardes semaine
  COUNT(*) FILTER (WHERE g.type = 'semaine' AND g.premier_id = v.id) AS sem_premier,
  COUNT(*) FILTER (WHERE g.type = 'semaine' AND g.second_id  = v.id) AS sem_second,
  -- Total semaine
  COUNT(*) FILTER (WHERE g.type = 'semaine' AND (g.premier_id = v.id OR g.second_id = v.id)) AS sem_total,
  -- Jours fériés
  COUNT(*) FILTER (WHERE g.type = 'ferie' AND g.premier_id = v.id)   AS feries_premier,
  COUNT(*) FILTER (WHERE g.type = 'ferie' AND g.second_id  = v.id)   AS feries_second,
  COUNT(*) FILTER (WHERE g.type = 'ferie' AND (g.premier_id = v.id OR g.second_id = v.id)) AS feries_total,
  -- Total général
  COUNT(*) FILTER (WHERE g.premier_id = v.id OR g.second_id = v.id)  AS total_gardes
FROM veterinaires v
CROSS JOIN gardes g
WHERE v.actif = true
  AND v.id IN (g.premier_id, g.second_id)
GROUP BY g.periode_id, v.id, v.prenom, v.nom, v.statut, v.couleur;

COMMENT ON VIEW compteurs_gardes IS 'Compteurs de gardes par vétérinaire et par période — utilisé pour équité et bonus/malus';

-- ============================================================
-- VUE : planning_semaine
-- Vue hebdomadaire dénormalisée (utile pour l'affichage)
-- Les gardes de week-end (samedi) génèrent aussi une ligne
-- pour le vendredi (veille) et le dimanche (lendemain) afin
-- que le calendrier affiche les badges sur les 3 jours.
-- ============================================================
CREATE OR REPLACE VIEW planning_semaine AS
-- Ligne native (date réelle de la garde)
SELECT
  g.id,
  g.periode_id,
  g.date,
  g.type,
  g.verrouille,
  g.modifie_manuellement,
  vp.id      AS premier_id,
  vp.prenom  AS premier_prenom,
  vp.nom     AS premier_nom,
  vp.couleur AS premier_couleur,
  vs.id      AS second_id,
  vs.prenom  AS second_prenom,
  vs.nom     AS second_nom,
  vs.couleur AS second_couleur,
  p.saison,
  p.statut   AS periode_statut
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id

UNION ALL

-- Vendredi : veille du samedi de garde de week-end
SELECT
  g.id,
  g.periode_id,
  (g.date - INTERVAL '1 day')::date AS date,
  g.type,
  g.verrouille,
  g.modifie_manuellement,
  vp.id      AS premier_id,
  vp.prenom  AS premier_prenom,
  vp.nom     AS premier_nom,
  vp.couleur AS premier_couleur,
  vs.id      AS second_id,
  vs.prenom  AS second_prenom,
  vs.nom     AS second_nom,
  vs.couleur AS second_couleur,
  p.saison,
  p.statut   AS periode_statut
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id
WHERE g.type = 'weekend'

UNION ALL

-- Dimanche : lendemain du samedi de garde de week-end
SELECT
  g.id,
  g.periode_id,
  (g.date + INTERVAL '1 day')::date AS date,
  g.type,
  g.verrouille,
  g.modifie_manuellement,
  vp.id      AS premier_id,
  vp.prenom  AS premier_prenom,
  vp.nom     AS premier_nom,
  vp.couleur AS premier_couleur,
  vs.id      AS second_id,
  vs.prenom  AS second_prenom,
  vs.nom     AS second_nom,
  vs.couleur AS second_couleur,
  p.saison,
  p.statut   AS periode_statut
FROM gardes g
JOIN periodes p ON p.id = g.periode_id
LEFT JOIN veterinaires vp ON vp.id = g.premier_id
LEFT JOIN veterinaires vs ON vs.id = g.second_id
WHERE g.type = 'weekend'

ORDER BY date;

COMMENT ON VIEW planning_semaine IS 'Planning dénormalisé pour affichage calendrier — noms + couleurs des vétos inclus. Les week-ends génèrent 3 lignes (ven/sam/dim).';
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
-- ============================================================
-- GUARDVETO — Migration 005 : colonne google_event_id sur gardes
-- ============================================================
-- Stocke l'ID de l'événement Google Agenda associé à chaque garde
-- publiée. NULL si la synchro n'a pas encore eu lieu.
-- ============================================================

ALTER TABLE gardes
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

COMMENT ON COLUMN gardes.google_event_id IS 'ID événement Google Agenda — NULL si non synchronisé';
-- ============================================================
-- GUARDVETO — Migration 006 : Email Log
-- Auteur : SPARK — MonProjetPro
-- Date   : 2026-04-25
-- ============================================================
-- Journal des emails envoyés via Resend (STORY-019)
-- Accessible à l'admin via l'interface (lecture seule)
-- ============================================================

CREATE TABLE IF NOT EXISTS email_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT        NOT NULL CHECK (type IN ('planning_publie', 'garde_modifiee')),
  destinataire    TEXT        NOT NULL,    -- email du destinataire
  veterinaire_id  UUID        REFERENCES veterinaires(id) ON DELETE SET NULL,
  periode_id      UUID        REFERENCES periodes(id) ON DELETE SET NULL,
  garde_id        UUID        REFERENCES gardes(id) ON DELETE SET NULL,
  resend_id       TEXT,                   -- ID retourné par Resend (null si erreur)
  statut          TEXT        NOT NULL DEFAULT 'envoye'
                    CHECK (statut IN ('envoye', 'erreur')),
  erreur          TEXT,                   -- message d'erreur si statut='erreur'
  created_at      TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE email_log IS 'Journal des emails envoyés via Resend — traçabilité des notifications';

CREATE INDEX IF NOT EXISTS idx_email_log_periode    ON email_log(periode_id);
CREATE INDEX IF NOT EXISTS idx_email_log_garde      ON email_log(garde_id);
CREATE INDEX IF NOT EXISTS idx_email_log_created_at ON email_log(created_at DESC);

-- RLS sur email_log (créée après la migration 003, donc activée ici) :
-- seul l'admin peut lire le journal des emails ; les écritures passent par le service_role.
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_email_log" ON email_log
  FOR SELECT TO authenticated
  USING (get_user_role() = 'admin');
-- STORY-021 — Rappels automatiques de publication
-- Colonnes pour tracer les rappels déjà envoyés (anti-doublon)

ALTER TABLE periodes
  ADD COLUMN IF NOT EXISTS rappel_15j_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rappel_7j_at  timestamptz DEFAULT NULL;

COMMENT ON COLUMN periodes.rappel_15j_at IS 'Timestamp du rappel J-15 envoyé (NULL = pas encore envoyé)';
COMMENT ON COLUMN periodes.rappel_7j_at  IS 'Timestamp du rappel J-7 envoyé (NULL = pas encore envoyé)';
-- STORY-021 addendum — Titre personnalisé de la période
ALTER TABLE periodes ADD COLUMN IF NOT EXISTS libelle text DEFAULT NULL;
COMMENT ON COLUMN periodes.libelle IS 'Titre personnalisé de la période (optionnel)';
-- ============================================================
-- GUARDVETO — Migration 009 : Raison du refus
-- ============================================================
ALTER TABLE conges ADD COLUMN IF NOT EXISTS raison_refus TEXT;
COMMENT ON COLUMN conges.raison_refus IS 'Motif de refus renseigné par l''admin';
-- ============================================================
-- GUARDVETO — Migration 010 : Vues en SECURITY INVOKER
-- Auteur : MAX — MonProjetPro
-- Date   : 2026-06-01
-- ------------------------------------------------------------
-- Corrige l'alerte sécurité Supabase « security_definer_view ».
-- Par défaut les vues s'exécutent avec les droits de leur créateur
-- (SECURITY DEFINER) et CONTOURNENT la RLS de l'utilisateur courant.
-- On force `security_invoker = on` : la vue s'exécute désormais avec
-- les droits de l'utilisateur connecté, donc la RLS des tables
-- sous-jacentes (gardes, periodes, veterinaires...) s'applique enfin.
--
-- Effet métier : un véto ne verra plus, via la vue, le contenu d'une
-- période non publiée (brouillon). L'admin continue de tout voir.
--
-- Aucune donnée n'est modifiée : seules les définitions de vues changent.
-- ============================================================

ALTER VIEW compteurs_gardes SET (security_invoker = on);
ALTER VIEW planning_semaine SET (security_invoker = on);
-- ============================================================
-- GUARDVETO — Migration 011 : search_path figé sur les fonctions
-- Auteur : MAX — MonProjetPro
-- Date   : 2026-06-01
-- ------------------------------------------------------------
-- Corrige l'alerte sécurité Supabase « function_search_path_mutable ».
-- Sans search_path figé, une fonction SECURITY DEFINER pourrait être
-- détournée via un objet injecté dans un schéma prioritaire. On fige
-- search_path = public : les fonctions continuent de résoudre la table
-- `veterinaires` exactement comme avant, mais de façon déterministe.
--
-- On ne modifie NI le corps NI les droits EXECUTE de ces fonctions :
-- elles sont utilisées par les policies RLS et appelées par l'app
-- (get_veterinaire_id via RPC dans conges/actions.ts).
-- ============================================================

ALTER FUNCTION public.get_user_role()       SET search_path = public;
ALTER FUNCTION public.get_veterinaire_id()  SET search_path = public;
ALTER FUNCTION public.trigger_set_updated_at() SET search_path = public;
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
-- ============================================================
-- GUARDVETO — Seed de migration vers la base CLIENT
-- Généré le 2026-06-02 depuis la base de pré-production.
-- ------------------------------------------------------------
-- Contenu : 7 vétérinaires réels (rôles ajustés), leurs règles,
-- jours fériés et vacances scolaires. AUCUN planning, congé ni
-- historique (départ propre pour la démo en direct).
-- À exécuter APRÈS le schéma (migrations 001-012 sauf 004_seed).
--
-- NB : user_id = NULL → chaque véto sera relié à son compte lors
-- de l'invitation. Les emails @guardveto.local sont des
-- PLACEHOLDERS à remplacer par les vrais emails avant invitation.
-- ============================================================

-- ── Vétérinaires (Anne-Catherine + Anne-Sophie = admin) ──────
INSERT INTO veterinaires (id, user_id, nom, prenom, email, statut, role_app, actif, dernier_recours, couleur, invite_pending) VALUES
('00000000-0000-0000-0000-000000000002', NULL, 'Altieri', 'Fanny', 'fanny@guardveto.local', 'associe', 'veto', true, false, '#8B5CF6', true),
('00000000-0000-0000-0000-000000000004', NULL, 'Bernard', 'Anne-Catherine', 'annecat@guardveto.local', 'associe', 'admin', true, true, '#6B7280', true),
('00000000-0000-0000-0000-000000000001', NULL, 'Blanchard', 'Anne-Sophie', 'vetovaldallier@gmail.com', 'associe', 'admin', true, false, '#3B82F6', true),
('00000000-0000-0000-0000-000000000007', NULL, 'Coelho', 'Victor', 'victor@guardveto.local', 'salarie', 'veto', true, false, '#6366F1', true),
('00000000-0000-0000-0000-000000000003', NULL, 'De Thoisy', 'Jean', 'jean@guardveto.local', 'associe', 'veto', true, false, '#10B981', true),
('00000000-0000-0000-0000-000000000006', NULL, 'Lafarge', 'Antoine', 'antoine@guardveto.local', 'salarie', 'veto', true, false, '#F59E0B', true),
('00000000-0000-0000-0000-000000000005', NULL, 'Renaud', 'Manon', 'manon@guardveto.local', 'salarie', 'veto', true, false, '#EC4899', true);

-- ── Contraintes / règles individuelles ──────────────────────
INSERT INTO contraintes_veto (id, veterinaire_id, type, config, actif) VALUES
('af88fac6-0404-431f-9ea1-65c3ceceac0a', '00000000-0000-0000-0000-000000000002', 'jour_repos_fixe', '{"jour": "mercredi", "description": "Mercredi repos fixe sauf vacances scolaires", "exception_vacances_scolaires": true}'::jsonb, true),
('5ada4d5f-17fd-4211-9f98-e64891aee7cb', '00000000-0000-0000-0000-000000000004', 'jour_repos_fixe', '{"jour": "mercredi", "periode": "apres_midi", "description": "Mercredi apres-midi fixe + un autre demi-journee variable", "repos_supplementaire_variable": true}'::jsonb, true),
('ad1dba16-060b-45d5-937c-040d1c645474', '00000000-0000-0000-0000-000000000003', 'jour_repos_conditionnel', '{"sinon": "vendredi", "description": "Vendredi repos sauf si garde WE alors mardi", "si_garde_we": "mardi"}'::jsonb, true),
('f1983ea7-569d-4d03-acb2-159b6a0f64a0', '00000000-0000-0000-0000-000000000006', 'jour_repos_conditionnel', '{"sinon": "vendredi", "description": "Jeudi si garde WE, Vendredi sinon", "si_garde_we": "jeudi"}'::jsonb, true),
('cdbe6498-44d8-4a11-bbcf-7a522bc3f937', '00000000-0000-0000-0000-000000000006', 'duo_interdit', '{"description": "Antoine et Manon ne peuvent pas etre seuls", "avec_veterinaire_id": "00000000-0000-0000-0000-000000000005"}'::jsonb, true),
('804cd035-7f51-44e2-9f56-0d6829e74f8f', '00000000-0000-0000-0000-000000000005', 'jour_repos_conditionnel', '{"sinon": "vendredi", "description": "Jeudi si garde WE, Vendredi sinon", "si_garde_we": "jeudi"}'::jsonb, true),
('412726e2-3b00-41ed-bd45-adff3c052118', '00000000-0000-0000-0000-000000000005', 'duo_interdit', '{"description": "Manon et Antoine ne peuvent pas etre seuls", "avec_veterinaire_id": "00000000-0000-0000-0000-000000000006"}'::jsonb, true),
('76352224-bc81-4996-b435-8fee694468e9', '00000000-0000-0000-0000-000000000007', 'jour_repos_conditionnel', '{"sinon": "vendredi", "description": "Jeudi si garde WE, Vendredi sinon", "si_garde_we": "jeudi"}'::jsonb, true),
('f961c313-1c9d-490e-891e-f7d6195a095f', '00000000-0000-0000-0000-000000000001', 'jour_repos_fixe', '{"regles": [{"jour": "jeudi", "periode": "apres_midi", "semaine": "impaire"}, {"jour": "lundi", "periode": "apres_midi", "semaine": "paire"}, {"jour": "mercredi", "periode": "journee", "semaine": "paire"}], "description": "Jeudi AP semaines impaires + Lundi AP semaines paires + Mercredi semaines paires"}'::jsonb, true),
('95c6f138-2835-4bc6-8d76-bb91c6b11894', '00000000-0000-0000-0000-000000000001', 'indisponibilite_cyclique', '{"periodes": ["soir_semaine", "weekend"], "semaines": "impaires", "description": "Pas de garde soir semaine + weekend les semaines impaires"}'::jsonb, true);

-- ── Jours fériés (référence) ─────────────────────────────────
INSERT INTO jours_feries (id, date, nom) VALUES
('11cdf6e3-6d49-4dac-b07f-543c3b6ed241', '2026-01-01', 'Jour de l An'),
('11eded89-bfba-4286-b92a-064970449cac', '2026-04-06', 'Lundi de Paques'),
('a0514403-f706-4a01-bab1-8b3183a4b055', '2026-05-01', 'Fete du Travail'),
('72623ae8-e191-4d31-8749-9f98112857ea', '2026-05-08', 'Victoire 1945'),
('70d4ce2f-b29a-4b2c-927c-3f262de8ba80', '2026-05-14', 'Ascension'),
('4270f564-c531-4be9-b778-a74d29643c58', '2026-05-25', 'Lundi de Pentecote'),
('8ae4a8dd-920a-47b9-a8d3-7f9055eaaf3f', '2026-07-14', 'Fete Nationale'),
('43f4d3be-55d7-4d11-b8d7-ef73ed79ae84', '2026-08-15', 'Assomption'),
('65bfbfa7-a9a1-48c4-acbe-71640538aafd', '2026-11-01', 'Toussaint'),
('a24bb426-0d22-4d3f-8954-d313c929a61c', '2026-11-11', 'Armistice'),
('1a914915-10bb-4d81-9261-78714f4b8383', '2026-12-25', 'Noel'),
('73ffefc2-ff5a-4556-b618-b6ab72e1dc86', '2027-01-01', 'Jour de l An'),
('8b06425c-66cf-4037-8a51-8c58eefa764e', '2027-03-29', 'Lundi de Paques'),
('f41a967c-1708-4718-91c5-4ccb3cbc8555', '2027-05-01', 'Fete du Travail'),
('db59edce-c12b-4bf5-bbb1-47f0b1e43731', '2027-05-06', 'Ascension'),
('ea7ee6e8-0f47-425c-9c80-fc0ecba0258e', '2027-05-08', 'Victoire 1945'),
('2314fe68-56f8-4c24-af98-b5a6064af871', '2027-05-17', 'Lundi de Pentecote'),
('92e3ac2d-f9b1-4503-aca4-85cac5062993', '2027-07-14', 'Fete Nationale'),
('dab0efdc-bbd4-4060-a838-ffe76d0b05f4', '2027-08-15', 'Assomption'),
('24782509-52c5-4154-ae1e-d9670c0c804e', '2027-11-01', 'Toussaint'),
('5f386941-95b7-4854-b4a2-9fe583175195', '2027-11-11', 'Armistice'),
('d0457210-6cff-47a6-a3b9-bd2f9c571460', '2027-12-25', 'Noel');

-- ── Vacances scolaires (référence) ───────────────────────────
INSERT INTO vacances_scolaires (id, date_debut, date_fin, nom, zone) VALUES
('a4f77b42-a46b-4ddc-b6a4-95fea3b35a8b', '2025-10-18', '2025-11-03', 'Toussaint 2025', 'B'),
('a72fad92-0d75-4fb3-b20e-ae381ca9305a', '2025-12-20', '2026-01-05', 'Noel 2025-2026', 'B'),
('f25eab91-89af-417c-9285-0de46d750e29', '2026-02-07', '2026-02-23', 'Hiver 2026', 'B'),
('6414a2b8-b8ee-4fa0-b740-eed5e52cb0b8', '2026-04-11', '2026-04-27', 'Paques 2026', 'B'),
('8420f15e-415f-4873-a853-658ddd469bc4', '2026-07-04', '2026-09-01', 'Grandes Vacances 2026', 'B'),
('6462194e-4868-4774-8eaf-74c4b8910862', '2026-10-17', '2026-11-02', 'Toussaint 2026', 'B'),
('9ddc5283-c225-42b8-a3b4-691d33385cf6', '2026-12-19', '2027-01-04', 'Noel 2026-2027', 'B'),
('d3e2f078-f307-44e2-9490-f21181ad2090', '2027-02-06', '2027-02-22', 'Hiver 2027', 'B'),
('db55fe52-c021-4fce-99c3-235d9d6e62ba', '2027-04-10', '2027-04-26', 'Paques 2027', 'B'),
('d366659a-1734-47cd-910d-bb913ffb19f8', '2027-07-03', '2027-09-01', 'Grandes Vacances 2027', 'B');
