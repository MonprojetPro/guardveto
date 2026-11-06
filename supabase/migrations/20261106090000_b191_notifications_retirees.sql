-- ============================================================
-- B-191 — Vider la cloche
-- ============================================================
-- MiKL, 06/11 : « pourquoi je n'ai pas la fonction vider la cloche ?! ».
--
-- Vider RETIRE de la cloche, sans effacer la ligne : deux anti-doublons lisent
-- cette table (`signalerIncidentTechnique` : même incident non lu < 24 h ;
-- cron des rappels : un rappel par semaine). Effacer pour de bon relancerait
-- la même alerte juste après qu'on l'a vidée.
--
-- Aucune nouvelle policy : retirer est un UPDATE, déjà borné à SES lignes
-- (`notifications_update_own`, USING + WITH CHECK) et à son cabinet
-- (`notifications_cabinet_isolation`, RESTRICTIVE). Table déjà publiée en
-- temps réel.
-- ============================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS retiree_le TIMESTAMPTZ;

COMMENT ON COLUMN public.notifications.retiree_le IS
  'B-191 — retirée de la cloche par son destinataire (vider / croix). La ligne reste pour les anti-doublons.';

-- La cloche ne lit que ce qui n'est pas retiré.
CREATE INDEX IF NOT EXISTS idx_notifications_vet_visibles
  ON public.notifications (veterinaire_id, created_at DESC)
  WHERE retiree_le IS NULL;
