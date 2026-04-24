# [STORY-016] Bonus/malus et bilan de période

## Epic
E5 — Compteurs & Équité

## Story
En tant qu'Anne-So (admin), je veux voir le bilan d'une période terminée avec les bonus/malus calculés afin que la prochaine génération rééquilibre automatiquement.

## Critères d'acceptation
- [ ] Quand une période est verrouillée → calcul automatique des bonus/malus
- [ ] Écart positif (a fait plus) = malus → le véto fera moins la période suivante
- [ ] Écart négatif (a fait moins) = bonus → le véto fera plus la période suivante
- [ ] Composant "Carte bilan" affichant :
  - Récapitulatif par véto : gardes réalisées vs quote-part théorique
  - Bonus/malus résultant
  - Comparaison avec les bonus/malus entrants (de la période précédente)
- [ ] Les bonus/malus sont insérés dans la table bonus_malus
- [ ] Le moteur de génération (STORY-009) lit ces bonus/malus en entrée
- [ ] Admin peut visualiser l'historique des bilans (toutes les périodes)

## Tâches techniques
- [ ] Créer `src/engine/scorer.ts` — calcul du bilan d'une période verrouillée
- [ ] Fonction `calculerBonusMalus(periodeId)` : compare les compteurs réels vs quote-part théorique
- [ ] Créer `src/components/compteurs/BonusMalusCard.tsx`
- [ ] Insérer les résultats dans la table bonus_malus
- [ ] Intégrer dans la page /compteurs (onglet "Bilan" ou sélecteur de période verrouillée)

## Estimation
- Taille : L
- Points : 5
- Durée estimée : 4-5h

## Dépendances
- Requiert : STORY-015
- Débloque : STORY-017

## Agent exécutant
- Dev : SPARK
- Test : TESS (calcul bilan, cohérence bonus/malus, historique)
