-- ============================================================
-- GUARDVETO — RPC configurer_agenda_cabinet (chantier agenda Google)
-- ============================================================
-- L'écran Réglages (`src/app/(v2)/reglages/actions.ts`,
-- `configurerAgendaAffichage`) appelle déjà
-- `supabase.rpc('configurer_agenda_cabinet', { p_journee_entiere,
-- p_afficher_horaires })` pour écrire `cabinets.agenda_journee_entiere` et
-- `cabinets.agenda_afficher_horaires` (posées par
-- `20260827180000_agenda_google_socle.sql`). Ce RPC n'existait pas encore —
-- `cabinets` n'a AUCUNE policy RLS `UPDATE` pour `authenticated`
-- (`20260616140000_add_cabinets.sql` : écritures réservées au
-- `service_role`), donc sans lui le bouton « Enregistrer » échoue
-- systématiquement (fonction introuvable côté PostgREST).
--
-- MODÈLE COPIÉ À L'IDENTIQUE : `public.configurer_partages_cabinet` et
-- `public.configurer_adresse_cabinet`, définies dans
-- `20260706190000_cabinet_partages_par_cabinet.sql` — vérifié qu'aucune
-- migration ultérieure ne les remplace (seul fichier qui les cite dans tout
-- `supabase/migrations/`, contrairement à `prendre_snapshot` qui avait été
-- réécrite deux fois). Même garde d'autorisation
-- (`get_user_role() = 'admin'`, sinon `RAISE EXCEPTION`), même
-- `SECURITY DEFINER`, même `SET search_path = ''` (chaîne vide — ce modèle
-- préfixe tous ses appels par `public.`, à la différence de
-- `prendre_snapshot` qui fige `'public'` ; reconduit tel quel, pas harmonisé
-- au passage), même ciblage `WHERE id = public.auth_cabinet_actif()` — un
-- admin ne peut donc écrire QUE le cabinet auquel son JWT le rattache,
-- jamais un autre cabinet, jamais un véto ni le secrétariat (`get_user_role()`
-- ne renvoie 'admin' pour aucun des deux). Même REVOKE/GRANT.
-- ============================================================

CREATE OR REPLACE FUNCTION public.configurer_agenda_cabinet(
  p_journee_entiere   boolean,
  p_afficher_horaires boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Réservé à l''administrateur du cabinet.';
  END IF;

  -- Les deux colonnes sont NOT NULL (défauts posés par la migration socle) :
  -- affectation directe, comme les deux RPC copiées pour leurs champs
  -- obligatoires — un appel avec NULL doit échouer bruyamment sur la
  -- contrainte NOT NULL, pas se faire absorber en silence.
  UPDATE public.cabinets
     SET agenda_journee_entiere   = p_journee_entiere,
         agenda_afficher_horaires = p_afficher_horaires,
         mis_a_jour_le            = now()
   WHERE id = public.auth_cabinet_actif();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.configurer_agenda_cabinet(boolean, boolean) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.configurer_agenda_cabinet(boolean, boolean) TO authenticated;
