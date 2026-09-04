-- ============================================================
-- B-111 — LES PLACES CADENASSÉES PAR L'ADMIN
-- ============================================================
-- MiKL, le 2026-09-04 : l'admin doit pouvoir fixer lui-même certaines places,
-- avant génération ou sur un brouillon, et régénérer le reste sans y toucher.
--
-- ── POURQUOI PAS `gardes.verrouille` ───────────────────────────────────────
--
-- Cette colonne existe déjà mais porte un AUTRE concept : le cron
-- `api/cron/lock-gardes` la passe à `true` tout seul sur les gardes passées et
-- publiées, et l'import d'historique aussi. Son commentaire d'origine le dit :
-- « Garde passée ou publiée — bloquée en modification automatique ».
--
-- La réutiliser aurait deux conséquences, toutes deux fausses : les cadenas de
-- l'admin devant TOMBER à la publication (arbitrage du 04/09), on retirerait un
-- verrou de protection légitime ; et les gardes d'historique importées
-- afficheraient un cadenas cliquable que personne n'a posé.
--
-- ── POURQUOI UN TABLEAU DE RÔLES, ET NON DEUX BOOLÉENS ─────────────────────
--
-- Le cadenas porte sur la PLACE, pas sur la case : l'admin fige le 1er sans le
-- 2nd, le 2nd sans le 1er, ou les deux. Deux booléens `fige_premier` /
-- `fige_second` auraient donc l'air de suffire — ils seraient faux dès qu'un
-- cabinet règle son effectif de nuit à 3 ou 4, ce que le produit autorise déjà.
-- On stocke donc les LABELS des places cadenassées, tels que le catalogue de
-- créneaux les nomme (`premier`, `second`, et tout label sur-mesure).
--
-- Vide = aucune place cadenassée sur cette garde (cas de l'immense majorité).
-- Le cadenas meurt avec la garde, sans ligne orpheline possible.
-- ============================================================

ALTER TABLE public.gardes
  ADD COLUMN IF NOT EXISTS places_figees TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.gardes.places_figees IS
  'B-111 — labels des places CADENASSÉES PAR L''ADMIN (ex. {premier} ou {premier,second}). '
  'Le moteur les pose d''emblée et ne les remet jamais en cause ; il compose autour. '
  'À NE PAS CONFONDRE avec `verrouille`, qui est la protection AUTOMATIQUE des gardes '
  'passées ou publiées (cron lock-gardes). Les cadenas de l''admin tombent à la publication.';
