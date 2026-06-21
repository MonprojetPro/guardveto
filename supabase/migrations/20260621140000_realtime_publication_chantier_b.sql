-- ============================================================
-- GUARDVETO — Chantier B : activer Realtime sur les tables du planning
-- Auteur : MAX — MonProjetPro
-- Date   : 2026-06-21
-- ------------------------------------------------------------
-- OBJECTIF : la re-validation continue (RevalidationRealtime) et le
-- rafraîchissement live de la vue (RealtimeRefresh) s'abonnent aux
-- changements de ces tables. Pour que Supabase Realtime diffuse ces
-- changements, les tables doivent appartenir à la publication
-- `supabase_realtime`. Aujourd'hui AUCUNE n'y est.
--
-- Tables ajoutées (un changement sur l'une peut rendre un planning publié
-- non conforme, ou modifier ce qui est affiché) :
--   • gardes          — planning modifié manuellement / réparation de crise
--   • conges          — congé validé a posteriori sur un véto de garde (R16)
--   • periodes        — (dé)publication, effectif configurable
--   • veterinaires    — désactivation d'un véto
--   • regles_cabinet  — règle/structure/équité modifiée après publication
--
-- SÉCURITÉ : Realtime applique la RLS de chaque table (un client ne reçoit un
-- event que sur une ligne qu'il a le droit de LIRE via sa policy SELECT). On ne
-- touche AUCUNE policy ici — uniquement l'appartenance à la publication.
--
-- IDEMPOTENCE : on n'ajoute une table que si elle n'y est pas déjà.
-- RÉVERSIBLE : `ALTER PUBLICATION supabase_realtime DROP TABLE public.<t>;`
-- AUCUNE donnée modifiée.
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'gardes', 'conges', 'periodes', 'veterinaires', 'regles_cabinet'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t
      );
    END IF;
  END LOOP;
END $$;
