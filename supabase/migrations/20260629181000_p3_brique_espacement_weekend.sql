-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Palier 3 : nouvelle brique `espacement_weekend`
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-06-29
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Ajoute au catalogue `briques_regles` la brique « fréquence des
--   week-ends » : au plus 1 garde de WEEK-END toutes les N semaines
--   (« un week-end sur N », N ≥ 2). Interprétation A validée par MiKL :
--   c'est un ESPACEMENT (pas plus souvent que), pas un cadencement fixe.
--
--   Indispensable AVANT de créer la moindre règle de ce type : la FK
--   regles_cabinet.brique_id → briques_regles.id rejetterait sinon
--   l'insertion (anti-coquille-vide au niveau base).
--
--   L'évaluateur reste en TypeScript (hard-constraints.ts + validateur
--   indépendant validerPlanning.ts). Ce seed n'est qu'un MIROIR LECTURE
--   du schéma (cf. note P1A-001) : famille `limiter`, param `n_semaines`.
--
-- SÉCURITÉ : table de référence, RLS lecture seule. Écriture via migration
--   uniquement (C3). Aucune policy modifiée.
-- IDEMPOTENCE : INSERT … ON CONFLICT (id) DO UPDATE (rejouable).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES
  ('espacement_weekend', 'limiter', 'ESPACEMENT_WE', jsonb_build_object(
    'description', 'Au plus 1 garde de week-end toutes les N semaines (« un week-end sur N », N >= 2)',
    'axes', jsonb_build_array('qui','combien'),
    'params', jsonb_build_object(
      'n_semaines', 'integer (>= 2 ; « un week-end sur 3 » => 3)')))
ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
