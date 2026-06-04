-- 013 — RPC : marquer l'invitation d'un vétérinaire comme complétée
-- ---------------------------------------------------------------------------
-- Contexte : après avoir défini son mot de passe (page /set-password), un véto
-- doit passer invite_pending = false sur SA fiche. Or la RLS de `veterinaires`
-- réserve l'UPDATE aux admins (policy vet_admin_all) → l'update côté client
-- échouait silencieusement et le statut "invitation en attente" restait affiché.
--
-- Solution : une fonction SECURITY DEFINER qui met à jour UNIQUEMENT la fiche
-- de l'utilisateur courant (borne stricte sur auth.uid()). Aucune escalade
-- possible : un utilisateur ne peut toucher que sa propre ligne, et seulement
-- la colonne invite_pending.

CREATE OR REPLACE FUNCTION public.marquer_invite_complete()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE veterinaires
  SET invite_pending = false
  WHERE user_id = auth.uid();
$$;

-- N'autoriser l'exécution qu'aux utilisateurs connectés (pas anon)
REVOKE EXECUTE ON FUNCTION public.marquer_invite_complete() FROM anon;
GRANT EXECUTE ON FUNCTION public.marquer_invite_complete() TO authenticated;
