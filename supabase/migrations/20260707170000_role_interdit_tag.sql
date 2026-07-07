-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Backlog n°22 : rôle interdit selon attribut
--             (« un junior jamais 1er »)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-07
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Brique `role_interdit_tag` au catalogue — règle GLOBALE (le « qui »
--   est un TAG de veterinaires.tags, comme composition_equipe n°6) :
--     params: { tag: 'junior', role: 'premier', creneaux?: ['weekend', …] }
--   Un véto portant le tag ne peut pas tenir ce rôle sur les créneaux
--   ciblés. force → étage : dure = isValid bloque + validateur signale ;
--   souple = pénalité dans les deux scoreurs.
--   AUCUNE ligne regles_cabinet créée ici : pas de règle = rien ne change.
--
-- SÉCURITÉ : briques_regles = référence lecture seule (C3), aucune policy
--   modifiée.
-- IDEMPOTENCE : INSERT … ON CONFLICT (id) DO UPDATE.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('role_interdit_tag', 'interdire', 'ROLE_INTERDIT', jsonb_build_object(
    'description', 'Rôle interdit selon attribut : un véto portant le tag ne tient jamais ce rôle (ex. un junior jamais 1er)',
    'axes', jsonb_build_array('qui','quoi'),
    'params', jsonb_build_object(
      'tag', 'string (étiquette portée par les vétos, ex. junior)',
      'role', 'string (label de la place interdite, ex. premier)',
      'creneaux', 'string[]? (codes de créneaux ciblés — absent = tous)')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
