-- ============================================================
-- GUARDVETO — R11b de bout en bout : rôle à avantage financier RÉGLABLE
-- Date : 2026-07-03 (audit règles n°2 : « réglage fantôme »)
-- ------------------------------------------------------------
-- Le moteur accepte `roleAvantageFinancier` depuis P4 (slice 1) mais RIEN ne
-- l'alimentait : colonne + RPC d'écriture. Valeurs :
--   'premier' (défaut, historique) | 'second' | 'aucun' (pas d'équilibrage).
--
-- Écriture via RPC SECURITY DEFINER auto-gardée (admin du cabinet courant
-- uniquement, colonne unique) : la table cabinets n'a volontairement PAS de
-- policy UPDATE large. Leçons CERBÈRE : search_path épinglé + REVOKE anon/PUBLIC.
-- RÉVERSIBLE : DROP FUNCTION + DROP COLUMN.
-- ============================================================

ALTER TABLE public.cabinets
  ADD COLUMN IF NOT EXISTS role_avantage_financier text NOT NULL DEFAULT 'premier'
  CHECK (role_avantage_financier IN ('premier', 'second', 'aucun'));

COMMENT ON COLUMN public.cabinets.role_avantage_financier IS
  'R11b : rôle de week-end portant l''avantage financier, équilibré par le moteur (premier | second | aucun).';

CREATE OR REPLACE FUNCTION public.set_role_avantage_financier(p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Réservé à l''administrateur du cabinet.';
  END IF;
  IF p_role NOT IN ('premier', 'second', 'aucun') THEN
    RAISE EXCEPTION 'Valeur invalide (premier | second | aucun).';
  END IF;
  UPDATE public.cabinets
     SET role_avantage_financier = p_role
   WHERE id = public.auth_cabinet_actif();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_role_avantage_financier(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_role_avantage_financier(text) TO authenticated;
