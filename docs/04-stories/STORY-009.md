# [STORY-009] Moteur : solver complet (backtracking)

## Epic
E3 — Moteur de génération

## Story
En tant qu'Anne-So, je veux que le moteur génère un planning complet et optimal pour une période donnée afin de ne plus avoir à le faire manuellement.

## Critères d'acceptation
- [ ] Fonction `genererPlanning(periodeId)` retourne un planning complet ou une erreur détaillée
- [ ] Algorithme de backtracking fonctionnel :
  - Trie les jours par difficulté (WE d'abord, fériés, puis semaine)
  - Trie les candidats vétos par score d'équité + bonus/malus
  - Exclut immédiatement les vétos indisponibles (congés, repos, etc.)
  - Backtrack si impasse, essaie le candidat suivant
- [ ] Génération < 5 secondes pour une période de 12 semaines (7 vétos)
- [ ] En cas d'impasse : retourne la liste des jours non couverts + la contrainte bloquante
- [ ] Testé avec 3 scénarios réels :
  - Hiver standard (peu de congés)
  - Été avec congés lourds (beaucoup de semaines de vacances)
  - Cas d'impasse volontaire (trop de contraintes)

## Tâches techniques
- [ ] Créer `src/engine/solver.ts` — algorithme principal
- [ ] Créer `src/engine/rules/index.ts` — agrégateur qui expose hardConstraints + softConstraints + optimization
- [ ] Implémenter le chargement des données depuis Supabase (vétos, contraintes, congés, jours fériés, vacances scolaires, bonus/malus)
- [ ] Créer `tests/engine/solver.test.ts`
- [ ] Créer `tests/engine/scenarios/hiver-standard.json`
- [ ] Créer `tests/engine/scenarios/ete-conges-lourds.json`
- [ ] Créer `tests/engine/scenarios/impasse.json`
- [ ] Benchmark de performance (vérifier < 5s)

## Estimation
- Taille : XL
- Points : 8
- Durée estimée : 2 jours

## Dépendances
- Requiert : STORY-007, STORY-008, STORY-006 (congés validés)
- Débloque : STORY-010

## Agent exécutant
- Dev : SPARK
- Test : TESS (scénarios réels, performance)
