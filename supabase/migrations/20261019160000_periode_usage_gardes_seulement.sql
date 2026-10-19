-- ============================================================
-- GUARDVETO — LES PLANNINGS DE GARDES SE LIBERENT DES JOURNEES (B-162)
-- ============================================================
-- MiKL, 19/10 : tentative de creer une periode "journees" du 09/11 au 16/11,
-- refusee par le controle de chevauchement — ces dates tombaient dans
-- "Hiver P2" (19/10/2026 -> 10/01/2027), qui portait encore `usage = 'les-deux'`.
--
-- `les-deux` voulait dire « ce planning gere AUSSI les journees » : c'etait le
-- defaut sur toutes les periodes avant cette feature, pour ne retirer aucun
-- droit. Mais il bloque exactement le cas que B-162 devait permettre : une
-- periode journees separee, qui court sur une duree bien plus longue qu'un
-- seul planning de gardes (potentiellement toute l'annee) et qui doit donc
-- pouvoir chevaucher plusieurs plannings de gardes a la fois.
--
-- MiKL a tranche (19/10) : les plannings de gardes passent en `gardes` SEUL.
-- Aucune donnee ne bouge — un planning garde ses gardes, ses presences de
-- journee deja posees, sa structure. Seul le controle de chevauchement d'une
-- creation FUTURE en est affecte : un planning `gardes` ne bloque plus la
-- creation d'une periode `journees` sur les memes dates.
--
-- Applique en production le 19/10 (mcp__supabase__apply_migration), verifie
-- par mesure : 6 periodes (2 cabinets) passees de `les-deux` a `gardes`,
-- 0 valeur imprevue. Ce fichier fige la migration pour l'historique de schema.
-- ============================================================

UPDATE public.periodes
SET usage = 'gardes'
WHERE usage = 'les-deux';
