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
