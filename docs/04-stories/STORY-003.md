# [STORY-003] Contraintes individuelles des vétérinaires

## Epic
E1 — Foundation

## Story
En tant qu'Anne-So (admin), je veux configurer les contraintes de chaque vétérinaire (jours de repos, indisponibilités cycliques, duos interdits) afin que le moteur de génération les respecte.

## Critères d'acceptation
- [ ] Sur la fiche de chaque véto : section "Contraintes" avec liste des contraintes actives
- [ ] Formulaire d'ajout de contrainte avec 4 types :
  - jour_repos_fixe : choix du jour + option "flexible en vacances scolaires"
  - jour_repos_conditionnel : jour si garde WE + jour sinon
  - indisponibilite_cyclique : semaines paires/impaires + périodes (soir, weekend)
  - duo_interdit : sélection d'un autre vétérinaire
- [ ] Affichage en langage clair (pas de JSON brut) — ex: "Repos le mercredi (flexible en vacances scolaires)"
- [ ] Possibilité de modifier ou supprimer chaque contrainte
- [ ] Les contraintes sont stockées en JSONB dans la table contraintes_veto

## Tâches techniques
- [ ] Créer composant `ContrainteForm.tsx` avec formulaire dynamique selon le type
- [ ] Créer composant `ContrainteCard.tsx` pour affichage lisible
- [ ] Intégrer dans la page /admin/veterinaires (section par véto)
- [ ] CRUD contraintes_veto dans Supabase
- [ ] Traduction JSONB → texte lisible (helper `formatContrainte()`)

## Estimation
- Taille : L
- Points : 5
- Durée estimée : 1 jour

## Dépendances
- Requiert : STORY-002
- Débloque : STORY-004, STORY-007 (moteur)

## Agent exécutant
- Dev : SPARK
- Test : TESS (types de contraintes, affichage, persistence)
