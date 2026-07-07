-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Backlog n°16 : pénalités souples réglables (R10/R10c/R10b/R8b)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-06
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Ajoute au catalogue `briques_regles` les 4 règles souples historiques
--   dont le poids était câblé dans le moteur (50/45/30/20) :
--     • eviter_we_consecutifs   (R10  — pas 2 week-ends de suite)
--     • eviter_we_avant_vacances(R10c — pas de garde le WE avant ses vacances)
--     • eviter_fete_fin_annee   (R10b — soirs des 24/31 décembre)
--     • inversion_role_ferie    (R8b  — rôle inversé la veille d'un férié)
--
--   Comme R8/R9 (liaison_creneaux/inversion_role), ce sont des règles
--   GLOBALES : une ligne `regles_cabinet` par cabinet porte { actif, force }.
--   AUCUNE ligne n'est créée ici : l'absence de ligne = défaut historique
--   (byte-identique). Le seed est indispensable AVANT toute écriture : la FK
--   regles_cabinet.brique_id → briques_regles.id rejetterait l'insertion.
--
--   ⚠️ Ces règles restent STRUCTURELLEMENT SOUPLES (aucun gardien dur en code) :
--   l'action serveur refuse la force « jamais », et le moteur clampe tout
--   étage < 3 à 3 (défense en profondeur).
--
-- SÉCURITÉ : table de référence, RLS lecture seule (C3). Aucune policy modifiée.
-- IDEMPOTENCE : INSERT … ON CONFLICT (id) DO UPDATE (rejouable).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('eviter_we_consecutifs', 'sequence', 'EVITER_SUITE', jsonb_build_object(
    'description', 'R10 — évite 2 week-ends de garde consécutifs pour un même vétérinaire (préférence réglable, défaut : à éviter sauf crise)',
    'axes', jsonb_build_array('quoi'),
    'params', jsonb_build_object(
      '_reglage', 'aucun paramètre — le réglage porte { actif, force }'))),

  ('eviter_we_avant_vacances', 'interdire', 'EVITER_AVANT', jsonb_build_object(
    'description', 'R10c — évite la garde le week-end qui précède immédiatement des vacances du vétérinaire (préférence réglable, défaut : évitée)',
    'axes', jsonb_build_array('quoi'),
    'params', jsonb_build_object(
      '_reglage', 'aucun paramètre — le réglage porte { actif, force }'))),

  ('eviter_fete_fin_annee', 'interdire', 'EVITER_FETE', jsonb_build_object(
    'description', 'R10b — évite les gardes des soirs de réveillon (24 et 31 décembre) (préférence réglable, défaut : évitée)',
    'axes', jsonb_build_array('quand'),
    'params', jsonb_build_object(
      '_reglage', 'aucun paramètre — le réglage porte { actif, force }'))),

  ('inversion_role_ferie', 'forcer', 'INVERSER_FERIE', jsonb_build_object(
    'description', 'R8b — inverse si possible le rôle 1er/2nd entre la veille d''un jour férié et le férié (préférence réglable, défaut : si possible)',
    'axes', jsonb_build_array('quand'),
    'params', jsonb_build_object(
      '_reglage', 'aucun paramètre — le réglage porte { actif, force }')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
