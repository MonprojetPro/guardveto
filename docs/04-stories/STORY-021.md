# [STORY-021] Rappels automatiques de publication

## Epic
E6 — Intégrations

## Story
En tant qu'Anne-So (admin), je veux recevoir un rappel par email quand une période approche et que le planning n'est pas encore publié afin de ne pas oublier de le préparer.

## Critères d'acceptation
- [ ] Rappel envoyé 15 jours avant le début d'une période dont le statut est "brouillon" ou inexistant
- [ ] Rappel envoyé 7 jours avant si toujours pas publié (2e rappel)
- [ ] Email à Anne-So uniquement (rôle admin)
- [ ] Contenu : "La période [X] commence le [date]. Le planning n'est pas encore publié." + lien direct vers la génération
- [ ] Bandeau visible dans l'interface (en plus de l'email) — déjà fait en STORY-014
- [ ] Le cron s'exécute quotidiennement

## Tâches techniques
- [ ] Créer un Vercel Cron Job `/api/cron/rappels` exécuté chaque matin
- [ ] Le cron : vérifier les périodes à venir dont le statut n'est pas "publie"
- [ ] Si date_debut - aujourd'hui ≤ 15 jours → envoyer email de rappel (via notifications.ts)
- [ ] Si date_debut - aujourd'hui ≤ 7 jours → envoyer 2e rappel (libellé plus urgent)
- [ ] Éviter les doublons : stocker la date du dernier rappel envoyé (table ou metadata période)
- [ ] Configurer dans vercel.json

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 2-3h

## Dépendances
- Requiert : STORY-019 (notifications email)
- Débloque : rien (dernière story)

## Agent exécutant
- Dev : SPARK
- Test : TESS (cron, timing, pas de doublon)
