# [STORY-018] Synchronisation Google Agenda

## Epic
E6 — Intégrations

## Story
En tant que vétérinaire, je veux que le planning publié apparaisse automatiquement dans le Google Agenda partagé du cabinet afin de consulter mes gardes directement depuis mon téléphone.

## Critères d'acceptation
- [ ] Service Account Google configuré avec accès en écriture au Google Agenda dédié
- [ ] À chaque publication de planning → création/mise à jour des événements dans Google Agenda
- [ ] Chaque garde = 1 événement avec :
  - Titre : "Garde — [Prénom 1er] (1er) + [Prénom 2nd] (2nd)"
  - Date/heure de début et fin selon le type (semaine 18h-8h, WE samedi 8h - lundi 8h)
  - Description : type de garde + rôle de chaque véto
- [ ] L'event_id Google est stocké en base (colonne gardes.google_event_id)
- [ ] Si une garde est modifiée après publication → l'événement est mis à jour (pas dupliqué)
- [ ] Si une garde est supprimée → l'événement est supprimé du Google Agenda
- [ ] Les vétos peuvent ajouter ce calendrier en lecture sur leur téléphone

## Tâches techniques
- [ ] Créer un projet Google Cloud + Service Account + activer Calendar API
- [ ] Stocker les credentials du Service Account dans .env.local
- [ ] Créer `src/lib/google-calendar.ts` — wrapper (create, update, delete event)
- [ ] Créer API Route `/api/calendar-sync` appelée par /api/publish
- [ ] Ajouter colonne google_event_id (TEXT, nullable) à la table gardes
- [ ] Gestion des erreurs : si la synchro échoue, le planning reste publié + alerte admin

## Estimation
- Taille : L
- Points : 5
- Durée estimée : 1 jour

## Dépendances
- Requiert : STORY-017
- Débloque : rien (intégration finale)

## Agent exécutant
- Dev : SPARK
- Test : TESS (synchro, mise à jour, suppression)
