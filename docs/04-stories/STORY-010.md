# [STORY-010] API de génération + intégration UI

## Epic
E3 — Moteur de génération

## Story
En tant qu'Anne-So, je veux cliquer sur "Générer le planning" et voir le résultat s'afficher dans le calendrier afin de le vérifier avant publication.

## Critères d'acceptation
- [ ] API Route POST /api/generate qui accepte { periodeId } et retourne le planning généré
- [ ] Bouton "Générer le planning" dans la barre d'actions admin
- [ ] Spinner pendant la génération (1-5 secondes)
- [ ] Le planning généré s'affiche dans le calendrier (statut "brouillon")
- [ ] Les gardes sont insérées dans la table gardes avec verrouille = false
- [ ] Si impasse : affichage de l'alerte avec les jours problématiques
- [ ] Re-génération possible (écrase le brouillon précédent)
- [ ] Seul l'admin peut appeler cette API

## Tâches techniques
- [ ] Créer `src/app/api/generate/route.ts`
- [ ] Intégrer le solver dans l'API Route
- [ ] Insérer les gardes générées dans Supabase (bulk insert)
- [ ] Adapter la barre d'actions admin (STORY-012) pour inclure le bouton
- [ ] Gestion d'erreur : timeout, impasse, erreur serveur
- [ ] Toast succès/erreur

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 3-4h

## Dépendances
- Requiert : STORY-009
- Débloque : STORY-012 (la barre admin a besoin du bouton Générer)

## Agent exécutant
- Dev : SPARK
- Test : TESS (API, intégration, cas d'erreur)
