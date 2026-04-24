# [STORY-007] Moteur : contraintes dures (R1-R9, R16-R19)

## Epic
E3 — Moteur de génération

## Story
En tant que développeur, je veux un module qui vérifie si l'attribution d'un vétérinaire à une garde est légale selon les contraintes dures afin que le solver ne génère jamais de planning invalide.

## Critères d'acceptation
- [ ] Fonction `isValid(jour, veto, planningPartiel)` retourne `{ valid: boolean, raison?: string }`
- [ ] Contraintes implémentées et testées individuellement :
  - R1 : Jours de repos fixes respectés
  - R2 : Anne-So indisponible semaines impaires (soirs + WE)
  - R3 : Fanny mercredi flexible en vacances scolaires
  - R4 : Jean mardi en repos si garde WE
  - R5 : Salariés jeudi/vendredi conditionnel
  - R6 : Jamais Manon + Antoine seuls en duo
  - R7 : Anne-Cat dernier recours uniquement
  - R8 : Inversion 1er/2nd entre vendredi soir et WE
  - R9 : Vendredi soir lié au WE (même duo)
  - R16 : Véto en congé = aucune garde
  - R17 : Été = 1 seul de garde (semaine)
  - R18 : Hiver = 2 de garde (1er + 2nd)
  - R19 : WE = toujours 2 de garde
- [ ] Chaque contrainte a ses propres tests unitaires avec cas nominaux et cas limites
- [ ] Les fonctions utilitaires (semaine paire/impaire, est-en-vacances-scolaires, est-jour-ferie) sont dans utils.ts

## Tâches techniques
- [ ] Créer `src/engine/types.ts` — types Veterinaire, Garde, Contrainte, JourPlanning, PlanningPartiel
- [ ] Créer `src/engine/utils.ts` — helpers de dates (semaineImpaire, estEnVacancesScolaires, estJourFerie, jourDeLaSemaine)
- [ ] Créer `src/engine/rules/hard-constraints.ts` — toutes les règles dures
- [ ] Créer `tests/engine/hard-constraints.test.ts` — tests unitaires
- [ ] Jeux de données de test : `tests/engine/scenarios/` avec fixtures JSON

## Estimation
- Taille : XL
- Points : 8
- Durée estimée : 2 jours

## Dépendances
- Requiert : STORY-003 (contraintes vétos en base)
- Débloque : STORY-008

## Agent exécutant
- Dev : SPARK
- Test : TESS (tests unitaires exhaustifs)
