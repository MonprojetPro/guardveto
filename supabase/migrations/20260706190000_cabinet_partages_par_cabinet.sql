-- ============================================================
-- GUARDVETO — #10 b/c/d : dé-câblage des partages « en dur » par cabinet
-- Date : 2026-07-06 (avant onboarding cabinet n°2)
-- ------------------------------------------------------------
-- Aujourd'hui trois réglages sont GLOBAUX (env / défaut en dur), donc communs
-- à tous les cabinets — ce qui casse le multi-cabinet :
--   #10b  GOOGLE_CALENDAR_ID  → un seul agenda Google pour tous.
--   #10c  BREVO_FROM_EMAIL    → un seul expéditeur d'emails pour tous.
--   #10d  zone scolaire / région fériés saisies à la main.
--
-- Cette migration porte ces réglages PAR CABINET (colonnes sur `cabinets`) :
--   • google_calendar_id, brevo_from_email, brevo_from_name : NULL = fallback
--     env (comportement du cabinet pilote INCHANGÉ) ;
--   • adresse / code_postal / ville : pour dériver la zone (cf. src/lib/geo-zone.ts).
--   (zone_scolaire + region_feries existent déjà — F5-001.)
--
-- Écriture via RPC SECURITY DEFINER auto-gardée (admin du cabinet courant
-- UNIQUEMENT) : la table `cabinets` n'a volontairement PAS de policy UPDATE
-- large. Même pattern éprouvé que set_role_avantage_financier (2026-07-03).
-- Leçons CERBÈRE : search_path épinglé + REVOKE anon/PUBLIC.
--
-- ISOLATION LECTURE : les nouvelles colonnes héritent de la RLS déjà en place
-- sur `cabinets` (isolation RESTRICTIVE F5-003, 2026-06-18) → un cabinet ne lit
-- que SA propre ligne. Aucune policy n'est modifiée ici.
--
-- RÉVERSIBLE : DROP FUNCTION (x2) + DROP COLUMN (x6). Idempotent (IF NOT EXISTS
-- / CREATE OR REPLACE / DROP IF EXISTS).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. COLONNES — réglages par cabinet
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.cabinets
  ADD COLUMN IF NOT EXISTS google_calendar_id text NULL,
  ADD COLUMN IF NOT EXISTS brevo_from_email    text NULL,
  ADD COLUMN IF NOT EXISTS brevo_from_name     text NULL,
  ADD COLUMN IF NOT EXISTS adresse             text NULL,
  ADD COLUMN IF NOT EXISTS code_postal         text NULL,
  ADD COLUMN IF NOT EXISTS ville               text NULL;

COMMENT ON COLUMN public.cabinets.google_calendar_id IS
  '#10b : ID du Google Agenda du cabinet. NULL = fallback env GOOGLE_CALENDAR_ID.';
COMMENT ON COLUMN public.cabinets.brevo_from_email IS
  '#10c : email expéditeur Brevo du cabinet. NULL = fallback env BREVO_FROM_EMAIL.';
COMMENT ON COLUMN public.cabinets.brevo_from_name IS
  '#10c : nom expéditeur Brevo du cabinet. NULL = fallback env BREVO_FROM_NAME.';
COMMENT ON COLUMN public.cabinets.adresse IS
  '#10d : adresse postale du cabinet (sert à dériver la zone scolaire).';
COMMENT ON COLUMN public.cabinets.code_postal IS
  '#10d : code postal — source de la dérivation département → zone/région (geo-zone.ts).';
COMMENT ON COLUMN public.cabinets.ville IS
  '#10d : ville du cabinet.';

-- ─────────────────────────────────────────────────────────────
-- 2. RPC — configurer les partages agenda + email (admin only)
--    Chaîne vide / espaces → NULL (retombe sur l'env en application).
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.configurer_partages_cabinet(
  p_google_calendar_id text,
  p_brevo_from_email    text,
  p_brevo_from_name     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_calendar text := NULLIF(btrim(coalesce(p_google_calendar_id, '')), '');
  v_email    text := NULLIF(btrim(lower(coalesce(p_brevo_from_email, ''))), '');
  v_name     text := NULLIF(btrim(coalesce(p_brevo_from_name, '')), '');
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Réservé à l''administrateur du cabinet.';
  END IF;

  -- Validation format email (si fourni) — frontière de confiance.
  IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Email expéditeur invalide.';
  END IF;

  UPDATE public.cabinets
     SET google_calendar_id = v_calendar,
         brevo_from_email    = v_email,
         brevo_from_name     = v_name,
         mis_a_jour_le       = now()
   WHERE id = public.auth_cabinet_actif();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.configurer_partages_cabinet(text, text, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.configurer_partages_cabinet(text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. RPC — configurer l'adresse + zone/région dérivées (admin only)
--    p_zone / p_region sont CALCULÉS côté serveur (src/lib/geo-zone.ts) et
--    passés ici ; NULL = dérivation impossible (Corse/DOM/CP invalide) → on
--    CONSERVE la zone/région déjà configurée (aucune dégradation du calendrier).
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.configurer_adresse_cabinet(
  p_adresse     text,
  p_code_postal text,
  p_ville       text,
  p_zone        text,
  p_region      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_zone   text := NULLIF(btrim(coalesce(p_zone, '')), '');
  v_region text := NULLIF(btrim(coalesce(p_region, '')), '');
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Réservé à l''administrateur du cabinet.';
  END IF;

  -- Validation des valeurs dérivées (miroir des CHECK existants).
  IF v_zone IS NOT NULL AND v_zone NOT IN ('A', 'B', 'C') THEN
    RAISE EXCEPTION 'Zone scolaire invalide (A, B ou C).';
  END IF;
  IF v_region IS NOT NULL AND v_region NOT IN (
    'metropole', 'alsace-moselle', 'guadeloupe', 'martinique',
    'guyane', 'reunion', 'mayotte', 'polynesie'
  ) THEN
    RAISE EXCEPTION 'Région fériés invalide.';
  END IF;

  UPDATE public.cabinets
     SET adresse       = NULLIF(btrim(coalesce(p_adresse, '')), ''),
         code_postal   = NULLIF(btrim(coalesce(p_code_postal, '')), ''),
         ville         = NULLIF(btrim(coalesce(p_ville, '')), ''),
         -- Zone/région : on n'écrase que si la dérivation est certaine.
         zone_scolaire = COALESCE(v_zone, zone_scolaire),
         region_feries = COALESCE(v_region, region_feries),
         mis_a_jour_le = now()
   WHERE id = public.auth_cabinet_actif();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.configurer_adresse_cabinet(text, text, text, text, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.configurer_adresse_cabinet(text, text, text, text, text) TO authenticated;
