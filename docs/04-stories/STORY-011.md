# [STORY-011] Vue planning mensuelle (lecture)

## Epic
E4 — Interface Planning

## Story
En tant que vétérinaire ou secrétaire, je veux voir le planning des gardes dans une vue calendrier mensuelle afin de savoir qui est de garde chaque jour.

## Critères d'acceptation
- [ ] Page /planning affichant un calendrier mensuel (grille 7 colonnes : lun-dim)
- [ ] Navigation mois précédent / mois suivant
- [ ] Affichage du nom de la période et de son statut (brouillon/publié/verrouillé)
- [ ] Chaque case affiche :
  - Numéro du jour
  - Badge 1er de garde (couleur du véto + prénom)
  - Badge 2nd de garde (couleur du véto + prénom, si applicable)
  - Icône jour férié si applicable
  - Fond grisé pour les jours passés (verrouillés)
  - Fond légèrement teinté pour les WE
- [ ] Clic sur une case → modale détail en lecture seule (nom des vétos, type de garde)
- [ ] Responsive mobile :
  - Grille compacte avec initiales des vétos (AS, F, J, M, A, V)
  - Toggle vers vue liste (jour par jour, scroll vertical)
- [ ] Légende des couleurs en bas du calendrier

## Tâches techniques
- [ ] Créer `src/app/planning/page.tsx`
- [ ] Créer `src/components/calendar/MonthView.tsx` — grille mensuelle
- [ ] Créer `src/components/calendar/DayCell.tsx` — case d'un jour
- [ ] Créer `src/components/calendar/GardeBadge.tsx` — badge véto avec couleur
- [ ] Créer `src/hooks/usePeriode.ts` — hook période courante
- [ ] Query Supabase : gardes + vétos pour la période affichée
- [ ] Responsive : grille compacte mobile + vue liste alternative

## Estimation
- Taille : L
- Points : 5
- Durée estimée : 1 jour

## Dépendances
- Requiert : TECH-002 (tables gardes + vétos)
- Débloque : STORY-012, STORY-013

## Agent exécutant
- Dev : SPARK
- Design : PIXEL (validation responsive)
- Test : TESS (affichage, navigation, responsive)
