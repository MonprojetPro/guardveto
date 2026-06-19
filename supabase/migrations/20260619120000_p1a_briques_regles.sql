-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — P1A-001 : Table briques_regles (catalogue mutualisé)
-- Auteur : MAX (MPP) + ruflo — MonProjetPro
-- Date   : 2026-06-19
-- Lot    : Palier 1 — A (règles configurables) — story 1/7
-- Source : archi v2 §4.1/§4.2/§7 + docs/v2/08-stories-palier1-a.md
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   `briques_regles` est le CATALOGUE DE BRIQUES, table de RÉFÉRENCE
--   PARTAGÉE entre tous les cabinets (P3 — DRY métier). Pas de
--   `cabinet_id` : le code des briques est mutualisé, seules les
--   *valeurs* (regles_cabinet, P1A-002) sont par cabinet.
--
--   Cette table est un MIROIR LECTURE du catalogue de code : l'évaluateur
--   `brique.evaluer()` reste en TypeScript (src/engine/briques/). La base
--   n'expose que `schema_json` (= miroir de brique.schemaParams), lu par :
--     • l'interface  → rend le bon widget de saisie
--     • l'IA (P3)    → traduit le langage naturel vers une brique valide
--     • la validation déterministe (P1A-004) → rejette un params_json corrompu
--
--   ⚠️ NOTE D'ALIGNEMENT (P1A-005) : à ce jour le catalogue de code
--   (CATALOGUE_BRIQUES) n'existe pas encore — F4-001 n'a livré que le TYPE
--   (ConfigBriqueV2) + le validateur. Les `schema_json` ci-dessous sont un
--   MIROIR PROVISOIRE aligné sur la grammaire 6-axes (axes qui/quand/quoi/
--   combien + params spécifiques). Ils seront re-synchronisés bit-à-bit avec
--   brique.schemaParams quand le catalogue de code sera consolidé (P1A-005).
--
-- SÉCURITÉ (🔒 C3 — table de référence en écriture verrouillée)
--   RLS activée. Lecture seule pour `authenticated`. AUCUNE policy
--   INSERT/UPDATE/DELETE → l'écriture passe exclusivement par migrations /
--   service_role (= une nouvelle brique = une PR Git, jamais du code
--   injecté depuis la base). Pas de `cabinet_id` : pas d'isolation tenant
--   nécessaire (catalogue identique pour tous).
--
-- IDEMPOTENCE
--   CREATE TABLE IF NOT EXISTS ; DROP POLICY IF EXISTS avant CREATE ;
--   seed en INSERT ... ON CONFLICT (id) DO UPDATE (re-synchronise le seed).
--   Transaction atomique. N'altère aucune table existante.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────
-- TABLE
-- ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.briques_regles (
  id          TEXT PRIMARY KEY,                 -- ex. "alternance_ancre" (= brique.id en code)
  famille     TEXT NOT NULL CHECK (famille IN
                ('interdire','forcer','limiter','equilibrer','couverture','sequence')),
  operateur   TEXT NOT NULL,                    -- 'JAMAIS' | 'IMPOSER' | 'AU_PLUS_N' | ...
  schema_json JSONB NOT NULL,                   -- miroir lecture de brique.schemaParams
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.briques_regles IS
  'Catalogue de briques (référence partagée, sans cabinet_id). Miroir lecture du catalogue de code TS. Écriture réservée aux migrations/service_role (C3).';
COMMENT ON COLUMN public.briques_regles.schema_json IS
  'Miroir de brique.schemaParams : sert à la validation déterministe + au rendu du widget + à la traduction IA. À synchroniser avec le code en P1A-005.';

-- ───────────────────────────────────────────────────────────────
-- SÉCURITÉ — RLS lecture seule (🔒 C3)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE public.briques_regles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briques_read_all" ON public.briques_regles;
CREATE POLICY "briques_read_all" ON public.briques_regles
  FOR SELECT TO authenticated
  USING (true);
-- ⚠️ AUCUNE policy INSERT/UPDATE/DELETE pour authenticated.
--    L'écriture passe exclusivement par migrations / service_role.

-- ───────────────────────────────────────────────────────────────
-- SEED — les 10 briques du golden test pilote (déjà couvertes par le
--   moteur V1 via hard-constraints.ts / soft-constraints.ts).
--   Les briques "composition d'équipe" (couverture_*, ratio_*,
--   groupe_cohorte_equite, multi_filieres) sont VOLONTAIREMENT ABSENTES
--   du seed (dé-goldplating G1 : schéma gravé, évaluateurs reportés).
-- ───────────────────────────────────────────────────────────────
INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('interdire_creneau', 'interdire', 'JAMAIS', jsonb_build_object(
    'description', 'QUI ne fait jamais QUOI (créneau/jour), éventuellement SAUF une condition calendaire',
    'axes', jsonb_build_array('qui','quoi','quand'),
    'params', jsonb_build_object(
      'creneaux', 'string[] (refs créneaux ou type: weekend/semaine/vendredi_soir/ferie)',
      'sauf', 'ConditionQuand? (ex. vacances)'))),

  ('repos_conditionnel', 'sequence', 'REPOS_SI', jsonb_build_object(
    'description', 'Jour de repos qui dépend d''un fait (ex. si garde le WE → repos jour A, sinon jour B)',
    'axes', jsonb_build_array('qui','quand'),
    'params', jsonb_build_object(
      'si_garde_we', 'string (jour de repos si garde WE)',
      'sinon', 'string (jour de repos par défaut)'))),

  ('duo_interdit', 'interdire', 'PAS_ENSEMBLE', jsonb_build_object(
    'description', 'Deux (ou n) vétos ne sont jamais de garde ensemble',
    'axes', jsonb_build_array('qui'),
    'params', jsonb_build_object(
      'membres', 'string[] (≥2 ids vétos)'))),

  ('liaison_creneaux', 'forcer', 'LIER', jsonb_build_object(
    'description', 'Le véto de garde sur le créneau source fait aussi le créneau lié (ex. vendredi soir ↔ week-end)',
    'axes', jsonb_build_array('quoi'),
    'params', jsonb_build_object(
      'creneau_source', 'string',
      'creneau_lie', 'string'))),

  ('inversion_role', 'forcer', 'INVERSER', jsonb_build_object(
    'description', 'Inverse le rôle 1er/2nd entre deux créneaux liés (R8 : vendredi ↔ week-end)',
    'axes', jsonb_build_array('quoi'),
    'params', jsonb_build_object(
      'creneau_a', 'string',
      'creneau_b', 'string'))),

  ('alternance_ancre', 'interdire', 'ALTERNANCE', jsonb_build_object(
    'description', 'Indisponibilité 1 semaine sur 2 calculée depuis une date d''ancre (remplace la parité ISO), recalée aux vacances',
    'axes', jsonb_build_array('qui','quand'),
    'params', jsonb_build_object(
      'date_ancre', 'string (ISO date)',
      'offset_decale', 'integer? (jours depuis l''ancre — fenêtre qui traverse la semaine)',
      'phase', 'string (paire|impaire)'))),

  ('equilibrer', 'equilibrer', 'EQUILIBRER', jsonb_build_object(
    'description', 'Répartit équitablement une charge entre les membres (variance par défaut), avec quote-part',
    'axes', jsonb_build_array('qui','quoi'),
    'params', jsonb_build_object(
      'dimension', 'string (ex. weekend, ferie, total)',
      'mesure', 'string (variance|min_max — variance par défaut)',
      'quote_part', 'object? (par véto)'))),

  ('au_plus_n', 'limiter', 'AU_PLUS_N', jsonb_build_object(
    'description', 'Plafond N sur une FENÊTRE obligatoire (ex. max 2 nuits par semaine civile)',
    'axes', jsonb_build_array('qui','quoi','combien'),
    'params', jsonb_build_object(
      'n', 'integer',
      'fenetre', 'string (semaine_civile|glissante_N_jours) — OBLIGATOIRE'))),

  ('espacement_min', 'limiter', 'ESPACEMENT', jsonb_build_object(
    'description', 'Écart minimal entre deux gardes d''un même véto',
    'axes', jsonb_build_array('qui','combien'),
    'params', jsonb_build_object(
      'ecart_min_jours', 'integer'))),

  ('motif_grand_weekend', 'interdire', 'MOTIF', jsonb_build_object(
    'description', 'Fait atomique pré-câblé "garde le WE cette semaine" (évite la récursion 2 niveaux)',
    'axes', jsonb_build_array('qui','quand'),
    'params', jsonb_build_object(
      'motif', 'string (garde_we_cette_semaine)')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
