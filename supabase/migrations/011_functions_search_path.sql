-- ============================================================
-- GUARDVETO — Migration 011 : search_path figé sur les fonctions
-- Auteur : MAX — MonProjetPro
-- Date   : 2026-06-01
-- ------------------------------------------------------------
-- Corrige l'alerte sécurité Supabase « function_search_path_mutable ».
-- Sans search_path figé, une fonction SECURITY DEFINER pourrait être
-- détournée via un objet injecté dans un schéma prioritaire. On fige
-- search_path = public : les fonctions continuent de résoudre la table
-- `veterinaires` exactement comme avant, mais de façon déterministe.
--
-- On ne modifie NI le corps NI les droits EXECUTE de ces fonctions :
-- elles sont utilisées par les policies RLS et appelées par l'app
-- (get_veterinaire_id via RPC dans conges/actions.ts).
-- ============================================================

ALTER FUNCTION public.get_user_role()       SET search_path = public;
ALTER FUNCTION public.get_veterinaire_id()  SET search_path = public;
ALTER FUNCTION public.trigger_set_updated_at() SET search_path = public;
