# [STORY-013] Modale détail / modification de garde

## Epic
E4 — Interface Planning

## Story
En tant qu'Anne-So (admin), je veux cliquer sur une case du calendrier pour voir le détail d'une garde et pouvoir modifier le 1er et/ou le 2nd de garde afin d'ajuster le planning manuellement.

## Critères d'acceptation
- [ ] Clic sur une case → modale avec :
  - Date et type de garde (semaine/weekend/férié)
  - Statut (brouillon/publié/verrouillé)
  - 1er de garde actuel (sélecteur modifiable pour admin)
  - 2nd de garde actuel (sélecteur modifiable pour admin, masqué en été semaine)
- [ ] Liste des vétérinaires disponibles ce jour-là avec raison d'indisponibilité pour les autres
  - Disponible : ✓ + nombre de gardes WE ce mois
  - Indisponible : ✗ + raison (en congé, déjà WE précédent, en formation, jour de repos)
  - Dernier recours : ⚠ Anne-Cat
- [ ] Vérification des règles en temps réel quand on modifie un véto (section "Règles vérifiées")
- [ ] Bouton "Enregistrer" pour sauvegarder + marquer la garde comme modifie_manuellement
- [ ] Pour les rôles véto/secrétaire : modale en lecture seule (pas de sélecteur)
- [ ] Gardes verrouillées : modale lecture seule sauf si admin clique "Corriger" (avec confirmation)

## Tâches techniques
- [ ] Créer composant `GardeDetailModal.tsx`
- [ ] Calculer la liste des vétos disponibles (requête + filtrage par contraintes)
- [ ] Intégrer la vérification des contraintes dures en temps réel (réutiliser hard-constraints.ts)
- [ ] Update Supabase avec modifie_manuellement = true
- [ ] Bouton "Corriger" pour admin sur gardes verrouillées (avec Dialog de confirmation)

## Estimation
- Taille : L
- Points : 5
- Durée estimée : 1 jour

## Dépendances
- Requiert : STORY-011, STORY-012
- Débloque : STORY-014

## Agent exécutant
- Dev : SPARK
- Test : TESS (modification, validation règles, lecture seule)
