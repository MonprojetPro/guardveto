-- ============================================================
-- GUARDVETO — LE DEFAUT DE COLONNE SUIT LA DECISION APPLICATIVE (B-162)
-- ============================================================
-- Un planning sans `usage` precise est un planning de GARDES, pas "les-deux".
-- `les-deux` bloquait la creation d'une periode journees separee sur les
-- memes dates — exactement le defaut qu'on vient de retirer des 6 periodes
-- existantes (20261019160000_periode_usage_gardes_seulement.sql).
--
-- Seul le bouton "Dates libres" (GenererJourneeChantier.tsx) envoie
-- `usage: 'journees'` explicitement. Tout le reste qui insere dans `periodes`
-- sans preciser `usage` — l'assistant de generation, l'import historique
-- (filou/import-actions.ts), l'outil Filou `creer_periode` — cree des
-- plannings de gardes. Le defaut de colonne suit desormais ce fait, en plus
-- du repli applicatif deja pose dans `creerPeriode` (actions.ts).
--
-- Applique en production le 19/10 (mcp__supabase__apply_migration), verifie :
-- `information_schema.columns` -> `column_default = 'gardes'::text`.
-- ============================================================

ALTER TABLE public.periodes
  ALTER COLUMN usage SET DEFAULT 'gardes';
