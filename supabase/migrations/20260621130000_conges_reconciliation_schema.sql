-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Réconciliation de schéma : table `conges`
-- Auteur : MAX (MPP) + ruflo — MonProjetPro
-- Date   : 2026-06-21
-- ───────────────────────────────────────────────────────────────
-- ⚠️ MIGRATION DE RÉCONCILIATION DE DÉRIVE — NE PAS APPLIQUER SANS
--    AUDIT CERBÈRE.
--
-- CONTEXTE
--   La table `conges` a subi une DÉRIVE DE SCHÉMA : deux éléments
--   existent déjà EN BASE DE PROD mais sont ABSENTS des migrations
--   versionnées. Cette migration GRAVE l'état réel de prod dans le
--   versionné, pour réaligner code et base.
--
--   Élément 1 — Colonne `creneau` TEXT (nullable)
--     Valeurs : 'journee' | 'matin' | 'apres-midi' | 'soiree' | NULL.
--     Ajoutée à la main en prod, jamais versionnée.
--
--   Élément 2 — Valeur 'indisponibilite' dans le CHECK sur `type`
--     La migration d'origine `001_tables.sql` (~ligne 119) n'autorise
--     que ('vacances','formation','sante','autre'). La prod accepte en
--     plus 'indisponibilite'. On ÉLARGIT le domaine autorisé.
--
-- ───────────────────────────────────────────────────────────────
-- AUCUNE DONNÉE N'EST ALTÉRÉE
--   • Élément 1 : ajout d'une colonne déjà présente (ADD COLUMN IF NOT
--     EXISTS) → no-op en prod, crée la colonne sur un environnement
--     neuf. La contrainte CHECK posée n'invalide aucune ligne (le
--     domaine couvre toutes les valeurs réelles, NULL compris).
--   • Élément 2 : on ÉLARGIT le domaine de `type` (on n'en retire
--     aucune valeur) → aucune ligne existante ne peut violer la
--     nouvelle contrainte.
--   Aucun INSERT / UPDATE / DELETE de données métier.
--
-- IDEMPOTENCE : ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS
--   avant chaque ADD CONSTRAINT, DO-blocks gardés par pg_constraint.
--   Rejouable sans erreur. Transaction atomique.
--
-- ⚠️ À VÉRIFIER EN BASE (CERBÈRE / MiKL) — NOM RÉEL DU CHECK SUR `type`
--   Le CHECK d'origine est INLINE et ANONYME dans 001_tables.sql, donc
--   Postgres lui a auto-attribué un nom (typiquement `conges_type_check`).
--   Cette migration tente plusieurs noms probables via DROP ... IF EXISTS
--   (aucun ne casse s'il n'existe pas). Si le nom réel diffère de tous
--   ceux listés, le vieux CHECK survivrait À CÔTÉ du nouveau et
--   bloquerait 'indisponibilite'. → VÉRIFIER avec la requête de contrôle
--   en pied de fichier AVANT de considérer la réconciliation terminée.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- ÉLÉMENT 1 — Colonne `creneau` (grave une colonne déjà existante)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.conges
  ADD COLUMN IF NOT EXISTS creneau TEXT;

COMMENT ON COLUMN public.conges.creneau IS
  'Créneau ciblé par l''indisponibilité : journee | matin | apres-midi | soiree | NULL (journée entière). Gravé par réconciliation de dérive 2026-06-21.';

-- Contrainte CHECK sur `creneau` — posée seulement si absente (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname  = 'conges_creneau_check'
    AND    conrelid = 'public.conges'::regclass
  ) THEN
    ALTER TABLE public.conges
      ADD CONSTRAINT conges_creneau_check
      CHECK (creneau IS NULL OR creneau IN ('journee', 'matin', 'apres-midi', 'soiree'));
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- ÉLÉMENT 2 — Élargir le CHECK sur `type` pour AJOUTER 'indisponibilite'
-- ───────────────────────────────────────────────────────────────
-- On retire l'ancienne contrainte (quel que soit son nom auto-généré
-- parmi les noms probables), puis on pose une contrainte NOMMÉE et
-- élargie. DROP ... IF EXISTS ne casse jamais si le nom n'existe pas.

-- Nom canonique auto-généré par Postgres pour un CHECK inline sur `type` :
ALTER TABLE public.conges DROP CONSTRAINT IF EXISTS conges_type_check;
-- Noms alternatifs probables (variantes / collisions / suffixes Postgres) :
ALTER TABLE public.conges DROP CONSTRAINT IF EXISTS conges_type_check1;
ALTER TABLE public.conges DROP CONSTRAINT IF EXISTS conges_type_check2;

-- Pose la contrainte élargie seulement si elle n'existe pas déjà (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname  = 'conges_type_check'
    AND    conrelid = 'public.conges'::regclass
  ) THEN
    ALTER TABLE public.conges
      ADD CONSTRAINT conges_type_check
      CHECK (type IN ('vacances', 'formation', 'sante', 'autre', 'indisponibilite'));
  END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- CONTRÔLE POST-APPLICATION (à exécuter manuellement, hors migration)
-- ───────────────────────────────────────────────────────────────
-- 1. Vérifier qu'il ne reste QU'UN SEUL CHECK touchant `type`, et que
--    c'est bien `conges_type_check` (et non un ancien nom survivant) :
--
--    SELECT conname, pg_get_constraintdef(oid)
--    FROM   pg_constraint
--    WHERE  conrelid = 'public.conges'::regclass
--    AND    contype  = 'c'
--    ORDER  BY conname;
--
--    → Attendu : `conges_type_check` listant les 5 valeurs (dont
--      'indisponibilite'), `conges_creneau_check`, et
--      `dates_conges_coherentes`. AUCUN autre CHECK sur `type`.
--      Si un ancien CHECK sur `type` subsiste sous un nom non listé
--      dans les DROP ci-dessus → le DROP manuellement puis rejouer.
--
-- 2. Vérifier que la colonne `creneau` est bien présente :
--    SELECT column_name, data_type, is_nullable
--    FROM   information_schema.columns
--    WHERE  table_schema = 'public' AND table_name = 'conges'
--    AND    column_name = 'creneau';
-- ═══════════════════════════════════════════════════════════════
