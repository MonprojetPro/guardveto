# [STORY-019] Notifications email (Resend)

## Epic
E6 — Intégrations

## Story
En tant que vétérinaire, je veux recevoir un email quand un nouveau planning est publié ou quand ma garde est modifiée afin d'être informé sans avoir à vérifier manuellement.

## Critères d'acceptation
- [ ] Email "Nouveau planning publié" envoyé à tous les vétos actifs lors de la publication
- [ ] Email "Garde modifiée" envoyé aux vétos concernés (ancien + nouveau) lors d'une modification post-publication
- [ ] Contenu des emails :
  - Objet clair : "[GuardVeto] Nouveau planning — Période X" ou "[GuardVeto] Garde modifiée — [date]"
  - Corps : résumé des gardes du véto (ou de la modification) + lien vers le planning
- [ ] Emails envoyés via Resend (free tier)
- [ ] Erreur d'envoi : loguée mais ne bloque pas la publication
- [ ] Admin peut voir dans un log si les emails ont été envoyés

## Tâches techniques
- [ ] Configurer Resend (API key dans .env.local)
- [ ] Créer `src/lib/notifications.ts` — fonctions sendPlanningPublie() et sendGardeModifiee()
- [ ] Créer les templates email (HTML simple, responsive)
- [ ] Intégrer sendPlanningPublie() dans /api/publish
- [ ] Intégrer sendGardeModifiee() dans la sauvegarde de modification manuelle
- [ ] Log des envois (table ou console Vercel)

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 3-4h

## Dépendances
- Requiert : STORY-017
- Débloque : STORY-021 (rappels)

## Agent exécutant
- Dev : SPARK
- Test : TESS (envoi, contenu, erreurs)
