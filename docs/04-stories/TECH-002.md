# [TECH-002] Base de données : tables, vues, RLS, seed

## Epic
E1 — Foundation

## Story
En tant que développeur, je veux le schéma complet de la base de données Supabase créé et peuplé avec les données initiales afin que l'application puisse stocker et lire les données.

## Critères d'acceptation
- [ ] Tables créées : veterinaires, contraintes_veto, periodes, gardes, conges, bonus_malus, jours_feries, vacances_scolaires, audit_log
- [ ] Vue `compteurs_gardes` créée et fonctionnelle
- [ ] Contraintes CHECK en place (statuts, types, date_debut < date_fin, début = lundi)
- [ ] Clés étrangères et index créés
- [ ] RLS activé sur toutes les tables avec policies par rôle (admin, veto, secretaire)
- [ ] Seed : 7 vétérinaires + leurs contraintes + jours fériés 2026-2027 + vacances scolaires zone concernée
- [ ] Migrations versionnées dans supabase/migrations/

## Tâches techniques
- [ ] Créer `supabase/migrations/001_tables.sql` — toutes les tables
- [ ] Créer `supabase/migrations/002_views.sql` — vue compteurs_gardes
- [ ] Créer `supabase/migrations/003_rls.sql` — policies RLS
- [ ] Créer `supabase/migrations/004_seed.sql` — données initiales
- [ ] Vérifier que les 7 vétos sont bien insérés avec leurs contraintes (JSON config)
- [ ] Insérer les jours fériés français 2026 et 2027
- [ ] Insérer les vacances scolaires (zone du cabinet) 2026-2027
- [ ] Tester les policies RLS avec un utilisateur de chaque rôle

## Données de seed — Vétérinaires

| Prénom | Statut | Rôle app | Contraintes |
|--------|--------|----------|-------------|
| Anne-So | associe | admin | jour_repos_fixe (jeu AP imp, lun AP pair, mer pair) + indisponibilite_cyclique (sem. impaires) |
| Fanny | associe | veto | jour_repos_fixe (mercredi, exception vac. scolaires) |
| Jean | associe | veto | jour_repos_conditionnel (ven normal, mar si garde WE) |
| Anne-Cat | associe | veto | dernier_recours = true |
| Manon | salarie | veto | jour_repos_conditionnel (jeu si WE, ven sinon) + duo_interdit (Antoine) |
| Antoine | salarie | veto | jour_repos_conditionnel (jeu si WE, ven sinon) + duo_interdit (Manon) |
| Victor | salarie | veto | jour_repos_conditionnel (jeu si WE, ven sinon) |

## Estimation
- Taille : L
- Points : 5
- Durée estimée : 1 jour

## Dépendances
- Requiert : TECH-001
- Débloque : STORY-001, STORY-002, STORY-011

## Agent exécutant
- Dev : SPARK
