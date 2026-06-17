-- ============================================================
-- GUARDVETO — F1-002 : Migration gardes → attributions
-- Story   : F1-002
-- Auteur  : ruflo — MonProjetPro
-- Date    : 2026-06-16
-- ============================================================
-- Chaque ligne de la table `gardes` devient 2 lignes dans
-- `attributions` : une pour premier_id (role='premier') et,
-- si second_id est non-null, une pour second_id (role='second').
--
-- Mapping des types gardes V1 → codes creneaux_catalogue V2 :
--   'semaine' + vendredi (DOW=5) → 'vendredi_soir'
--   'semaine' + autre jour       → 'semaine_soir'
--   'weekend'                    → 'weekend'
--   'ferie'                      → 'ferie'
--
-- Horaires appliqués (Europe/Paris) :
--   semaine_soir / vendredi_soir : debut = 18h30, fin = +1 jour 08h30
--   weekend                      : debut = 08h30 (samedi), fin = +2 jours 08h30
--   ferie                        : debut = 08h30, fin = +1 jour 08h30
--
-- Idempotence : index unique (planning_id, veterinaire_id,
-- date_debut_reel, role) + ON CONFLICT DO NOTHING.
--
-- La table `gardes` reste intacte (lecture seule pendant la
-- période de transition V1 → V2).
-- ============================================================

-- ============================================================
-- INDEX UNIQUE — Idempotence des insertions
-- Permet de rejouer la migration sans créer de doublons.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_attributions_garde_role
  ON public.attributions(planning_id, veterinaire_id, date_debut_reel, role);


-- ============================================================
-- ATTRIBUTIONS PREMIER (toujours présent dans une garde)
-- ============================================================
INSERT INTO public.attributions (
  cabinet_id,
  planning_id,
  creneau_id,
  veterinaire_id,
  role,
  type_presence,
  date_debut_reel,
  date_fin_reel
)
SELECT
  g.cabinet_id,
  g.periode_id,      -- mapping : periode_id → planning_id (FK sera renommée en F6-002)
  cc.id,             -- creneau_id depuis creneaux_catalogue via mapping de type
  g.premier_id,
  'premier',
  'sur_place',
  -- Calcul de date_debut_reel selon le type de créneau (heure locale Europe/Paris)
  CASE
    WHEN g.type = 'semaine' THEN
      (g.date::TIMESTAMPTZ + INTERVAL '18 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    WHEN g.type = 'weekend' THEN
      (g.date::TIMESTAMPTZ + INTERVAL '8 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    WHEN g.type = 'ferie' THEN
      (g.date::TIMESTAMPTZ + INTERVAL '8 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    ELSE
      g.date::TIMESTAMPTZ
  END,
  -- Calcul de date_fin_reel selon le type de créneau
  CASE
    WHEN g.type = 'semaine' THEN
      ((g.date + INTERVAL '1 day')::TIMESTAMPTZ + INTERVAL '8 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    WHEN g.type = 'weekend' THEN
      ((g.date + INTERVAL '2 days')::TIMESTAMPTZ + INTERVAL '8 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    WHEN g.type = 'ferie' THEN
      ((g.date + INTERVAL '1 day')::TIMESTAMPTZ + INTERVAL '8 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    ELSE
      (g.date + INTERVAL '1 day')::TIMESTAMPTZ
  END
FROM public.gardes g
LEFT JOIN public.creneaux_catalogue cc ON cc.code =
  -- Mapping type gardes V1 → code creneaux_catalogue V2
  CASE
    WHEN g.type = 'semaine' AND EXTRACT(DOW FROM g.date) = 5 THEN 'vendredi_soir'
    WHEN g.type = 'semaine' THEN 'semaine_soir'
    WHEN g.type = 'weekend' THEN 'weekend'
    WHEN g.type = 'ferie'   THEN 'ferie'
    ELSE g.type
  END
WHERE g.premier_id IS NOT NULL
  AND g.cabinet_id IS NOT NULL
ON CONFLICT (planning_id, veterinaire_id, date_debut_reel, role) DO NOTHING;


-- ============================================================
-- ATTRIBUTIONS SECOND (uniquement si second_id est renseigné)
-- ============================================================
INSERT INTO public.attributions (
  cabinet_id,
  planning_id,
  creneau_id,
  veterinaire_id,
  role,
  type_presence,
  date_debut_reel,
  date_fin_reel
)
SELECT
  g.cabinet_id,
  g.periode_id,
  cc.id,
  g.second_id,
  'second',
  'sur_place',
  CASE
    WHEN g.type = 'semaine' THEN
      (g.date::TIMESTAMPTZ + INTERVAL '18 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    WHEN g.type = 'weekend' THEN
      (g.date::TIMESTAMPTZ + INTERVAL '8 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    WHEN g.type = 'ferie' THEN
      (g.date::TIMESTAMPTZ + INTERVAL '8 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    ELSE
      g.date::TIMESTAMPTZ
  END,
  CASE
    WHEN g.type = 'semaine' THEN
      ((g.date + INTERVAL '1 day')::TIMESTAMPTZ + INTERVAL '8 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    WHEN g.type = 'weekend' THEN
      ((g.date + INTERVAL '2 days')::TIMESTAMPTZ + INTERVAL '8 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    WHEN g.type = 'ferie' THEN
      ((g.date + INTERVAL '1 day')::TIMESTAMPTZ + INTERVAL '8 hours 30 minutes') AT TIME ZONE 'Europe/Paris'
    ELSE
      (g.date + INTERVAL '1 day')::TIMESTAMPTZ
  END
FROM public.gardes g
LEFT JOIN public.creneaux_catalogue cc ON cc.code =
  CASE
    WHEN g.type = 'semaine' AND EXTRACT(DOW FROM g.date) = 5 THEN 'vendredi_soir'
    WHEN g.type = 'semaine' THEN 'semaine_soir'
    WHEN g.type = 'weekend' THEN 'weekend'
    WHEN g.type = 'ferie'   THEN 'ferie'
    ELSE g.type
  END
WHERE g.second_id IS NOT NULL
  AND g.cabinet_id IS NOT NULL
ON CONFLICT (planning_id, veterinaire_id, date_debut_reel, role) DO NOTHING;


-- ============================================================
-- VÉRIFICATION POST-MIGRATION (requêtes de contrôle à exécuter
-- manuellement pour valider le résultat)
-- ============================================================
-- Nombre de gardes sources avec premier_id (attendu = nb attributions 'premier')
--   SELECT COUNT(*) FROM public.gardes WHERE premier_id IS NOT NULL AND cabinet_id IS NOT NULL;
--
-- Nombre de gardes sources avec second_id (attendu = nb attributions 'second')
--   SELECT COUNT(*) FROM public.gardes WHERE second_id IS NOT NULL AND cabinet_id IS NOT NULL;
--
-- Total attributions migrées
--   SELECT role, COUNT(*) FROM public.attributions GROUP BY role;
--
-- Contrôle d'intégrité : aucune attribution sans cabinet_id
--   SELECT COUNT(*) FROM public.attributions WHERE cabinet_id IS NULL;
-- ============================================================
