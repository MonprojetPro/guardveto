---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-03-02'
inputDocuments:
  - "product-brief-Projet-Anne-cath-2026-03-02.md"
  - "regles pour planning.docx (cahier des charges - en mémoire)"
workflowType: 'architecture'
project_name: 'Projet Anne cath'
user_name: 'MiKL'
date: '2026-03-02'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

- FR1: Générer un planning de gardes annuel pour 6 vétérinaires (4 associés + 2 salariés)
- FR2: Système de rotation 1er/2nd de garde sur N semaines (N = nombre de vétos disponibles)
- FR3: Planification des week-ends avec inversion 1er/2nd entre vendredi soir et week-end
- FR4: Gestion des contraintes individuelles par vétérinaire (jours de repos, patterns personnels)
- FR5: Gestion du cas particulier AS (garde enfant semaines paires/impaires)
- FR6: Gestion des fêtes de fin d'année avec rotation de duos associé/salarié
- FR7: Répartition équitable des jours fériés avec décompte inter-annuel
- FR8: Gestion des congés (10 sem associés, 6 sem salariés, 1 sem vacances scolaires)
- FR9: Régénération partielle du planning (verrouillage du passé, recalcul du reste)
- FR10: Prise en compte des contraintes personnelles ponctuelles (mariage, événements)

**Non-Functional Requirements:**

- Performance : génération du planning en quelques secondes (52 semaines, 6 vétos)
- Fiabilité : 100% des contraintes dures respectées, optimisation maximale des contraintes souples
- Maintenabilité : règles métier configurables et extensibles sans modification du code du solver
- Utilisabilité : interface visuelle claire, grille avec couleurs par vétérinaire

**Scale & Complexity:**

- Complexité projet : Moyenne (algorithmique complexe, périmètre UI/infra simple)
- Primary domain : Full-stack web
- Complexity level : Moyenne
- Composants architecturaux estimés : 4 (Moteur de contraintes, Modèle de données, Interface UI, Données de référence)

### Technical Constraints & Dependencies

- Pas de LLM en production — moteur algorithmique pur (CSP/optimisation)
- Stack gratuite/low-cost requise (contexte démo → MVP potentiel)
- Données de référence France 2026 : jours fériés, vacances scolaires zone par zone
- 6 utilisateurs maximum — aucun besoin de scaling
- Pas de multi-tenancy pour la démo

### Cross-Cutting Concerns Identified

- **Modélisation des contraintes** : représentation des 20+ règles métier de manière maintenable et extensible (contraintes dures vs souples)
- **Séparation moteur / interface** : le solver doit être indépendant de l'UI pour tests et réutilisabilité
- **Données de référence configurables** : jours fériés, vacances scolaires, contraintes individuelles ne doivent pas être en dur dans le code
- **Régénération partielle** : capacité à verrouiller des gardes existantes et recalculer uniquement le futur

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application — Next.js 16 sur Vercel avec Supabase comme backend.

### Starter Options Considered

| Option | Verdict |
|--------|---------|
| create-next-app (vanilla) | **Retenu** — Léger, configurable, Vercel-native |
| Next.js + shadcn dashboard starter | Trop lourd pour une démo, fonctionnalités inutiles |
| Supabase with-supabase template | Intéressant mais trop orienté auth, pas notre besoin principal |

### Selected Starter: create-next-app + shadcn/ui

**Rationale:** Starter minimal et officiel, parfaitement intégré avec l'écosystème Vercel. shadcn/ui ajouté par-dessus pour les composants UI. Pas de complexité inutile — juste les fondations pour construire le moteur et l'interface.

**Initialization Commands:**

```bash
npx create-next-app@latest vetguard --typescript --tailwind --eslint --app --src-dir --turbopack --use-npm
cd vetguard
npx shadcn@latest init
npm install @supabase/ssr @supabase/supabase-js
```

**Architectural Decisions Provided by Starter:**

- **Language & Runtime:** TypeScript 5, Node.js, React 19
- **Styling:** Tailwind CSS 4 + shadcn/ui components
- **Build Tooling:** Turbopack (dev), Next.js compiler (prod)
- **Code Organization:** App Router, src/ directory
- **Development Experience:** Hot reload, TypeScript strict mode, ESLint

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Moteur de contraintes : algorithme custom TypeScript (backtracking + heuristiques)
- Data model : Supabase PostgreSQL avec schéma relationnel
- Communication : Next.js Server Actions

**Important Decisions (Shape Architecture):**
- Frontend state : React local state + Server Components
- Composant planning : custom (grille semaine/véto avec couleurs)
- Solver en 3 phases : week-ends → vendredis → semaine

**Deferred Decisions (Post-MVP):**
- Authentification (pas nécessaire pour la démo)
- Export PDF/Excel
- Monitoring avancé
- Multi-tenancy

### Data Architecture

- **Database:** Supabase PostgreSQL (free tier)
- **Tables principales:** veterinaires, contraintes, conges, jours_feries, planning_gardes
- **Migrations:** SQL via Supabase dashboard ou fichiers .sql versionnés
- **Cache:** Non nécessaire (volume négligeable)
- **Rationale:** Supabase offre PostgreSQL managé gratuit avec API auto-générée

### Authentication & Security

- **Auth:** Différée pour la démo — outil interne mono-clinique
- **Sécurité:** Variables d'environnement pour les clés Supabase, Row Level Security activable au MVP
- **Rationale:** L'objectif démo est de prouver le moteur, pas de gérer des utilisateurs

### API & Communication Patterns

- **Pattern:** Next.js Server Actions (pas de REST API séparée)
- **Moteur côté serveur:** Le solver s'exécute en Server Action, retourne le planning au client
- **Error handling:** Try/catch standard avec messages utilisateur clairs
- **Rationale:** Server Actions éliminent la complexité d'une API séparée

### Frontend Architecture

- **State management:** React local state + Next.js Server Components
- **Component library:** shadcn/ui pour les éléments standards
- **Composant custom:** Grille de planning (semaine × véto) avec code couleur
- **Routing:** App Router — page principale (grille) + page configuration
- **Rationale:** Complexité UI faible, pas besoin de state management global

### Infrastructure & Deployment

- **Hosting:** Vercel (free tier, déploiement auto depuis GitHub)
- **CI/CD:** GitHub push → Vercel build automatique
- **Environments:** .env.local (dev) + Vercel env vars (prod)
- **Monitoring:** Vercel Analytics (gratuit)
- **Rationale:** Zero-config deployment, parfait pour une démo

### Moteur de Contraintes — Architecture

- **Approche:** Algorithme custom TypeScript (backtracking + heuristiques)
- **Contraintes dures:** Fonctions de validation retournant boolean
- **Contraintes souples:** Fonctions de scoring retournant un nombre
- **Phases de résolution:**
  1. Placement des week-ends (rotation équitable 1er/2nd)
  2. Placement des vendredis soirs (inversion 1er/2nd avec week-end)
  3. Placement des gardes semaine (lundi à jeudi)
- **Régénération:** Verrouillage des créneaux passés + re-calcul du reste
- **Rationale:** Espace de recherche gérable, custom = maintenable et testable

### Decision Impact Analysis

**Implementation Sequence:**
1. Init projet (create-next-app + shadcn + supabase)
2. Schéma de données Supabase
3. Moteur de contraintes (cœur algorithmique)
4. Interface grille de planning
5. Page de configuration (vétos, contraintes, congés)
6. Intégration complète + régénération

**Cross-Component Dependencies:**
- Le moteur de contraintes dépend du modèle de données
- L'interface grille dépend du format de sortie du solver
- La régénération dépend du verrouillage en base de données

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Database (Supabase PostgreSQL):**
- Tables : snake_case pluriel (veterinaires, planning_gardes, jours_feries, conges)
- Colonnes : snake_case (jour_repos, est_associe, semaine_paire)
- Foreign keys : {table_singulier}_id (veterinaire_id)

**Code TypeScript:**
- Fichiers : kebab-case (schedule-solver.ts, planning-grid.tsx)
- Composants React : PascalCase (PlanningGrid, VetCard, ConstraintForm)
- Fonctions/variables : camelCase (generateSchedule, vetList, isLocked)
- Types/Interfaces : PascalCase (Veterinaire, ScheduleSlot, HardConstraint)

### Structure Patterns

**Organisation par feature:**

```
src/
  app/                    # Pages Next.js (App Router)
    page.tsx              # Page principale — grille de planning
    configuration/
      page.tsx            # Page config vétos/contraintes/congés
  components/
    planning/             # Composants liés au planning
    ui/                   # Composants shadcn/ui
  lib/
    solver/               # Moteur de contraintes
    data/                 # Accès Supabase, types, helpers
    constants/            # Jours fériés, vacances scolaires
```

**Tests co-localisés:** schedule-solver.test.ts à côté de schedule-solver.ts

### Format Patterns

**Dates:**
- Base de données et solver : YYYY-MM-DD (ISO 8601, standard PostgreSQL)
- Affichage UI : DD/MM/YYYY (format français)
- Conversion uniquement à l'affichage, jamais en base

**JSON:** camelCase en TypeScript, snake_case en base (conversion auto Supabase)
**Booléens:** true/false uniquement, jamais 1/0
**Retour Server Actions:** { success: boolean, data?: T, error?: string }

### Process Patterns

**Error Handling:**
- Server Actions : try/catch → { success: false, error: "message en français" }
- UI : toast shadcn/ui pour les erreurs utilisateur
- Console : logs techniques en anglais pour le debug

**Loading States:**
- isGenerating : boolean pour la génération du planning
- Skeleton shadcn pour le chargement initial de page

### Enforcement Guidelines

**Tous les agents IA DOIVENT :**
- Suivre les conventions de nommage ci-dessus sans exception
- Placer les fichiers dans la structure définie
- Utiliser le format de retour standard pour les Server Actions
- Écrire les messages utilisateur en français
- Stocker les dates en ISO, afficher en DD/MM/YYYY

## Project Structure & Boundaries

### Complete Project Directory Structure

```
vetguard/
├── README.md
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── .env.local                    # Clés Supabase (SUPABASE_URL, SUPABASE_ANON_KEY)
├── .env.example                  # Template sans les vraies clés
├── .gitignore
├── components.json               # Config shadcn/ui
│
├── src/
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Page principale — grille de planning
│   │   └── configuration/
│   │       └── page.tsx          # Page config vétos/contraintes/congés
│   │
│   ├── components/
│   │   ├── ui/                   # Composants shadcn/ui
│   │   └── planning/
│   │       ├── planning-grid.tsx
│   │       ├── week-row.tsx
│   │       ├── guard-cell.tsx
│   │       ├── planning-toolbar.tsx
│   │       └── planning-legend.tsx
│   │
│   ├── lib/
│   │   ├── solver/
│   │   │   ├── schedule-solver.ts
│   │   │   ├── schedule-solver.test.ts
│   │   │   ├── constraints-hard.ts
│   │   │   ├── constraints-hard.test.ts
│   │   │   ├── constraints-soft.ts
│   │   │   ├── constraints-soft.test.ts
│   │   │   └── types.ts
│   │   │
│   │   ├── data/
│   │   │   ├── supabase-client.ts
│   │   │   ├── veterinaires.ts
│   │   │   ├── planning.ts
│   │   │   └── conges.ts
│   │   │
│   │   ├── constants/
│   │   │   ├── jours-feries-2026.ts
│   │   │   ├── vacances-scolaires-2026.ts
│   │   │   └── veterinaires-defaut.ts
│   │   │
│   │   ├── actions/
│   │   │   ├── generate-planning.ts
│   │   │   └── save-planning.ts
│   │   │
│   │   └── utils/
│   │       ├── date-helpers.ts
│   │       └── color-map.ts
│   │
│   └── types/
│       └── index.ts
│
└── public/
    └── favicon.ico
```

### Architectural Boundaries

**Solver ↔ UI :**
- Le solver (src/lib/solver/) ne connaît pas React ni Supabase
- Il reçoit des données typées et retourne un planning typé
- Testable indépendamment

**Données ↔ Solver :**
- src/lib/data/ fournit les données depuis Supabase
- src/lib/actions/ fait le pont : récupère données → appelle solver → sauvegarde résultat

**Serveur ↔ Client :**
- Les Server Actions (src/lib/actions/) sont le seul point de contact
- Les composants React ne parlent jamais directement à Supabase

### Requirements → Structure Mapping

| Requirement | Fichier(s) |
|------------|-----------|
| FR1-FR3 : Rotation gardes | solver/schedule-solver.ts, constraints-hard.ts |
| FR4 : Contraintes individuelles | constraints-hard.ts, constants/veterinaires-defaut.ts |
| FR5 : Cas AS paire/impaire | constraints-hard.ts, utils/date-helpers.ts |
| FR6 : Fêtes fin d'année | constraints-hard.ts |
| FR7 : Jours fériés | constants/jours-feries-2026.ts, constraints-soft.ts |
| FR8 : Congés | data/conges.ts, constraints-hard.ts |
| FR9 : Régénération | actions/generate-planning.ts, schedule-solver.ts |
| FR10 : Contraintes ponctuelles | constraints-hard.ts |

### Data Flow

```
[Page UI] → Server Action (generate-planning.ts)
                → Charge vétos + contraintes depuis Supabase
                → Appelle schedule-solver.ts
                → Retourne le planning généré
           → [Page UI] affiche la grille
           → [Bouton Sauvegarder] → Server Action (save-planning.ts) → Supabase
```

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** Toutes les technologies sont compatibles — Next.js 16 + Supabase + Vercel est un trio éprouvé. Server Actions + Supabase client communiquent sans couche intermédiaire.

**Pattern Consistency:** Conventions de nommage cohérentes entre DB (snake_case), code (camelCase/PascalCase) et fichiers (kebab-case). Formats de dates ISO en base, DD/MM/YYYY en UI.

**Structure Alignment:** La structure par feature supporte les boundaries solver/data/UI. Chaque composant architectural a son répertoire dédié.

### Requirements Coverage Validation ✅

| Requirement | Couverture architecturale | Statut |
|------------|--------------------------|--------|
| FR1-FR3 : Rotation gardes | schedule-solver.ts + constraints-hard.ts | ✅ |
| FR4 : Contraintes individuelles | constraints-hard.ts + veterinaires-defaut.ts | ✅ |
| FR5 : Cas AS paire/impaire | constraints-hard.ts + date-helpers.ts | ✅ |
| FR6 : Fêtes fin d'année | constraints-hard.ts | ✅ |
| FR7 : Jours fériés | jours-feries-2026.ts + constraints-soft.ts | ✅ |
| FR8 : Congés | data/conges.ts + constraints-hard.ts | ✅ |
| FR9 : Régénération | generate-planning.ts + solver (verrouillage) | ✅ |
| FR10 : Contraintes ponctuelles | constraints-hard.ts | ✅ |

**NFRs:** Performance ✅ (solver instantané pour 6 vétos) | Fiabilité ✅ (contraintes dures booléennes) | Maintenabilité ✅ (fichiers séparés) | Utilisabilité ✅ (grille + couleurs)

### Implementation Readiness Validation ✅

- Stack complète et versions vérifiées
- Structure projet fichier par fichier définie
- Patterns de nommage et conventions couverts
- Boundaries claires entre solver / data / UI
- Data flow documenté de bout en bout

### Gap Analysis Results

**Aucun gap critique.**

**Gaps mineurs (différés au MVP) :**
- Export PDF/Excel
- Authentification utilisateur
- Table historique pour décompte inter-annuel des fériés
- Tests E2E

### Architecture Completeness Checklist

- [x] Contexte projet analysé
- [x] Complexité évaluée
- [x] Contraintes techniques identifiées
- [x] Décisions critiques documentées avec versions
- [x] Stack technique complète
- [x] Conventions de nommage établies
- [x] Patterns de structure définis
- [x] Formats de données spécifiés
- [x] Arborescence complète définie
- [x] Boundaries établies
- [x] Mapping requirements → fichiers complet

### Architecture Readiness Assessment

**Statut global:** PRÊT POUR L'IMPLÉMENTATION
**Niveau de confiance:** ÉLEVÉ

**Forces clés:**
- Architecture simple et pragmatique — pas de sur-ingénierie
- Solver isolé et testable indépendamment
- Stack gratuite et éprouvée
- Mapping 1:1 entre requirements et fichiers

**Améliorations futures (MVP):**
- Authentification utilisateur
- Export planning (PDF/Excel)
- Table historique décompte inter-annuel fériés
- Tests E2E

### Implementation Handoff

**Tous les agents IA doivent :**
- Suivre toutes les décisions architecturales exactement comme documentées
- Utiliser les patterns d'implémentation de manière cohérente
- Respecter la structure projet et les boundaries
- Se référer à ce document pour toute question architecturale

**Première priorité d'implémentation :**
```bash
npx create-next-app@latest vetguard --typescript --tailwind --eslint --app --src-dir --turbopack --use-npm
cd vetguard
npx shadcn@latest init
npm install @supabase/ssr @supabase/supabase-js
```

## Architecture Completion Summary

**Architecture Decision Workflow:** COMPLETED ✅
**Steps:** 8/8 | **Date:** 2026-03-02

### Deliverables

- 12 décisions architecturales documentées avec versions
- 5 catégories de patterns d'implémentation
- 4 composants architecturaux (Solver, Data, UI, Constants)
- 10 requirements fonctionnels couverts à 100%

### Development Sequence

1. Initialiser le projet (create-next-app + shadcn + supabase)
2. Configurer le schéma de données Supabase
3. Implémenter le moteur de contraintes
4. Construire l'interface grille de planning
5. Créer la page de configuration
6. Intégration complète + régénération

---

**Architecture Status:** FINALISÉE ET PRÊTE POUR L'IMPLÉMENTATION ✅
