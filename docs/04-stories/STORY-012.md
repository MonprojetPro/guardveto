# [STORY-012] Vue planning admin (actions)

## Epic
E4 — Interface Planning

## Story
En tant qu'Anne-So (admin), je veux une barre d'actions au-dessus du calendrier avec les boutons Générer, Publier et Exporter PDF afin de gérer le cycle de vie du planning.

## Critères d'acceptation
- [ ] Barre d'actions visible uniquement pour l'admin, au-dessus du calendrier
- [ ] Affichage de la période sélectionnée + son statut
- [ ] Bouton "Générer le planning" (cyan) — appelle /api/generate
- [ ] Bouton "Publier" (vert) — désactivé si pas de planning généré ou déjà publié
- [ ] Bouton "Exporter PDF" (outline) — toujours disponible si un planning existe
- [ ] Sélecteur de période (dropdown) pour naviguer entre les périodes
- [ ] Page /admin/periodes pour voir toutes les périodes et leur statut

## Tâches techniques
- [ ] Créer composant `ActionBar.tsx` (conditionnel au rôle admin)
- [ ] Intégrer dans `src/app/planning/page.tsx`
- [ ] API Route POST /api/publish (change statut → publié, déclenche synchro + notifs)
- [ ] Créer `src/app/admin/periodes/page.tsx` — liste des périodes
- [ ] Sélecteur de période avec hook `usePeriode`

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 3-4h

## Dépendances
- Requiert : STORY-011, STORY-010
- Débloque : STORY-013, STORY-014

## Agent exécutant
- Dev : SPARK
- Test : TESS (boutons, états, permissions)
