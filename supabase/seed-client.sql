-- ============================================================
-- GUARDVETO — Seed de migration vers la base CLIENT
-- Généré le 2026-06-02 depuis la base de pré-production.
-- ------------------------------------------------------------
-- Contenu : 7 vétérinaires réels (rôles ajustés), leurs règles,
-- jours fériés et vacances scolaires. AUCUN planning, congé ni
-- historique (départ propre pour la démo en direct).
-- À exécuter APRÈS le schéma (migrations 001-012 sauf 004_seed).
--
-- NB : user_id = NULL → chaque véto sera relié à son compte lors
-- de l'invitation. Les emails @guardveto.local sont des
-- PLACEHOLDERS à remplacer par les vrais emails avant invitation.
-- ============================================================

-- ── Vétérinaires (Anne-Catherine + Anne-Sophie = admin) ──────
INSERT INTO veterinaires (id, user_id, nom, prenom, email, statut, role_app, actif, dernier_recours, couleur, invite_pending) VALUES
('00000000-0000-0000-0000-000000000002', NULL, 'Altieri', 'Fanny', 'fanny@guardveto.local', 'associe', 'veto', true, false, '#8B5CF6', true),
('00000000-0000-0000-0000-000000000004', NULL, 'Bernard', 'Anne-Catherine', 'annecat@guardveto.local', 'associe', 'admin', true, true, '#6B7280', true),
('00000000-0000-0000-0000-000000000001', NULL, 'Blanchard', 'Anne-Sophie', 'vetovaldallier@gmail.com', 'associe', 'admin', true, false, '#3B82F6', true),
('00000000-0000-0000-0000-000000000007', NULL, 'Coelho', 'Victor', 'victor@guardveto.local', 'salarie', 'veto', true, false, '#6366F1', true),
('00000000-0000-0000-0000-000000000003', NULL, 'De Thoisy', 'Jean', 'jean@guardveto.local', 'associe', 'veto', true, false, '#10B981', true),
('00000000-0000-0000-0000-000000000006', NULL, 'Lafarge', 'Antoine', 'antoine@guardveto.local', 'salarie', 'veto', true, false, '#F59E0B', true),
('00000000-0000-0000-0000-000000000005', NULL, 'Renaud', 'Manon', 'manon@guardveto.local', 'salarie', 'veto', true, false, '#EC4899', true);

-- ── Contraintes / règles individuelles ──────────────────────
INSERT INTO contraintes_veto (id, veterinaire_id, type, config, actif) VALUES
('af88fac6-0404-431f-9ea1-65c3ceceac0a', '00000000-0000-0000-0000-000000000002', 'jour_repos_fixe', '{"jour": "mercredi", "description": "Mercredi repos fixe sauf vacances scolaires", "exception_vacances_scolaires": true}'::jsonb, true),
('5ada4d5f-17fd-4211-9f98-e64891aee7cb', '00000000-0000-0000-0000-000000000004', 'jour_repos_fixe', '{"jour": "mercredi", "periode": "apres_midi", "description": "Mercredi apres-midi fixe + un autre demi-journee variable", "repos_supplementaire_variable": true}'::jsonb, true),
('ad1dba16-060b-45d5-937c-040d1c645474', '00000000-0000-0000-0000-000000000003', 'jour_repos_conditionnel', '{"sinon": "vendredi", "description": "Vendredi repos sauf si garde WE alors mardi", "si_garde_we": "mardi"}'::jsonb, true),
('f1983ea7-569d-4d03-acb2-159b6a0f64a0', '00000000-0000-0000-0000-000000000006', 'jour_repos_conditionnel', '{"sinon": "vendredi", "description": "Jeudi si garde WE, Vendredi sinon", "si_garde_we": "jeudi"}'::jsonb, true),
('cdbe6498-44d8-4a11-bbcf-7a522bc3f937', '00000000-0000-0000-0000-000000000006', 'duo_interdit', '{"description": "Antoine et Manon ne peuvent pas etre seuls", "avec_veterinaire_id": "00000000-0000-0000-0000-000000000005"}'::jsonb, true),
('804cd035-7f51-44e2-9f56-0d6829e74f8f', '00000000-0000-0000-0000-000000000005', 'jour_repos_conditionnel', '{"sinon": "vendredi", "description": "Jeudi si garde WE, Vendredi sinon", "si_garde_we": "jeudi"}'::jsonb, true),
('412726e2-3b00-41ed-bd45-adff3c052118', '00000000-0000-0000-0000-000000000005', 'duo_interdit', '{"description": "Manon et Antoine ne peuvent pas etre seuls", "avec_veterinaire_id": "00000000-0000-0000-0000-000000000006"}'::jsonb, true),
('76352224-bc81-4996-b435-8fee694468e9', '00000000-0000-0000-0000-000000000007', 'jour_repos_conditionnel', '{"sinon": "vendredi", "description": "Jeudi si garde WE, Vendredi sinon", "si_garde_we": "jeudi"}'::jsonb, true),
('f961c313-1c9d-490e-891e-f7d6195a095f', '00000000-0000-0000-0000-000000000001', 'jour_repos_fixe', '{"regles": [{"jour": "jeudi", "periode": "apres_midi", "semaine": "impaire"}, {"jour": "lundi", "periode": "apres_midi", "semaine": "paire"}, {"jour": "mercredi", "periode": "journee", "semaine": "paire"}], "description": "Jeudi AP semaines impaires + Lundi AP semaines paires + Mercredi semaines paires"}'::jsonb, true),
('95c6f138-2835-4bc6-8d76-bb91c6b11894', '00000000-0000-0000-0000-000000000001', 'indisponibilite_cyclique', '{"periodes": ["soir_semaine", "weekend"], "semaines": "impaires", "description": "Pas de garde soir semaine + weekend les semaines impaires"}'::jsonb, true);

-- ── Jours fériés (référence) ─────────────────────────────────
INSERT INTO jours_feries (id, date, nom) VALUES
('11cdf6e3-6d49-4dac-b07f-543c3b6ed241', '2026-01-01', 'Jour de l An'),
('11eded89-bfba-4286-b92a-064970449cac', '2026-04-06', 'Lundi de Paques'),
('a0514403-f706-4a01-bab1-8b3183a4b055', '2026-05-01', 'Fete du Travail'),
('72623ae8-e191-4d31-8749-9f98112857ea', '2026-05-08', 'Victoire 1945'),
('70d4ce2f-b29a-4b2c-927c-3f262de8ba80', '2026-05-14', 'Ascension'),
('4270f564-c531-4be9-b778-a74d29643c58', '2026-05-25', 'Lundi de Pentecote'),
('8ae4a8dd-920a-47b9-a8d3-7f9055eaaf3f', '2026-07-14', 'Fete Nationale'),
('43f4d3be-55d7-4d11-b8d7-ef73ed79ae84', '2026-08-15', 'Assomption'),
('65bfbfa7-a9a1-48c4-acbe-71640538aafd', '2026-11-01', 'Toussaint'),
('a24bb426-0d22-4d3f-8954-d313c929a61c', '2026-11-11', 'Armistice'),
('1a914915-10bb-4d81-9261-78714f4b8383', '2026-12-25', 'Noel'),
('73ffefc2-ff5a-4556-b618-b6ab72e1dc86', '2027-01-01', 'Jour de l An'),
('8b06425c-66cf-4037-8a51-8c58eefa764e', '2027-03-29', 'Lundi de Paques'),
('f41a967c-1708-4718-91c5-4ccb3cbc8555', '2027-05-01', 'Fete du Travail'),
('db59edce-c12b-4bf5-bbb1-47f0b1e43731', '2027-05-06', 'Ascension'),
('ea7ee6e8-0f47-425c-9c80-fc0ecba0258e', '2027-05-08', 'Victoire 1945'),
('2314fe68-56f8-4c24-af98-b5a6064af871', '2027-05-17', 'Lundi de Pentecote'),
('92e3ac2d-f9b1-4503-aca4-85cac5062993', '2027-07-14', 'Fete Nationale'),
('dab0efdc-bbd4-4060-a838-ffe76d0b05f4', '2027-08-15', 'Assomption'),
('24782509-52c5-4154-ae1e-d9670c0c804e', '2027-11-01', 'Toussaint'),
('5f386941-95b7-4854-b4a2-9fe583175195', '2027-11-11', 'Armistice'),
('d0457210-6cff-47a6-a3b9-bd2f9c571460', '2027-12-25', 'Noel');

-- ── Vacances scolaires (référence) ───────────────────────────
INSERT INTO vacances_scolaires (id, date_debut, date_fin, nom, zone) VALUES
('a4f77b42-a46b-4ddc-b6a4-95fea3b35a8b', '2025-10-18', '2025-11-03', 'Toussaint 2025', 'B'),
('a72fad92-0d75-4fb3-b20e-ae381ca9305a', '2025-12-20', '2026-01-05', 'Noel 2025-2026', 'B'),
('f25eab91-89af-417c-9285-0de46d750e29', '2026-02-07', '2026-02-23', 'Hiver 2026', 'B'),
('6414a2b8-b8ee-4fa0-b740-eed5e52cb0b8', '2026-04-11', '2026-04-27', 'Paques 2026', 'B'),
('8420f15e-415f-4873-a853-658ddd469bc4', '2026-07-04', '2026-09-01', 'Grandes Vacances 2026', 'B'),
('6462194e-4868-4774-8eaf-74c4b8910862', '2026-10-17', '2026-11-02', 'Toussaint 2026', 'B'),
('9ddc5283-c225-42b8-a3b4-691d33385cf6', '2026-12-19', '2027-01-04', 'Noel 2026-2027', 'B'),
('d3e2f078-f307-44e2-9490-f21181ad2090', '2027-02-06', '2027-02-22', 'Hiver 2027', 'B'),
('db55fe52-c021-4fce-99c3-235d9d6e62ba', '2027-04-10', '2027-04-26', 'Paques 2027', 'B'),
('d366659a-1734-47cd-910d-bb913ffb19f8', '2027-07-03', '2027-09-01', 'Grandes Vacances 2027', 'B');
