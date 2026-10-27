-- ============================================================
-- GUARDVETO — B-175 : chaque véto écrit SA semaine type,
--                     et l'admin choisit les plannings de son cabinet
-- ============================================================
-- Décisions de MiKL, le 27/10 :
--   ① « il faut que ce choix [gardes / journées / les deux] appartienne à
--      l'admin » — jusqu'ici la bascule se faisait en SQL (B-120a ④).
--   ③ « chaque véto sa semaine type, l'admin garde la main ».
--
-- ── ① LA PORTE ÉTROITE SUR `cabinets` ──────────────────────────────────────
--
-- ⚠️ On n'ajoute AUCUNE policy UPDATE sur `cabinets`. B-120a l'avait écrit :
--    une policy UPDATE rouvrirait d'un coup toute la fiche (agenda, expéditeur,
--    adresse, `agenda_perso_ouvert`…) sans qu'un test rougisse. La fonction
--    ci-dessous ne sait écrire QU'UNE colonne, et seulement pour les modules
--    que l'admin a le droit de régler.
--
-- ⚠️ L'ADMIN EST VÉRIFIÉE DANS CE CABINET-CI, pas par `get_user_role()` :
--    celle-ci lit la première fiche venue (`LIMIT 1`, aucun filtre de cabinet).
--    Une personne admin chez A et véto chez B passerait admin chez B.
--
-- ⚠️ La liste des modules réglables est écrite ICI, en dur, et c'est voulu :
--    une fonction SECURITY DEFINER ne doit pas faire confiance à ce que le
--    navigateur lui dit pouvoir régler. Pendant côté TypeScript :
--    `MODULES_REGLABLES_PAR_ADMIN` (src/lib/produit/modules.ts). `gardes` n'y
--    est pas (non éteignable tant que B-175a n'est pas fait), `chat` non plus
--    (aucun écran n'existe : l'allumer ouvrirait une porte sur rien).
--
-- ── ③ CHAQUE VÉTO ÉCRIT SA PROPRE TRAME ────────────────────────────────────
--
-- Une policy PERMISSIVE de plus, qui s'ajoute (OR) à `trames_journee_admin_write`.
-- L'isolation cabinet reste la RESTRICTIVE existante, intacte.
-- Bornée à SA ligne par un EXISTS sur `veterinaires` (et non par
-- `get_veterinaire_id()`, qui a le même `LIMIT 1` sans cabinet).
-- Le secrétariat n'a pas de fiche `veterinaires` : il n'écrit rien.
--
-- ⚠️ CE QUE ÇA N'OUVRE PAS : `presences_journee` (les journées réelles d'un
--    planning) reste en écriture admin seule. Changer sa semaine type ne
--    déplace aucune présence déjà posée — c'est déjà la règle des trames.
--
-- ROLLBACK :
--   -- ⚠️ INSERT et UPDATE seulement, PAS de DELETE : l'application ne supprime
--    jamais une ligne de trame, elle la retire (`actif = false`) pour garder la
--    filiation avec les présences qu'elle a posées. Un `FOR ALL` aurait laissé
--    un véto effacer ses lignes en direct par l'API.
DROP POLICY IF EXISTS trames_journee_veto_own_write ON public.trames_journee;
DROP POLICY IF EXISTS trames_journee_veto_own_insert ON public.trames_journee;
CREATE POLICY trames_journee_veto_own_insert ON public.trames_journee
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.veterinaires v
      WHERE v.id = trames_journee.veterinaire_id
        AND v.user_id = auth.uid()
        AND v.actif = true
    )
  );

DROP POLICY IF EXISTS trames_journee_veto_own_update ON public.trames_journee;
CREATE POLICY trames_journee_veto_own_update ON public.trames_journee
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.veterinaires v
      WHERE v.id = trames_journee.veterinaire_id
        AND v.user_id = auth.uid()
        AND v.actif = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.veterinaires v
      WHERE v.id = trames_journee.veterinaire_id
        AND v.user_id = auth.uid()
        AND v.actif = true
    )
  );

CREATE OR REPLACE FUNCTION public.basculer_module_cabinet(p_module text, p_actif boolean)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cab uuid := public.auth_cabinet_actif();
  v_modules text[];
BEGIN
  IF v_cab IS NULL THEN
    RAISE EXCEPTION 'Aucun cabinet actif.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.veterinaires
    WHERE user_id = auth.uid()
      AND actif = true
      AND role_app = 'admin'
      AND cabinet_id = v_cab
  ) THEN
    RAISE EXCEPTION 'Réservé à l''administrateur du cabinet.' USING ERRCODE = '42501';
  END IF;

  IF p_module IS NULL OR p_module NOT IN ('planning-journee') THEN
    RAISE EXCEPTION 'Ce module ne se règle pas depuis le cabinet.' USING ERRCODE = '22023';
  END IF;

  SELECT modules_actifs INTO v_modules FROM public.cabinets WHERE id = v_cab FOR UPDATE;

  IF p_actif THEN
    IF NOT (p_module = ANY (v_modules)) THEN
      v_modules := array_append(v_modules, p_module);
    END IF;
  ELSE
    v_modules := array_remove(v_modules, p_module);
  END IF;

  UPDATE public.cabinets SET modules_actifs = v_modules WHERE id = v_cab;
  RETURN v_modules;
END;
$$;

REVOKE ALL ON FUNCTION public.basculer_module_cabinet(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.basculer_module_cabinet(text, boolean) TO authenticated;

COMMIT;
