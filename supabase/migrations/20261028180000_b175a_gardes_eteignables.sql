-- ============================================================
-- GUARDVETO — B-175a : un cabinet peut éteindre ses GARDES
-- ============================================================
-- MiKL, 28/10 : « pourquoi je ne peux pas décocher les gardes ? » puis
-- « lance B-175a ». Un cabinet « journées seules » tient seulement le planning
-- de la journée.
--
-- Ce qui change par rapport à B-175 (20261027120000) : la liste des modules
-- réglables par l'admin passe de ('planning-journee') à
-- ('gardes', 'planning-journee'). Le reste de la fonction est identique :
-- admin vérifiée DANS ce cabinet, une seule colonne écrite.
--
-- ⚠️ LE DERNIER MODULE NE S'ÉTEINT PAS. La contrainte
--    `cabinets_modules_actifs_non_vide` le refuse déjà, mais avec un message
--    technique (« violates check constraint ») qui remonterait tel quel à
--    l'écran. On refuse donc AVANT, en français.
--
-- ⚠️ Ce qui est déjà saisi (gardes, échanges, compensations) n'est ni effacé
--    ni modifié : le module éteint le cache, le rallumer le rend.
--
-- Pendant TypeScript : `MODULES_REGLABLES_PAR_ADMIN` (src/lib/produit/modules.ts).
-- ============================================================

BEGIN;

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

  IF p_module IS NULL OR p_module NOT IN ('gardes', 'planning-journee') THEN
    RAISE EXCEPTION 'Ce module ne se règle pas depuis le cabinet.' USING ERRCODE = '22023';
  END IF;

  SELECT modules_actifs INTO v_modules FROM public.cabinets WHERE id = v_cab FOR UPDATE;

  IF p_actif THEN
    IF NOT (p_module = ANY (v_modules)) THEN
      v_modules := array_append(v_modules, p_module);
    END IF;
  ELSE
    v_modules := array_remove(v_modules, p_module);
    IF NOT (v_modules && ARRAY['gardes', 'planning-journee']) THEN
      RAISE EXCEPTION 'Gardez au moins un planning allumé.' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.cabinets SET modules_actifs = v_modules WHERE id = v_cab;
  RETURN v_modules;
END;
$$;

REVOKE ALL ON FUNCTION public.basculer_module_cabinet(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.basculer_module_cabinet(text, boolean) TO authenticated;

COMMIT;
