-- ============================================================
-- B-210 (13/11) — un jour férié ne reçoit aucune présence de journée
-- ============================================================
-- Proposition de la cliente (Val d'Allier) relayée par MiKL : « le logiciel
-- devrait considérer que personne ne travaille en journée lors d'un jour
-- férié ». Puis, le même jour : « il faut prévoir une option dans les réglages
-- journées pour savoir si les jours fériés comptent comme des journées
-- normales, et par défaut on part du principe que non ».
--
-- ── POURQUOI `false` PAR DÉFAUT, ET POURQUOI C'EST SÛR ──────────────────────
--
-- Le défaut change le comportement de « Remplir les journées » pour TOUS les
-- cabinets, y compris ceux qui existent déjà. C'est voulu, et c'est sans
-- risque pour l'existant : l'application des trames est ADDITIVE (elle ne
-- retire jamais rien). Une présence déjà posée sur un férié reste donc en
-- place — décision MiKL du 13/11 : « on s'en fout, on a qu'un client qui a
-- déjà fait les manœuvres manuellement, ça sera pour les prochains ».
--
-- Un cabinet réellement ouvert les jours fériés allume l'option et relance
-- « Remplir » : l'application étant additive, les fériés se remplissent.
--
-- ⚠️ NOT NULL AVEC DÉFAUT, PAS DE NULLABLE. Un `null` aurait créé un troisième
--    état (« pas encore répondu ») que chaque lecteur aurait interprété à sa
--    façon — et le lecteur qui le lit comme `true` reposerait des présences
--    sur les fériés sans qu'une ligne le dise.
--
-- Aucune table, aucune policy, aucun droit modifié. La RLS de `cabinets`
-- s'applique telle quelle : un cabinet lit et écrit le sien.
-- ============================================================

BEGIN;

ALTER TABLE public.cabinets
  ADD COLUMN IF NOT EXISTS journees_feries_travailles boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cabinets.journees_feries_travailles IS
  'B-210 — true : les jours fériés comptent comme des journées normales et reçoivent les présences des semaines types. false (défaut) : aucune présence n''est posée un jour férié. Ne concerne QUE les journées ; les gardes ont leur propre traitement du férié.';

-- ============================================================
-- LA RPC D'ÉCRITURE — ET POURQUOI UN `update` DIRECT ÉTAIT UN PIÈGE
-- ============================================================
-- 🔴 `public.cabinets` N'A AUCUNE POLICY RLS `UPDATE` POUR `authenticated`.
--    Vérifié en base le 13/11, pas déduit du code :
--
--      select policyname, cmd from pg_policies
--       where schemaname='public' and tablename='cabinets';
--      → une seule ligne : cabinets_select / SELECT
--
--    Les écritures sont réservées au `service_role` depuis
--    `20260616140000_add_cabinets.sql`. Un `.update()` lancé depuis le client
--    authentifié ne lève donc AUCUNE erreur : PostgREST met à jour zéro ligne
--    et rend `error = null`. L'action aurait répondu « enregistré », et
--    l'interrupteur serait revenu à sa place au rafraîchissement — un réglage
--    qui ne s'applique pas sans le dire, soit exactement la famille d'échec
--    silencieux que ce produit combat.
--
--    ⚠️ AUCUN TEST NE POUVAIT L'ATTRAPER : la suite ne touche pas la base. Ce
--       défaut a été trouvé par l'audit du 13/11, en LISANT les policies.
--       C'est la troisième fois que ce piège est payé sur `cabinets` — voir
--       `20260827200000_rpc_configurer_agenda_cabinet.sql`, qui le raconte déjà
--       pour l'agenda Google.
--
-- MODÈLE COPIÉ À L'IDENTIQUE sur `public.configurer_agenda_cabinet` : même
-- garde (`get_user_role() = 'admin'`, sinon exception bruyante), même
-- `SECURITY DEFINER`, même `SET search_path = ''` avec tous les appels
-- préfixés `public.`, même ciblage `WHERE id = public.auth_cabinet_actif()` —
-- un admin n'écrit QUE le cabinet auquel son JWT le rattache. Ni un
-- vétérinaire ni le secrétariat ne passent : `get_user_role()` ne rend 'admin'
-- pour aucun des deux. Même REVOKE/GRANT.
-- ============================================================

CREATE OR REPLACE FUNCTION public.configurer_feries_journees(
  p_travailles boolean
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

  -- La colonne est NOT NULL : un appel avec NULL doit échouer bruyamment sur
  -- la contrainte plutôt que de se faire absorber en silence.
  UPDATE public.cabinets
     SET journees_feries_travailles = p_travailles,
         mis_a_jour_le              = now()
   WHERE id = public.auth_cabinet_actif();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.configurer_feries_journees(boolean) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.configurer_feries_journees(boolean) TO authenticated;

COMMIT;
