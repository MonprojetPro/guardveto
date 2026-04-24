# [STORY-002] Gestion des vétérinaires (CRUD)

## Epic
E1 — Foundation

## Story
En tant qu'Anne-So (admin), je veux voir, ajouter, modifier et désactiver les vétérinaires afin de gérer l'équipe du cabinet.

## Critères d'acceptation
- [ ] Page /admin/veterinaires listant tous les vétos (actifs et inactifs)
- [ ] Chaque véto affiché en carte avec : nom, prénom, statut (associé/salarié), rôle app, couleur, état actif/inactif
- [ ] Bouton "Ajouter un vétérinaire" ouvrant un formulaire
- [ ] Bouton "Modifier" sur chaque carte ouvrant le formulaire pré-rempli
- [ ] Possibilité de désactiver un véto (soft delete) sans le supprimer
- [ ] Validation des champs (email unique, nom/prénom requis)
- [ ] Accessible uniquement au rôle admin

## Tâches techniques
- [ ] Créer `src/app/admin/veterinaires/page.tsx`
- [ ] Créer composant carte vétérinaire avec badge couleur
- [ ] Formulaire (Dialog) : nom, prénom, email, statut, rôle, couleur, actif, dernier_recours
- [ ] CRUD Supabase : insert, update, soft delete (actif = false)
- [ ] Toast de confirmation après chaque action

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 3-4h

## Dépendances
- Requiert : STORY-001
- Débloque : STORY-003

## Agent exécutant
- Dev : SPARK
- Test : TESS (CRUD vétos, validation)
