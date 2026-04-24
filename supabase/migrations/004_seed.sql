-- ============================================================
-- GUARDVETO — Migration 004 : Données initiales (Seed)
-- Auteur : SPARK — MonProjetPro
-- Date   : 2026-04-24
-- ============================================================
-- NOTE : Les user_id sont NULL — à remplir après invitation Supabase Auth.
--        L'admin (Anne-So) invite chaque vét via Supabase → Authentication → Users.
-- ============================================================

-- ============================================================
-- 1. VÉTÉRINAIRES (7 profils)
-- ============================================================
-- UUIDs fixes pour pouvoir référencer dans les contraintes
INSERT INTO veterinaires (id, nom, prenom, email, statut, role_app, actif, dernier_recours, couleur) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Cornu',    'Anne-Sophie', 'anneso@guardveto.local',  'associe', 'admin',     true,  false, '#3B82F6'),  -- Bleu
  ('00000000-0000-0000-0000-000000000002', 'Martin',   'Fanny',       'fanny@guardveto.local',   'associe', 'veto',      true,  false, '#8B5CF6'),  -- Violet
  ('00000000-0000-0000-0000-000000000003', 'Dubois',   'Jean',        'jean@guardveto.local',    'associe', 'veto',      true,  false, '#10B981'),  -- Vert
  ('00000000-0000-0000-0000-000000000004', 'Laurent',  'Anne-Cat',    'annecat@guardveto.local', 'associe', 'veto',      true,  true,  '#6B7280'),  -- Gris
  ('00000000-0000-0000-0000-000000000005', 'Petit',    'Manon',       'manon@guardveto.local',   'salarie', 'veto',      true,  false, '#EC4899'),  -- Rose
  ('00000000-0000-0000-0000-000000000006', 'Bernard',  'Antoine',     'antoine@guardveto.local', 'salarie', 'veto',      true,  false, '#F59E0B'),  -- Orange
  ('00000000-0000-0000-0000-000000000007', 'Moreau',   'Victor',      'victor@guardveto.local',  'salarie', 'veto',      true,  false, '#6366F1')   -- Indigo
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. CONTRAINTES INDIVIDUELLES
-- ============================================================

-- ANNE-SO (associée, admin)
-- Contrainte 1 : jours de repos selon la semaine
INSERT INTO contraintes_veto (veterinaire_id, type, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'jour_repos_fixe', '{
    "description": "Jeudi AP semaines impaires + Lundi AP semaines paires + Mercredi semaines paires",
    "regles": [
      { "semaine": "impaire", "jour": "jeudi",    "periode": "apres_midi" },
      { "semaine": "paire",   "jour": "lundi",    "periode": "apres_midi" },
      { "semaine": "paire",   "jour": "mercredi", "periode": "journee" }
    ]
  }'::jsonb);

-- ANNE-SO : indisponibilité cyclique (garde enfant — semaines impaires)
INSERT INTO contraintes_veto (veterinaire_id, type, config) VALUES
  ('00000000-0000-0000-0000-000000000001', 'indisponibilite_cyclique', '{
    "description": "Pas de garde (soir semaine + weekend) les semaines impaires — du jeudi soir sem. impaire au jeudi matin sem. paire",
    "semaines": "impaires",
    "periodes": ["soir_semaine", "weekend"]
  }'::jsonb);

-- FANNY (associée)
-- Mercredi repos fixe sauf vacances scolaires
INSERT INTO contraintes_veto (veterinaire_id, type, config) VALUES
  ('00000000-0000-0000-0000-000000000002', 'jour_repos_fixe', '{
    "description": "Mercredi = jour de repos fixe, sauf pendant les vacances scolaires",
    "jour": "mercredi",
    "exception_vacances_scolaires": true
  }'::jsonb);

-- JEAN (associé)
-- Vendredi repos sauf si garde week-end → mardi
INSERT INTO contraintes_veto (veterinaire_id, type, config) VALUES
  ('00000000-0000-0000-0000-000000000003', 'jour_repos_conditionnel', '{
    "description": "Vendredi en repos sauf si garde WE → alors repos le mardi",
    "si_garde_we": "mardi",
    "sinon": "vendredi"
  }'::jsonb);

-- ANNE-CAT (associée, dernier recours — pas de contrainte de repos saisie,
--           gérée par le flag dernier_recours = true dans la table veterinaires)
-- Contrainte : mercredi AP + un autre AP dans la semaine (variable)
INSERT INTO contraintes_veto (veterinaire_id, type, config) VALUES
  ('00000000-0000-0000-0000-000000000004', 'jour_repos_fixe', '{
    "description": "Mercredi après-midi fixe + un autre demi-journée dans la semaine (variable, à définir chaque période)",
    "jour": "mercredi",
    "periode": "apres_midi",
    "repos_supplementaire_variable": true
  }'::jsonb);

-- MANON (salariée)
-- Jeudi si garde WE, Vendredi sinon
INSERT INTO contraintes_veto (veterinaire_id, type, config) VALUES
  ('00000000-0000-0000-0000-000000000005', 'jour_repos_conditionnel', '{
    "description": "Jeudi en repos si garde le WE (grand week-end), Vendredi sinon",
    "si_garde_we": "jeudi",
    "sinon": "vendredi"
  }'::jsonb);

-- MANON : duo interdit avec Antoine
INSERT INTO contraintes_veto (veterinaire_id, type, config) VALUES
  ('00000000-0000-0000-0000-000000000005', 'duo_interdit', '{
    "description": "Manon et Antoine ne peuvent pas être seuls ensemble (trop juniors) — y compris Noël/Jour de l An",
    "avec_veterinaire_id": "00000000-0000-0000-0000-000000000006"
  }'::jsonb);

-- ANTOINE (salarié)
-- Jeudi si garde WE, Vendredi sinon
INSERT INTO contraintes_veto (veterinaire_id, type, config) VALUES
  ('00000000-0000-0000-0000-000000000006', 'jour_repos_conditionnel', '{
    "description": "Jeudi en repos si garde le WE (grand week-end), Vendredi sinon",
    "si_garde_we": "jeudi",
    "sinon": "vendredi"
  }'::jsonb);

-- ANTOINE : duo interdit avec Manon
INSERT INTO contraintes_veto (veterinaire_id, type, config) VALUES
  ('00000000-0000-0000-0000-000000000006', 'duo_interdit', '{
    "description": "Antoine et Manon ne peuvent pas être seuls ensemble — y compris Noël/Jour de l An",
    "avec_veterinaire_id": "00000000-0000-0000-0000-000000000005"
  }'::jsonb);

-- VICTOR (salarié)
-- Jeudi si garde WE, Vendredi sinon (même règle que Manon/Antoine)
INSERT INTO contraintes_veto (veterinaire_id, type, config) VALUES
  ('00000000-0000-0000-0000-000000000007', 'jour_repos_conditionnel', '{
    "description": "Jeudi en repos si garde le WE (grand week-end), Vendredi sinon",
    "si_garde_we": "jeudi",
    "sinon": "vendredi"
  }'::jsonb);

-- ============================================================
-- 3. JOURS FÉRIÉS FRANÇAIS 2026
-- ============================================================
INSERT INTO jours_feries (date, nom) VALUES
  ('2026-01-01', 'Jour de l''An'),
  ('2026-04-06', 'Lundi de Pâques'),
  ('2026-05-01', 'Fête du Travail'),
  ('2026-05-08', 'Victoire 1945'),
  ('2026-05-14', 'Ascension'),
  ('2026-05-25', 'Lundi de Pentecôte'),
  ('2026-07-14', 'Fête Nationale'),
  ('2026-08-15', 'Assomption'),
  ('2026-11-01', 'Toussaint'),
  ('2026-11-11', 'Armistice'),
  ('2026-12-25', 'Noël')
ON CONFLICT (date) DO NOTHING;

-- ============================================================
-- 4. JOURS FÉRIÉS FRANÇAIS 2027
-- ============================================================
INSERT INTO jours_feries (date, nom) VALUES
  ('2027-01-01', 'Jour de l''An'),
  ('2027-03-29', 'Lundi de Pâques'),
  ('2027-05-01', 'Fête du Travail'),
  ('2027-05-06', 'Ascension'),
  ('2027-05-08', 'Victoire 1945'),
  ('2027-05-17', 'Lundi de Pentecôte'),
  ('2027-07-14', 'Fête Nationale'),
  ('2027-08-15', 'Assomption'),
  ('2027-11-01', 'Toussaint'),
  ('2027-11-11', 'Armistice'),
  ('2027-12-25', 'Noël')
ON CONFLICT (date) DO NOTHING;

-- ============================================================
-- 5. VACANCES SCOLAIRES 2025-2026 (Zone B)
-- NOTE : À vérifier et mettre à jour avec le calendrier officiel
--        Education.gouv.fr — Zone B (Grenoble, Lyon, etc.)
-- ============================================================
INSERT INTO vacances_scolaires (date_debut, date_fin, nom, zone) VALUES
  -- Toussaint 2025
  ('2025-10-18', '2025-11-03', 'Toussaint 2025', 'B'),
  -- Noël 2025-2026
  ('2025-12-20', '2026-01-05', 'Noël 2025-2026', 'B'),
  -- Hiver 2026
  ('2026-02-07', '2026-02-23', 'Hiver 2026', 'B'),
  -- Printemps / Pâques 2026
  ('2026-04-11', '2026-04-27', 'Pâques 2026', 'B'),
  -- Grandes vacances 2026 (identiques pour toutes zones)
  ('2026-07-04', '2026-09-01', 'Grandes Vacances 2026', 'B')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. VACANCES SCOLAIRES 2026-2027 (Zone B)
-- ============================================================
INSERT INTO vacances_scolaires (date_debut, date_fin, nom, zone) VALUES
  -- Toussaint 2026
  ('2026-10-17', '2026-11-02', 'Toussaint 2026', 'B'),
  -- Noël 2026-2027
  ('2026-12-19', '2027-01-04', 'Noël 2026-2027', 'B'),
  -- Hiver 2027
  ('2027-02-06', '2027-02-22', 'Hiver 2027', 'B'),
  -- Printemps / Pâques 2027
  ('2027-04-10', '2027-04-26', 'Pâques 2027', 'B'),
  -- Grandes vacances 2027
  ('2027-07-03', '2027-09-01', 'Grandes Vacances 2027', 'B')
ON CONFLICT DO NOTHING;

-- ============================================================
-- FIN DU SEED
-- ============================================================
-- ACTIONS POST-SEED requises par l'admin (Anne-So) :
--
-- 1. Inviter chaque vétérinaire via Supabase Dashboard :
--    Authentication → Users → Invite user (email du vét)
--
-- 2. Après invitation, lier le user_id :
--    UPDATE veterinaires SET user_id = '<uuid_auth>' WHERE email = '<email>';
--
-- 3. Vérifier/mettre à jour les vacances scolaires avec le calendrier officiel :
--    https://www.education.gouv.fr/les-dates-de-rentree-scolaire-3650
--    La zone (A/B/C) doit correspondre à la zone académique du cabinet.
-- ============================================================
