# [STORY-008] Moteur : contraintes souples + optimisation

## Epic
E3 — Moteur de génération

## Story
En tant que développeur, je veux un module qui calcule un score de pénalité pour les contraintes souples et un score d'équité globale afin que le solver puisse choisir la meilleure solution parmi les solutions valides.

## Critères d'acceptation
- [ ] Fonction `penalite(jour, veto, planningPartiel)` retourne un score numérique (0 = parfait)
- [ ] Contraintes souples implémentées :
  - R10 : Pas 2 WE de garde de suite (pénalité forte)
- [ ] Fonction `scoreEquite(planningComplet, bonusMalus)` retourne un score global
- [ ] Optimisations implémentées :
  - R11 : Équité WE de garde (poids le plus fort)
  - R12 : Équité jours fériés (poids fort)
  - R13 : Équité gardes semaine en 1er (poids moyen)
  - R14 : Équité 2nd de garde (poids faible)
  - R15 : Équité grands WE salariés (poids fort)
  - R20 : Bonus/malus de la période précédente pris en compte
- [ ] Tests unitaires pour chaque critère d'optimisation

## Tâches techniques
- [ ] Créer `src/engine/rules/soft-constraints.ts`
- [ ] Créer `src/engine/rules/optimization.ts`
- [ ] Créer `src/engine/scorer.ts` — agrégation des scores avec pondération
- [ ] Créer `tests/engine/soft-constraints.test.ts`
- [ ] Créer `tests/engine/optimization.test.ts`
- [ ] Définir les poids de chaque critère d'optimisation (constantes configurables)

## Estimation
- Taille : L
- Points : 5
- Durée estimée : 1 jour

## Dépendances
- Requiert : STORY-007
- Débloque : STORY-009

## Agent exécutant
- Dev : SPARK
- Test : TESS
