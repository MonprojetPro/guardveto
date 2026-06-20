-- ═══════════════════════════════════════════════════════════════
-- GUARDVETO — P1-B : Corriger les forces des règles repos/indispo (DUR)
-- Auteur : MAX (MPP) — MonProjetPro
-- Date   : 2026-06-20
-- Lot    : Palier 1 — B (le dur/mou devient réel)
-- ───────────────────────────────────────────────────────────────
-- POURQUOI
--   Le lot P1-B branche le DUR/MOU dans le moteur : une règle d'étage
--   ≥ 3 (sauf_crise / evitee / si_possible) devient une PRÉFÉRENCE souple
--   (pénalité, ne bloque plus). Or la migration P1A avait hérité d'étages
--   3/4 pour les REPOS et INDISPONIBILITÉS, alors que le métier
--   (docs/regles-metier-gardes.md) dit que ce sont de VRAIS jours off /
--   indisponibilités → des contraintes DURES.
--
--   Sans cette correction, après déploiement du moteur P1-B, ces repos
--   deviendraient de simples préférences (ex. Fanny pourrait être de garde
--   le mercredi dans une période tendue). On les remet donc en 'jamais'
--   (étage 2 = dur).
--
-- SÛRETÉ
--   ⚠️ Sur le moteur ACTUEL (qui ignore la force), cette mise à jour est un
--   NO-OP comportemental : tout est déjà traité en dur. Elle est donc sûre à
--   appliquer AVANT le déploiement du moteur P1-B (ordre indifférent).
--   Les duos interdits étaient déjà en 'jamais' (inchangés).
--
-- IDEMPOTENCE : WHERE force IN (...) → re-jouer ne touche plus rien.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.regles_cabinet
SET    force = 'jamais',
       version = version + 1
WHERE  brique_id IN ('interdire_creneau', 'repos_conditionnel', 'alternance_ancre')
  AND  force IN ('sauf_crise', 'evitee');

COMMIT;
