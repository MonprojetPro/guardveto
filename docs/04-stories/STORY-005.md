# [STORY-005] Souhaits de congés (vétérinaire)

## Epic
E2 — Congés & Indisponibilités

## Story
En tant que vétérinaire, je veux soumettre un souhait de congé ou d'indisponibilité afin qu'Anne-So puisse en tenir compte dans le planning.

## Critères d'acceptation
- [ ] Sur la page /conges, un véto connecté voit uniquement SES congés
- [ ] Bouton "Demander un congé" ouvrant un formulaire simplifié
- [ ] Formulaire : dates (par semaine), type, commentaire (ex: "si possible")
- [ ] Le véto ne peut PAS choisir un autre véto (pré-rempli avec son profil)
- [ ] Le souhait est créé en statut "souhait" (pas validé)
- [ ] Le véto voit le statut de ses demandes : souhait / validé / refusé
- [ ] Le véto ne peut pas modifier un congé déjà validé ou refusé

## Tâches techniques
- [ ] Adapter `src/app/conges/page.tsx` pour la vue véto (filtrage par user connecté)
- [ ] Adapter `CongesForm.tsx` : masquer le sélecteur de véto, pré-remplir
- [ ] RLS : un véto ne peut insérer que des congés avec son propre veterinaire_id et statut "souhait"
- [ ] Affichage badge de statut (souhait = orange, validé = vert, refusé = rouge)

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 2-3h

## Dépendances
- Requiert : STORY-004
- Débloque : STORY-006

## Agent exécutant
- Dev : SPARK
- Test : TESS (saisie véto, RLS, statuts)
