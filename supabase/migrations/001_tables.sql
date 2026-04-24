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
  role_app       TEXT        NOT NULL DEFAULT 'veto' CHECK (role_app IN ('admin', 'veto', 'secretaire')),
  actif          BOOLEAN     NOT NULL DEFAULT true,
  dernier_recours BOOLEAN   NOT NULL DEFAULT false,
  -- couleur hex pour le calendrier (ex: #3B82F6)
  couleur        TEXT        NOT NULL DEFAULT '#6B7280',
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
  type            TEXT    NOT NULL CHECK (type IN ('vacances', 'formation', 'sante', 'autre')),
  statut          TEXT    NOT NULL DEFAULT 'souhait'
                    CHECK (statut IN ('souhait', 'valide', 'refuse')),
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
