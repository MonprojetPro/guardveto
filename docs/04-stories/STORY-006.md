# [STORY-006] Validation des congés (admin)

## Epic
E2 — Congés & Indisponibilités

## Story
En tant qu'Anne-So (admin), je veux voir les souhaits de congés en attente et les valider ou refuser afin de finaliser les indisponibilités avant de générer un planning.

## Critères d'acceptation
- [ ] Section "Souhaits en attente" en haut de la page /conges (mise en avant visuelle)
- [ ] Compteur de souhaits en attente visible dans la sidebar/nav
- [ ] Boutons "Valider" et "Refuser" sur chaque souhait
- [ ] Possibilité de modifier les dates avant de valider
- [ ] Toast de confirmation après validation/refus
- [ ] Le véto concerné voit le changement de statut
- [ ] Historique des congés (validés, refusés) consultable avec filtre

## Tâches techniques
- [ ] Adapter `CongesList.tsx` : section "En attente" séparée en haut
- [ ] Boutons d'action Valider/Refuser avec confirmation
- [ ] Mise à jour du statut dans Supabase + champ valide_par
- [ ] Badge compteur dans la Sidebar (nombre de souhaits en attente)
- [ ] Formulaire de modification des dates avant validation

## Estimation
- Taille : L
- Points : 5
- Durée estimée : 4-5h

## Dépendances
- Requiert : STORY-005
- Débloque : STORY-009 (moteur a besoin de congés validés)

## Agent exécutant
- Dev : SPARK
- Test : TESS (workflow validation, statuts, compteur)
