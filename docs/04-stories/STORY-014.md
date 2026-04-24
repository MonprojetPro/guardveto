# [STORY-014] Alertes et violations de règles

## Epic
E4 — Interface Planning

## Story
En tant qu'Anne-So (admin), je veux voir clairement les alertes quand une règle est violée ou quand le moteur ne trouve pas de solution afin de prendre les bonnes décisions.

## Critères d'acceptation
- [ ] Alerte d'impasse (génération) : bandeau rouge avec jours non couverts + contrainte bloquante + suggestions d'assouplissement
- [ ] Alerte de violation de règle dure (modification manuelle) : Dialog rouge avec explication + bouton "Forcer quand même"
- [ ] Alerte de violation de règle souple (modification manuelle) : Dialog orange avec explication + bouton "Accepter"
- [ ] Bandeau de rappel de publication : si une période commence dans < 15 jours et statut = brouillon → bandeau orange en haut du planning
- [ ] Les suggestions d'assouplissement sont actionnables (liens vers Modifier les congés, Forcer manuellement)

## Tâches techniques
- [ ] Créer composant `AlerteBandeau.tsx` (impasse + rappel)
- [ ] Créer composant `ViolationDialog.tsx` (règle dure rouge / règle souple orange)
- [ ] Intégrer dans GardeDetailModal (vérification au changement)
- [ ] Intégrer le bandeau de rappel dans la page planning (calcul date vs période)
- [ ] Formater les messages d'erreur en langage clair (pas de code technique)

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 3-4h

## Dépendances
- Requiert : STORY-012, STORY-013
- Débloque : STORY-015

## Agent exécutant
- Dev : SPARK
- Test : TESS (scénarios de violation, rappel)
