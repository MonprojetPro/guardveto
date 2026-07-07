-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Backlog n°6 : tags d'équipe (junior/senior) + brique
--             composition_equipe (« un junior jamais seul »,
--             « au moins un senior par week-end »)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-07
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   1. `veterinaires.tags` — étiquettes LIBRES portées par chaque véto
--      (ex. 'junior', 'senior'). Tableau texte générique : les règles de
--      composition référencent un tag par son libellé, ce qui prépare
--      aussi les cohortes d'équité (backlog n°21) sans re-migration.
--      Défaut '{}' → aucun comportement ne change pour l'existant.
--
--   2. Brique `composition_equipe` au catalogue — règle GLOBALE (pas de
--      « qui » nominal : le qui est un TAG) portée par une ou plusieurs
--      lignes `regles_cabinet` :
--        params: { mode: 'au_moins_un'|'pas_seuls', tag: 'senior',
--                  creneaux?: ['weekend', …] }
--        • au_moins_un → chaque créneau ciblé compte ≥ 1 véto portant le tag
--          (« au moins un senior par week-end »)
--        • pas_seuls   → les porteurs du tag n'ont jamais un créneau à eux
--          seuls (« un junior jamais seul »)
--      force → étage : dure (≤ jamais) = isValid bloque + validateur
--      signale ; souple (≥ sauf_crise) = pénalité dans les deux scoreurs.
--      AUCUNE ligne regles_cabinet créée ici : pas de règle = rien ne change.
--
-- SÉCURITÉ : briques_regles = référence lecture seule (C3), aucune policy
--   modifiée. veterinaires.tags suit les policies existantes de la table.
-- IDEMPOTENCE : ADD COLUMN IF NOT EXISTS + INSERT … ON CONFLICT DO UPDATE.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Tags d'équipe sur les vétérinaires (libres, défaut aucun).
ALTER TABLE public.veterinaires
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.veterinaires.tags IS
  'Étiquettes libres du vétérinaire (ex. junior, senior). Consommées par les règles composition_equipe (backlog n°6) et role_interdit_tag (n°22).';

-- 2. Brique composition_equipe au catalogue.
INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('composition_equipe', 'couverture', 'COMPOSITION', jsonb_build_object(
    'description', 'Composition d''équipe par tag : au_moins_un = chaque créneau ciblé compte au moins un véto portant le tag ; pas_seuls = les porteurs du tag ne sont jamais seuls sur un créneau',
    'axes', jsonb_build_array('qui','quoi'),
    'params', jsonb_build_object(
      'mode', 'string (au_moins_un|pas_seuls)',
      'tag', 'string (étiquette portée par les vétos, ex. senior)',
      'creneaux', 'string[]? (codes de créneaux ciblés — absent = tous)')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
