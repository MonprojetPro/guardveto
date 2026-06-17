-- ============================================================
-- GUARDVETO V2 — Automatisation des jours fériés
-- Migration idempotente (CREATE OR REPLACE), atomique
-- Auteur : ruflo — 2026-06-16
-- ============================================================
--
-- OBJECTIF
-- Remplacer le seed manuel année-par-année des jours fériés (cf.
-- 20260616160000_calendrier.sql, sections 4/5/5b) par un calcul
-- déterministe :
--   • calculer_feries(annee, region) : calcule les fériés français
--     d'une année (fixes + mobiles via le comput de Pâques).
--   • sync_feries(debut, fin) : peuple public.jours_feries pour une
--     plage d'années, régions 'metropole' + 'alsace-moselle',
--     en ON CONFLICT (date, region) DO NOTHING (idempotent).
--
-- SCHÉMA CIBLE (déjà appliqué — 20260616160000_calendrier.sql) :
--   public.jours_feries(id uuid, annee int, date date,
--                       libelle text, region text)
--   + UNIQUE INDEX idx_jours_feries_date_region (date, region)
--
-- Cette migration ne crée AUCUNE table, ne touche pas aux données
-- existantes, et n'appelle PAS sync_feries automatiquement (la
-- décision de peupler reste à l'appelant applicatif / admin).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. FONCTION : calculer_feries(annee, region)
--    Calcule les jours fériés français d'une année donnée.
--    IMMUTABLE : pour (annee, region) donné, le résultat est
--    toujours identique → optimisable par le planner.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.calculer_feries(
  p_annee  INTEGER,
  p_region TEXT DEFAULT 'metropole'
)
RETURNS TABLE(j_date DATE, libelle TEXT)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  -- Variables du comput de Pâques (algorithme grégorien
  -- de Meeus/Butcher — "Anonymous Gregorian algorithm")
  a    INTEGER;
  b    INTEGER;
  c    INTEGER;
  d    INTEGER;
  e    INTEGER;
  f    INTEGER;
  g    INTEGER;
  h    INTEGER;
  i    INTEGER;
  k    INTEGER;
  l    INTEGER;
  m    INTEGER;
  mois INTEGER;  -- mois de Pâques (3 = mars, 4 = avril)
  jour INTEGER;  -- jour de Pâques dans le mois
  v_paques DATE; -- dimanche de Pâques (E)
BEGIN
  -- ── Comput de Pâques (Meeus/Butcher, grégorien) ──
  a    := p_annee % 19;
  b    := p_annee / 100;
  c    := p_annee % 100;
  d    := b / 4;
  e    := b % 4;
  f    := (b + 8) / 25;
  g    := (b - f + 1) / 3;
  h    := (19 * a + b - d - g + 15) % 30;
  i    := c / 4;
  k    := c % 4;
  l    := (32 + 2 * e + 2 * i - h - k) % 7;
  m    := (a + 11 * h + 22 * l) / 451;
  mois := (h + l - 7 * m + 114) / 31;
  jour := ((h + l - 7 * m + 114) % 31) + 1;

  -- make_date(année, mois, jour) → dimanche de Pâques
  v_paques := make_date(p_annee, mois, jour);

  -- ── Jours fériés FIXES (métropole + toutes régions) ──
  RETURN QUERY VALUES
    (make_date(p_annee, 1, 1),   'Jour de l''An'),
    (make_date(p_annee, 5, 1),   'Fete du Travail'),
    (make_date(p_annee, 5, 8),   'Victoire 1945'),
    (make_date(p_annee, 7, 14),  'Fete Nationale'),
    (make_date(p_annee, 8, 15),  'Assomption'),
    (make_date(p_annee, 11, 1),  'Toussaint'),
    (make_date(p_annee, 11, 11), 'Armistice'),
    (make_date(p_annee, 12, 25), 'Noel');

  -- ── Jours fériés MOBILES (dérivés de Pâques) ──
  -- Lundi de Pâques = E+1 ; Ascension = E+39 ; Lundi de Pentecôte = E+50
  RETURN QUERY VALUES
    (v_paques + 1,  'Lundi de Paques'),
    (v_paques + 39, 'Ascension'),
    (v_paques + 50, 'Lundi de Pentecote');

  -- ── Spécificités Alsace-Moselle ──
  -- Vendredi Saint = E-2 ; Saint Étienne = 26 décembre
  IF p_region = 'alsace-moselle' THEN
    RETURN QUERY VALUES
      (v_paques - 2,               'Vendredi Saint'),
      (make_date(p_annee, 12, 26), 'Saint Etienne');
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.calculer_feries(INTEGER, TEXT) IS
  'Calcule les jours fériés français d''une année (fixes + mobiles via comput de Pâques Meeus/Butcher). region=''alsace-moselle'' ajoute Vendredi Saint et Saint Étienne. IMMUTABLE.';

-- ─────────────────────────────────────────────────────────────
-- 2. FONCTION : sync_feries(annee_debut, annee_fin)
--    Peuple public.jours_feries pour la plage d'années et les
--    régions 'metropole' + 'alsace-moselle'.
--    SECURITY DEFINER : écrit malgré l'absence de policy INSERT
--    pour authenticated (cf. archi §6.2 — écritures hors RLS).
--    Retourne le nombre total de lignes RÉELLEMENT insérées.
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_feries(
  p_annee_debut INTEGER,
  p_annee_fin   INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_annee   INTEGER;
  v_region  TEXT;
  v_inserted INTEGER;  -- lignes insérées par l'INSERT courant
  v_total   INTEGER := 0;
BEGIN
  -- Régions gérées : métropole + Alsace-Moselle
  FOR v_annee IN p_annee_debut..p_annee_fin LOOP
    FOREACH v_region IN ARRAY ARRAY['metropole', 'alsace-moselle'] LOOP
      INSERT INTO public.jours_feries (annee, date, libelle, region)
      SELECT v_annee, cf.j_date, cf.libelle, v_region
        FROM public.calculer_feries(v_annee, v_region) AS cf
      ON CONFLICT (date, region) DO NOTHING;

      -- Compter les lignes effectivement insérées (hors conflits)
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      v_total := v_total + v_inserted;
    END LOOP;
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION public.sync_feries(INTEGER, INTEGER) IS
  'Peuple public.jours_feries pour [annee_debut, annee_fin] x {metropole, alsace-moselle} via calculer_feries, ON CONFLICT (date, region) DO NOTHING. Retourne le nombre de lignes insérées. SECURITY DEFINER.';

-- ── Sécurité : anon n'appelle jamais sync_feries (écriture) ──
REVOKE EXECUTE ON FUNCTION public.sync_feries(INTEGER, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION public.sync_feries(INTEGER, INTEGER) TO authenticated;

-- ── calculer_feries : lecture pure, accessible aux authentifiés ──
REVOKE EXECUTE ON FUNCTION public.calculer_feries(INTEGER, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.calculer_feries(INTEGER, TEXT) TO authenticated;
