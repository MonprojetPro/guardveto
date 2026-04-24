# PRD — GuardVeto

**Auteur :** NOVA (Discovery) + OTTO (PRD) — MonProjetPro
**Date :** 23 avril 2026
**Statut :** En attente de validation MiKL
**Document source :** docs/regles-metier-gardes.md

---

## 1. Résumé exécutif

GuardVeto est un outil web de **génération automatique de planning de gardes** pour un cabinet vétérinaire de 7 praticiens (4 associés + 3 salariés). Il remplace le processus actuel (Google Agenda + Excel + attribution manuelle par Anne-So) par un moteur qui connaît toutes les règles métier, génère un planning équitable en quelques secondes, et synchronise le résultat sur les téléphones de toute l'équipe via Google Agenda.

**Utilisateur principal :** Anne-So (associée, planificatrice)
**Utilisateurs secondaires :** 6 autres vétérinaires (consultation), secrétaires (impression)

---

## 2. Problème

Anne-So consacre plusieurs heures chaque mois à construire un planning de gardes manuellement. Elle doit jongler avec :

- Les contraintes individuelles de chaque vétérinaire (jours de repos, semaines paires/impaires, gardes enfant)
- L'interdiction de laisser deux juniors seuls ensemble
- Les congés et formations ponctuelles
- L'équité dans la répartition des gardes (week-ends, jours fériés, nuits)
- Les échanges de gardes après publication

Le résultat : un processus chronophage, sujet aux erreurs, sans suivi d'équité inter-périodes, et qui repose entièrement sur la mémoire d'une seule personne.

---

## 3. Utilisateurs et rôles

| Rôle | Qui | Permissions | Canal principal |
|------|-----|-------------|-----------------|
| **Admin** | Anne-So | Tout : générer, modifier, publier, gérer les congés, voir les compteurs, exporter | Web (desktop + mobile) |
| **Vétérinaire** | Fanny, Jean, Anne-Cat, Manon, Antoine, Victor | Consultation du planning, saisie de souhaits de congés / indisponibilités | Mobile (Google Agenda synchronisé) + Web |
| **Secrétaire** | Personnel administratif | Consultation du planning, export PDF | Web (desktop) |

---

## 4. Fonctionnalités

### 4.1 — Moteur de génération automatique (coeur du produit)

**Description :** Le moteur prend en entrée la liste des vétérinaires, leurs contraintes, les congés posés, et les bonus/malus de la période précédente. Il produit un planning complet pour une période donnée.

**Règles codées dans le moteur :**

| # | Règle | Type | Priorité |
|---|-------|------|----------|
| R1 | Respecter les jours de repos fixes de chaque véto | Contrainte dure | Bloquante |
| R2 | Anne-So indisponible semaines impaires (soirs + WE) | Contrainte dure | Bloquante |
| R3 | Fanny : mercredi flexible pendant les vacances scolaires | Contrainte contextuelle | Bloquante |
| R4 | Jean : mardi en repos si garde le WE (au lieu de vendredi) | Contrainte conditionnelle | Bloquante |
| R5 | Salariés : jeudi en repos si garde WE, vendredi sinon | Contrainte conditionnelle | Bloquante |
| R6 | Jamais Manon + Antoine seuls en duo | Contrainte dure | Bloquante |
| R7 | Anne-Cat = dernier recours uniquement | Contrainte dure | Bloquante |
| R8 | Inversion 1er/2nd entre vendredi soir et week-end | Contrainte dure | Bloquante |
| R9 | Vendredi soir lié au week-end (même duo) | Contrainte dure | Souple si bloquant |
| R10 | Pas 2 WE de garde de suite pour le même véto | Contrainte souple | Forte |
| R11 | Équité WE de garde (priorité absolue) | Optimisation | Haute |
| R12 | Équité jours fériés | Optimisation | Haute |
| R13 | Équité gardes de semaine (en qualité de 1er) | Optimisation | Moyenne |
| R14 | Équité des 2nd de garde (minimiser l'écart) | Optimisation | Basse |
| R15 | Équité des grands week-ends entre salariés | Optimisation | Haute |
| R16 | Véto en congé = aucune garde cette semaine | Contrainte dure | Bloquante |
| R17 | Été : 1 seul de garde la nuit (semaine) | Contrainte saisonnière | Bloquante |
| R18 | Hiver : 2 de garde la nuit (1er + 2nd) | Contrainte saisonnière | Bloquante |
| R19 | WE : toujours 2 de garde (1er + 2nd), toute l'année | Contrainte dure | Bloquante |
| R20 | Bonus/malus de la période précédente pris en compte | Optimisation | Haute |

**Périodes de génération :**

| Saison | Période | Durée | Fréquence de génération |
|--------|---------|-------|------------------------|
| Hiver | 1er lundi de sept → dernier dim d'avril | 3 × 12 semaines | 1 génération par période de 12 semaines |
| Été | 1er lundi de mai → dernier dim d'août | ~17 semaines | 1 seule génération (bloc entier début avril) |

**Comportement en cas d'impasse :**
- Si aucune solution valide n'existe → alerte bloquante avec explication de la contrainte qui pose problème.
- Le moteur peut suggérer d'assouplir une règle souple (ex. : R10) mais ne le fait jamais automatiquement.

### 4.2 — Interface de planification (Anne-So)

**Vue mensuelle :** Calendrier affichant chaque jour avec le(s) vétérinaire(s) de garde (1er et 2nd si applicable). Code couleur par vétérinaire.

**Actions admin :**
- Générer un planning pour une période (bouton "Générer")
- Visualiser le planning généré avant publication
- Modifier manuellement n'importe quelle case (drag & drop ou sélection)
- Lors d'une modification manuelle : le logiciel vérifie en temps réel les règles et alerte si violation
- Publier le planning (déclenche la synchro Google Agenda + notifications)
- Voir le tableau des compteurs (gardes par véto sur la période)
- Voir les bonus/malus en cours

**Gestion des congés :**
- Saisir les congés de chaque véto (par semaine)
- Voir les souhaits de congés posés par les vétos eux-mêmes
- Valider ou modifier les souhaits
- Marquer une indisponibilité ponctuelle (formation, santé)

### 4.3 — Vue vétérinaire (lecture)

- Vue mensuelle de ses propres gardes
- Compteur personnel : nombre de gardes réalisées sur la période en cours (WE, semaine, fériés)
- Formulaire simple pour saisir un souhait de congé ou une indisponibilité (soumis à validation Anne-So)

### 4.4 — Vue secrétaire (lecture + export)

- Vue mensuelle du planning complet (tous les vétos)
- Bouton "Exporter en PDF" → document propre et lisible pour impression

### 4.5 — Synchronisation Google Agenda

- Adresse Gmail dédiée rattachée au cabinet
- À chaque publication ou modification du planning → mise à jour automatique du Google Agenda partagé
- Les vétérinaires ajoutent ce calendrier partagé à leur propre téléphone
- Chaque garde = un événement avec : nom du/des vétos, rôle (1er/2nd), horaires

### 4.6 — Notifications par email

- **Publication d'un nouveau planning** → email à tous les vétérinaires
- **Modification d'une garde** → email aux vétérinaires concernés uniquement
- **Rappel de génération** → email à Anne-So quand la date limite de publication approche et qu'un planning n'est pas encore publié

### 4.7 — Compteurs et bilan

**Compteurs individuels visibles en temps réel :**
- Nombre de gardes WE (1er et 2nd)
- Nombre de gardes semaine (1er et 2nd)
- Nombre de jours fériés de garde
- Nombre de grands WE (salariés uniquement)

**Bilan fin août :**
- Récapitulatif de la saison été par vétérinaire
- Calcul automatique des bonus/malus
- Ces données alimentent la génération de la saison hiver suivante

**Verrouillage automatique :**
- Dès qu'un jour est passé → la garde devient le compte officiel (non modifiable sauf correction admin)
- C'est le passé verrouillé qui fait foi pour les compteurs et l'équité

### 4.8 — Échanges de gardes

- Un vétérinaire signale une indisponibilité imprévue
- Anne-So voit l'alerte et peut :
  - Chercher un remplaçant (le logiciel suggère les vétos disponibles)
  - Modifier le planning manuellement
  - Publier la modification (notification automatique)

---

## 5. Hors périmètre (V1)

- Gestion de la paie ou des heures supplémentaires
- App mobile native (le site web responsive + Google Agenda suffit)
- Import de l'historique Excel (démarrage ardoise vierge)
- Gestion du planning de consultation (uniquement les gardes)
- Multi-cabinet (1 seul cabinet dans V1)
- Gestion des remplaçants externes

---

## 6. Architecture technique (orientation)

| Brique | Choix | Justification |
|--------|-------|---------------|
| Frontend | Next.js (React) | Responsive, rapide, SSR pour le SEO admin n'est pas un enjeu mais le framework est mature |
| Base de données | Supabase (PostgreSQL) | Auth intégrée, Row Level Security pour les rôles, API auto-générée |
| Auth | Supabase Auth | 3 rôles : admin, véto, secrétaire |
| Moteur de planning | TypeScript (serveur) | Algorithme de contraintes custom — le nombre de vétos (7) et la durée (12 semaines) rendent le problème calculable par backtracking sans librairie externe |
| Google Calendar | Google Calendar API | Synchro bidirectionnelle planning → agenda partagé |
| Email | Gmail API ou Resend | Notifications aux vétos |
| PDF | React-PDF ou jsPDF | Génération côté serveur d'un PDF mensuel propre |
| Hébergement | Vercel | Déploiement automatique sur push Git |

---

## 7. Modèle de données (grandes lignes)

```
veterinaires
├── id, nom, statut (associé/salarié), email
├── jours_repos_fixes (JSON)
├── contraintes_specifiques (JSON)
└── actif (boolean)

periodes
├── id, saison (été/hiver), numero_periode (1/2/3 pour hiver)
├── date_debut, date_fin
├── statut (brouillon/publie/verrouille)
└── bonus_malus_entrant (JSON par véto)

gardes
├── id, date, type (semaine/weekend/ferie)
├── premier_id (FK véto), second_id (FK véto, nullable en été)
├── periode_id (FK)
├── verrouille (boolean — auto après date passée)
└── modifie_manuellement (boolean)

conges
├── id, veterinaire_id, semaine_debut, semaine_fin
├── type (vacances/formation/sante/autre)
├── statut (souhait/valide/refuse)
└── saisi_par (véto ou admin)

compteurs (vue calculée)
├── veterinaire_id, periode_id
├── nb_gardes_we, nb_gardes_semaine, nb_feries
├── nb_grands_we (salariés)
└── bonus_malus (calculé)
```

---

## 8. Parcours utilisateur clés

### Parcours 1 — Générer un planning hiver (Anne-So)

1. Anne-So se connecte à GuardVeto
2. Elle voit qu'une nouvelle période de 12 semaines approche (rappel affiché)
3. Elle vérifie que les congés et indisponibilités sont bien saisis pour la période
4. Elle clique "Générer le planning — Période 2 Hiver"
5. Le moteur calcule (2-3 secondes) et affiche le résultat en vue mensuelle
6. Elle repère qu'un vétérinaire a une formation non saisie → elle corrige et re-génère
7. Le résultat lui convient → elle clique "Publier"
8. → Google Agenda mis à jour, emails envoyés, PDF disponible

### Parcours 2 — Consulter ses gardes (vétérinaire)

1. Le vétérinaire reçoit un email "Nouveau planning publié"
2. Option A : il ouvre son Google Agenda sur son téléphone → il voit ses gardes
3. Option B : il ouvre GuardVeto dans son navigateur → vue mensuelle avec son compteur
4. Il voit qu'il est de garde un WE où il a un empêchement → il pose une indisponibilité dans l'app

### Parcours 3 — Échange de garde (Anne-So)

1. Anne-So reçoit un souhait d'échange ou une indisponibilité imprévue
2. Elle ouvre le planning dans GuardVeto
3. Le logiciel lui montre les vétos disponibles pour cette garde
4. Elle modifie la garde manuellement
5. Le logiciel vérifie que la modification ne viole aucune règle
6. Elle valide → notification envoyée aux vétos concernés

### Parcours 4 — Bilan fin août (Anne-So)

1. Le dernier dimanche d'août est passé → la saison été est verrouillée
2. Anne-So ouvre le tableau de bord "Bilan"
3. Elle voit les compteurs de chaque véto et les bonus/malus calculés
4. Ces données sont automatiquement injectées dans le moteur pour la génération de la période 1 hiver

---

## 9. Métriques de succès

Ce n'est pas un produit SaaS — les métriques sont fonctionnelles :

| Métrique | Objectif | Comment mesurer |
|----------|----------|-----------------|
| Temps de génération d'un planning | < 5 secondes | Timer dans l'interface |
| Nombre de modifications manuelles post-génération | < 3 par période (le moteur doit être bon) | Compteur dans la base |
| Écart max d'équité (WE de garde) | ≤ 1 garde d'écart entre vétos sur une période | Compteurs |
| Taux d'adoption Google Agenda | 100% des vétos synchronisés | Vérifié manuellement |
| Alertes d'impasse | < 2 par saison (les congés doivent être bien saisis en amont) | Logs |

---

## 10. Risques

| Risque | Probabilité | Impact | Mitigation |
|--------|------------|--------|------------|
| Le moteur ne trouve pas de solution valide (trop de contraintes) | Moyenne (surtout en été) | Fort | Système d'alerte + suggestion d'assouplissement + modification manuelle |
| Anne-So ne saisit pas les congés à temps | Haute | Moyen | Rappels automatiques avant la date limite de publication |
| Les vétos n'utilisent pas la synchro Google Agenda | Basse | Moyen | Le site web mobile reste accessible sans synchro |
| Complexité du moteur de contraintes (bugs logiques) | Moyenne | Fort | Tests exhaustifs avec des scénarios réels fournis par Anne-So |
| Turnover des salariés (nouveau véto avec nouvelles contraintes) | Certaine (tous les 2-4 ans) | Faible | Interface admin pour ajouter/modifier un véto et ses contraintes |

---

## 11. Planning de développement (indicatif)

| Phase | Contenu | Prérequis |
|-------|---------|-----------|
| **Phase 2 — Architecture** | Modèle de données, API, structure du moteur | Ce PRD validé |
| **Phase 3 — UX Design** | Maquettes des écrans (admin, véto, secrétaire) | Architecture validée |
| **Stories 1-3** | Auth + gestion des vétos + saisie des congés | UX validé |
| **Stories 4-6** | Moteur de génération + vue planning + modification manuelle | Stories 1-3 |
| **Stories 7-8** | Compteurs / bonus-malus + verrouillage automatique | Stories 4-6 |
| **Stories 9-10** | Synchro Google Agenda + notifications email | Stories 4-6 |
| **Story 11** | Export PDF | Stories 4-6 |
| **Story 12** | Rappels automatiques (publication planning) | Stories 9-10 |
| **Recette** | Tests avec données réelles fournies par Anne-So | Toutes les stories |

---

**Validation : MiKL**
*Ce PRD est le document de référence pour la Phase 2 (Architecture par ARCH).*
