-- B-185 — Bascule du 03/11 : la version du bac a sable s'ouvre a tous les cabinets.
--
-- L'agenda Google perso (« Mon agenda », B-173 / B-181) etait ferme par defaut et
-- ouvert au seul bac a sable. Decision de MiKL le 03/11 : il est ouvert au Val
-- d'Allier et D'OFFICE pour chaque nouveau cabinet.
--
-- ⚠️ Ouvrir l'agenda perso d'un cabinet fait envoyer par Google une invitation a
--    chaque membre au prochain passage de la synchronisation. C'est voulu.

ALTER TABLE public.cabinets ALTER COLUMN agenda_perso_ouvert SET DEFAULT true;

UPDATE public.cabinets
   SET agenda_perso_ouvert = true
 WHERE id = '00000000-0000-0000-0000-000000000001';
