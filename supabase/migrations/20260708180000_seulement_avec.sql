-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Vague 6 tranche C : garde conditionnelle ORIENTÉE « seulement avec B » (#15b)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-08
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Ajoute au catalogue `briques_regles` la brique PAR-VÉTO `seulement_avec`
--   (famille `interdire`) — une garde conditionnelle ORIENTÉE.
--
--   BESOIN MÉTIER : « moi (A) seulement si B est de garde » — un véto A ne veut
--   être posé sur un créneau QUE si le véto B est dans l'équipe du MÊME créneau
--   (même date + même type). Cas type : un jeune véto qui ne prend des gardes
--   qu'accompagné d'un senior précis.
--
--   ORIENTÉE (le cœur de la brique) : A dépend de B, JAMAIS l'inverse. B peut
--   être de garde sans A ; A ne peut pas être de garde sans B. Contrairement au
--   `duo_interdit` (symétrique, 2 lignes miroir en base), `seulement_avec` est
--   asymétrique : UNE SEULE ligne (refs[0] = A porteur, params.avec_veterinaire_id
--   = B). C'est la version CONDITIONNELLE dur/mou de `preferer_avec` (qui, lui,
--   est une même orientation mais toujours souple).
--
--   Params :
--     • avec_veterinaire_id : id du binôme REQUIS B.
--     • creneaux (optionnel) : ne cibler que ces types de créneau (absent = tous).
--
--   Sémantique « même créneau » : B doit figurer dans l'équipe du MÊME slot.
--   Jugée à la POSE COMPLÉTANTE (gabarit composition_equipe #6) : l'équipe se
--   juge quand la dernière place du créneau se pourvoit. Slot 1 place → A refusé
--   (B ne peut pas y être). INTRA-PÉRIODE (pas de lookback inter-périodes #17).
--   Réglable : dur (étage ≤ 2 = A bloqué sans B) ou mou (pénalité).
--
--   Mal configurée (partenaire absent) → INERTE (jamais de crash, jamais de
--   blocage), des DEUX côtés moteur + validateur indépendant.
--
--   Indispensable AVANT de créer la moindre règle de ce type : la FK
--   regles_cabinet.brique_id → briques_regles.id rejetterait sinon l'insertion
--   (anti-coquille-vide au niveau base).
--
--   L'évaluateur reste en TypeScript (hard-constraints.ts + rules/seulement-avec.ts
--   + validateur indépendant validerPlanning.ts). Ce seed n'est qu'un MIROIR
--   LECTURE du schéma (cf. P1A-001).
--
-- SÉCURITÉ : table de référence, RLS lecture seule. Écriture via migration
--   uniquement (C3). Aucune policy modifiée.
-- IDEMPOTENCE : INSERT … ON CONFLICT (id) DO UPDATE (rejouable).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('seulement_avec', 'interdire', 'SEULEMENT_AVEC', jsonb_build_object(
    'description', 'Garde conditionnelle ORIENTÉE par vétérinaire : ne veut être de garde QUE si un binôme requis est de garde sur le même créneau (A dépend de B, jamais l''inverse — une seule ligne, pas de miroir). Cas type : un jeune véto qui ne prend des gardes qu''accompagné d''un senior précis.',
    'axes', jsonb_build_array('qui','quoi'),
    'params', jsonb_build_object(
      'avec_veterinaire_id', 'string (id du binôme REQUIS — A n''est de garde que si B l''est sur le même créneau)',
      'creneaux', 'string[]? (ne cibler que ces types de créneau — absent = tous)')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
