# [STORY-017] Verrouillage automatique des gardes passées

## Epic
E5 — Compteurs & Équité

## Story
En tant que système, je veux verrouiller automatiquement les gardes dont la date est passée afin qu'elles deviennent le compte officiel et ne soient plus modifiables accidentellement.

## Critères d'acceptation
- [ ] Chaque nuit (00h01) : toutes les gardes dont date < aujourd'hui → verrouille = true
- [ ] Si toutes les gardes d'une période sont verrouillées → statut de la période passe à "verrouille"
- [ ] Au verrouillage d'une période complète → calcul automatique des bonus/malus (appel scorer)
- [ ] Les gardes verrouillées apparaissent en grisé dans le calendrier
- [ ] Seul l'admin peut déverrouiller une garde (bouton "Corriger" avec confirmation)
- [ ] Toute correction est loguée dans audit_log
- [ ] Après correction → recalcul des compteurs

## Tâches techniques
- [ ] Créer un Vercel Cron Job (`/api/cron/lock-gardes`) exécuté chaque nuit
- [ ] Le cron : UPDATE gardes SET verrouille = true WHERE date < CURRENT_DATE AND verrouille = false
- [ ] Le cron : UPDATE periodes SET statut = 'verrouille' WHERE toutes les gardes sont verrouillées
- [ ] Si période verrouillée → appeler calculerBonusMalus()
- [ ] Endpoint de correction admin : déverrouille → modifie → reverrouille → log audit
- [ ] Configurer le cron dans vercel.json

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 3-4h

## Dépendances
- Requiert : STORY-016
- Débloque : STORY-018, STORY-019, STORY-020, STORY-021

## Agent exécutant
- Dev : SPARK
- Test : TESS (verrouillage, correction, audit)
