# [STORY-004] Saisie des congés (admin)

## Epic
E2 — Congés & Indisponibilités

## Story
En tant qu'Anne-So (admin), je veux saisir les congés et indisponibilités de chaque vétérinaire afin que le moteur de génération en tienne compte.

## Critères d'acceptation
- [ ] Page /conges accessible à l'admin
- [ ] Bouton "Ajouter un congé" ouvrant un formulaire
- [ ] Formulaire : sélection du véto, dates (par semaine, du lundi au dimanche), type (vacances/formation/santé/autre), commentaire optionnel
- [ ] Liste des congés avec filtres : par véto, par statut, par type
- [ ] Les congés ajoutés par l'admin sont directement en statut "validé"
- [ ] Possibilité de modifier ou supprimer un congé
- [ ] Les congés sont affichés par ordre chronologique

## Tâches techniques
- [ ] Créer `src/app/conges/page.tsx`
- [ ] Créer `src/components/conges/CongesForm.tsx` (formulaire Dialog)
- [ ] Créer `src/components/conges/CongesList.tsx` (liste filtrée)
- [ ] CRUD table conges dans Supabase
- [ ] Filtres : Select par véto + Select par statut + Select par type
- [ ] Toast de confirmation

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 3-4h

## Dépendances
- Requiert : STORY-003
- Débloque : STORY-005, STORY-006, STORY-009 (le moteur a besoin des congés)

## Agent exécutant
- Dev : SPARK
- Test : TESS (saisie, filtres, persistence)
