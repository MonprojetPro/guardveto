-- ============================================================
-- GUARDVETO — Migration 010 : Vues en SECURITY INVOKER
-- Auteur : MAX — MonProjetPro
-- Date   : 2026-06-01
-- ------------------------------------------------------------
-- Corrige l'alerte sécurité Supabase « security_definer_view ».
-- Par défaut les vues s'exécutent avec les droits de leur créateur
-- (SECURITY DEFINER) et CONTOURNENT la RLS de l'utilisateur courant.
-- On force `security_invoker = on` : la vue s'exécute désormais avec
-- les droits de l'utilisateur connecté, donc la RLS des tables
-- sous-jacentes (gardes, periodes, veterinaires...) s'applique enfin.
--
-- Effet métier : un véto ne verra plus, via la vue, le contenu d'une
-- période non publiée (brouillon). L'admin continue de tout voir.
--
-- Aucune donnée n'est modifiée : seules les définitions de vues changent.
-- ============================================================

ALTER VIEW compteurs_gardes SET (security_invoker = on);
ALTER VIEW planning_semaine SET (security_invoker = on);
