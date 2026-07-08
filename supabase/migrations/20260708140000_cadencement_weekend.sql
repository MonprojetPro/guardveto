-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Vague 5 tranche C : cadencement « 1 WE sur N ancré » (#20)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-08
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Ajoute au catalogue `briques_regles` la brique PAR-VÉTO `cadencement_weekend`
--   (famille `sequence`) — un CADENCEMENT ANCRÉ des week-ends de garde.
--
--   ⚠️ À NE PAS confondre avec `espacement_weekend` (migration 20260629181000)
--      qui est un ESPACEMENT (« au moins N semaines entre deux WE de garde »).
--      Cette migration-là documente explicitement « interprétation A = espacement,
--      pas cadencement ». La présente brique couvre le cadencement manquant :
--
--     • n_semaines — integer ≥ 2 : le cycle (1 week-end sur N).
--     • ancre — date ISO yyyy-MM-dd : un SAMEDI de référence qui fixe la PHASE
--       du cycle. Les WE « du véto » sont ceux dont le samedi est à un multiple
--       de N×7 jours de l'ancre (passé OU futur : modulo signé). Cycle calendaire
--       STRICT — AUCUN recalage vacances (contrairement à l'indispo cyclique) :
--       un engagement pompier ne se décale pas avec les vacances scolaires.
--     • sens — 'interdit' | 'impose' :
--         - interdit (cas pompier volontaire) : les WE du cycle sont INTERDITS
--           de garde véto (il est déjà pris ailleurs). Les autres WE restent libres.
--         - impose : les gardes WE du véto DOIVENT tomber sur les WE du cycle
--           (hors cycle = violation). N'OBLIGE PAS à poser une garde à chaque WE
--           du cycle : c'est un FILTRE DE POSITION, pas une obligation de présence.
--
--   Indispensable AVANT de créer la moindre règle de ce type : la FK
--   regles_cabinet.brique_id → briques_regles.id rejetterait sinon l'insertion
--   (anti-coquille-vide au niveau base).
--
--   L'évaluateur reste en TypeScript (hard-constraints.ts + validateur indépendant
--   validerPlanning.ts). Ce seed n'est qu'un MIROIR LECTURE du schéma (cf. P1A-001).
--
-- SÉCURITÉ : table de référence, RLS lecture seule. Écriture via migration
--   uniquement (C3). Aucune policy modifiée.
-- IDEMPOTENCE : INSERT … ON CONFLICT (id) DO UPDATE (rejouable).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('cadencement_weekend', 'sequence', 'CADENCEMENT_WE', jsonb_build_object(
    'description', 'Cadencement fixe des week-ends de garde : cycle « 1 week-end sur N » ancré à une date de référence (cas type : pompier volontaire de garde 1 WE sur 3 à dates fixes). Cycle calendaire strict, indépendant des vacances scolaires.',
    'axes', jsonb_build_array('qui','quand'),
    'params', jsonb_build_object(
      'n_semaines', 'integer (≥ 2 — cycle : 1 week-end sur N)',
      'ancre', 'string (date ISO yyyy-MM-dd — un samedi de référence donnant la phase du cycle)',
      'sens', 'string (interdit = WE du cycle interdits de garde ; impose = gardes WE forcées sur le cycle)')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
