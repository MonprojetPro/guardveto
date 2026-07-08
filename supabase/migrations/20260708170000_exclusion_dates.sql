-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — Vague 6 tranche B : exclusion de dates / XOR « pas les deux » (#15a)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-07-08
-- ───────────────────────────────────────────────────────────────
-- OBJET
--   Ajoute au catalogue `briques_regles` la brique PAR-VÉTO `exclusion_dates`
--   (famille `interdire`) — un XOR « pas les deux » sur une paire de cibles.
--
--   Sémantique retenue et FIGÉE : « pas les DEUX » — le véto ne peut pas être
--   de garde À LA FOIS sur les deux cibles (JAMAIS « exactement une » : on
--   n'oblige personne à en faire une). Cas métier dominant : « 24 déc XOR
--   31 déc » (Noël ou Nouvel An, pas les deux).
--
--   Deux formes de params, une SEULE par règle :
--     • fetes : ['noel','nouvel_an'] — paire de codes fête (référentiel
--       historique-fete.ts). Pour CHAQUE année couverte par la période, le
--       véto ne peut couvrir à la fois une instance de la 1re fête ET de la 2e
--       DE LA MÊME ANNÉE (convention « année du décembre » : nouvel_an(N) =
--       31 déc N + 1er janv N+1). Se reconduit seule chaque année.
--     • dates : ['YYYY-MM-DD','YYYY-MM-DD'] — paire de dates ISO explicites,
--       pour tout autre cas. Le véto ne peut être de garde aux deux dates (au
--       sens « jours couverts par ses gardes » — un week-end couvre sam+dim).
--
--   Mal configurée (forme absente, paire identique, date non-ISO) → INERTE
--   (jamais de crash, jamais de blocage), des DEUX côtés moteur + validateur.
--   INTRA-PÉRIODE : le XOR se juge sur le planning de la période en cours (pas
--   de lookback inter-périodes #17, réservé aux règles de RYTHME).
--
--   Indispensable AVANT de créer la moindre règle de ce type : la FK
--   regles_cabinet.brique_id → briques_regles.id rejetterait sinon l'insertion
--   (anti-coquille-vide au niveau base).
--
--   L'évaluateur reste en TypeScript (hard-constraints.ts + validateur
--   indépendant validerPlanning.ts). Ce seed n'est qu'un MIROIR LECTURE du
--   schéma (cf. P1A-001).
--
-- SÉCURITÉ : table de référence, RLS lecture seule. Écriture via migration
--   uniquement (C3). Aucune policy modifiée.
-- IDEMPOTENCE : INSERT … ON CONFLICT (id) DO UPDATE (rejouable).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO public.briques_regles (id, famille, operateur, schema_json) VALUES

  ('exclusion_dates', 'interdire', 'PAS_LES_DEUX', jsonb_build_object(
    'description', 'XOR « pas les deux » par vétérinaire : ne fait jamais de garde à la fois sur les deux cibles (une seule autorisée, jamais les deux). Cas type : 24 déc XOR 31 déc (Noël ou Nouvel An).',
    'axes', jsonb_build_array('qui','quand'),
    'params', jsonb_build_object(
      'fetes', 'string[2]? (paire de codes fête : noel|nouvel_an — forme « fêtes de fin d''année », par année)',
      'dates', 'string[2]? (paire de dates ISO yyyy-MM-dd — forme « dates libres »)')))

ON CONFLICT (id) DO UPDATE SET
  famille     = EXCLUDED.famille,
  operateur   = EXCLUDED.operateur,
  schema_json = EXCLUDED.schema_json;

COMMIT;
