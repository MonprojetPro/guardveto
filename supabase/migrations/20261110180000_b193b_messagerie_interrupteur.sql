-- ============================================================
-- B-193b — L'administratrice allume et eteint elle-meme la messagerie
-- ============================================================
-- Copie EXACTE de `basculer_module_cabinet` telle qu'elle tourne en base
-- (relue le 10/11 par pg_get_functiondef), avec un seul ajout : `chat` dans la
-- liste des modules reglables. Le garde-fou « au moins un planning allume »
-- est inchange : il ne compte que les PLANNINGS, donc un cabinet ne peut pas
-- se retrouver avec la seule messagerie.
--
-- ⚠️ PENDANT EN CODE : `MODULES_REGLABLES_PAR_ADMIN` (src/lib/produit/modules.ts)
--    porte la meme liste ; `tests/lib/cabinet-journees-seules.test.ts` echoue
--    si les deux divergent.
--
-- Eteindre ne supprime rien : les conversations restent en base, et la RLS
-- (`messagerie_ouverte`) les rend simplement illisibles tant que c'est eteint.
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

  IF p_module IS NULL OR p_module NOT IN ('gardes', 'planning-journee', 'chat') THEN
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

COMMIT;

-- ROLLBACK : rejouer la definition de 20261028180000_b175a_gardes_eteignables.sql
-- (liste 'gardes', 'planning-journee').
