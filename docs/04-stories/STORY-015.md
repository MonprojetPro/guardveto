# [STORY-015] Compteurs individuels par vétérinaire

## Epic
E5 — Compteurs & Équité

## Story
En tant que vétérinaire, je veux voir combien de gardes j'ai faites sur la période en cours afin de savoir si la répartition est équitable.

## Critères d'acceptation
- [ ] Page /compteurs affichant les tableaux de gardes par catégorie
- [ ] Tableau "Gardes week-end" : véto, 1er, 2nd, total, écart vs moyenne
- [ ] Tableau "Gardes semaine" : véto, 1er, 2nd, total
- [ ] Tableau "Jours fériés" : véto, total
- [ ] Tableau "Grands week-ends" : Manon, Antoine, Victor uniquement
- [ ] Colonne "Écart" colorée : vert (0), orange (±1), rouge (≥ ±2)
- [ ] Sélecteur de période pour naviguer entre les périodes
- [ ] Vue véto : voit tous les compteurs mais sa ligne est mise en avant (surbrillance)
- [ ] Admin : voit tout + colonne bonus/malus hérité

## Tâches techniques
- [ ] Créer `src/app/compteurs/page.tsx`
- [ ] Créer `src/components/compteurs/CompteursTable.tsx`
- [ ] Créer `src/hooks/useCompteurs.ts` — query la vue compteurs_gardes
- [ ] Calcul de l'écart côté client (total véto - moyenne du groupe)
- [ ] Mise en avant de la ligne du véto connecté (fond légèrement teinté)

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 3-4h

## Dépendances
- Requiert : STORY-014 (les gardes doivent être affichées et modifiables)
- Débloque : STORY-016

## Agent exécutant
- Dev : SPARK
- Test : TESS (calculs, affichage, sélecteur période)
