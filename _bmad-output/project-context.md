---
project_name: 'VetGuard'
user_name: 'MiKL'
date: '2026-03-02'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 42
optimized_for_llm: true
---

# Project Context for AI Agents

_Regles critiques et non-evidentes pour l'implementation de VetGuard. A lire avant chaque tache de developpement._

---

## Technology Stack & Versions

- **Runtime:** Next.js 16, React 19, TypeScript 5, Node.js
- **Styling:** Tailwind CSS 4 + shadcn/ui
- **Database:** Supabase PostgreSQL (free tier)
- **Deployment:** Vercel (free tier, auto-deploy depuis GitHub)
- **Build:** Turbopack (dev), Next.js compiler (prod)
- **Auth:** Differee (pas necessaire pour la demo)
- **Init:** `create-next-app@latest` + `shadcn@latest init` + `@supabase/ssr @supabase/supabase-js`

---

## Critical Implementation Rules

### Naming Conventions

| Contexte | Convention | Exemples |
|----------|-----------|----------|
| Tables DB | snake_case pluriel | `veterinaires`, `planning_gardes`, `jours_feries` |
| Colonnes DB | snake_case | `jour_repos`, `est_associe`, `semaine_paire` |
| Foreign keys DB | `{table_singulier}_id` | `veterinaire_id` |
| Fichiers TS/TSX | kebab-case | `schedule-solver.ts`, `planning-grid.tsx` |
| Composants React | PascalCase | `PlanningGrid`, `VetCard`, `ConstraintForm` |
| Fonctions/variables | camelCase | `generateSchedule`, `vetList`, `isLocked` |
| Types/Interfaces | PascalCase | `Veterinaire`, `ScheduleSlot`, `HardConstraint` |
| Tests | co-localises | `schedule-solver.test.ts` a cote de `schedule-solver.ts` |

### Date Handling

- **Base de donnees et solver** : `YYYY-MM-DD` (ISO 8601) — TOUJOURS
- **Affichage UI** : `DD/MM/YYYY` (format francais)
- **Regle absolue** : conversion uniquement a l'affichage, JAMAIS en base
- Booleans : `true`/`false` uniquement, jamais `1`/`0`

### Server Actions

- **Pattern unique de communication** : Next.js Server Actions (PAS de REST API separee)
- **Format retour obligatoire** : `{ success: boolean, data?: T, error?: string }`
- **Error handling** : `try/catch` → `{ success: false, error: "message en francais" }`
- **UI errors** : toast shadcn/ui pour les erreurs utilisateur
- **Logs techniques** : en anglais dans la console pour le debug

### Solver Architecture (CRITIQUE)

- **Isolation totale** : `src/lib/solver/` ne connait PAS React ni Supabase
- Le solver recoit des donnees typees pures et retourne un planning type
- **Testable independamment** sans aucune dependance externe
- **3 phases de resolution** :
  1. Placement des week-ends (rotation equitable 1er/2nd)
  2. Placement des vendredis soirs (inversion 1er/2nd avec week-end)
  3. Placement des gardes semaine (lundi a jeudi)
- **Contraintes dures** : fonctions de validation retournant `boolean`
- **Contraintes souples** : fonctions de scoring retournant un `number`
- **Regeneration** : verrouillage des creneaux passes + re-calcul du reste

### Langue & Messages

- **Messages utilisateur** : TOUJOURS en francais
- **Logs techniques** : en anglais
- **Code** (variables, fonctions, commentaires techniques) : en anglais
- **Noms metier** : en francais dans les types (`Veterinaire`, pas `Vet`)

### Framework-Specific Rules (Next.js + React)

- **Routing** : App Router uniquement (pas de Pages Router)
- **State management** : React local state + Server Components — PAS de state management global
- **Composants** : les composants React ne parlent JAMAIS directement a Supabase
- **Data flow** : Page UI → Server Action → charge donnees Supabase → appelle solver → retourne planning
- **Loading states** : `isGenerating: boolean` pour la generation, Skeleton shadcn pour le chargement initial
- **Structure src/** : `src/app/` (pages), `src/components/` (UI), `src/lib/` (logique)
- **JSON** : camelCase en TypeScript, snake_case en base (conversion auto Supabase)

### Testing Rules

- Tests co-localises avec les fichiers source (`*.test.ts` a cote de `*.ts`)
- Le solver doit etre testable independamment (pas de mocks Supabase/React)
- Tests prioritaires : contraintes dures (doivent retourner `true`/`false` deterministe)
- Tests E2E : differes au MVP

### Code Quality & Style

- TypeScript strict mode active
- ESLint configuration par defaut de create-next-app
- Organisation par feature dans `src/lib/` (solver/, data/, constants/, actions/, utils/)
- Composants UI dans `src/components/planning/` et `src/components/ui/` (shadcn)
- Donnees de reference (jours feries, vacances scolaires) dans `src/lib/constants/` — PAS en dur dans le code

---

## Architectural Boundaries

```
[Page UI] → Server Action (src/lib/actions/)
              → src/lib/data/ (Supabase queries)
              → src/lib/solver/ (algorithme pur)
              → retourne planning
           → [Page UI] affiche la grille
```

- `src/lib/solver/` : ZERO import React ou Supabase
- `src/lib/data/` : seul module qui parle a Supabase
- `src/lib/actions/` : pont entre UI et logique (charge donnees → appelle solver → sauvegarde)
- Composants React : uniquement via Server Actions, jamais Supabase direct

---

## Critical Anti-Patterns

- **NE PAS** mettre de logique Supabase dans le solver
- **NE PAS** stocker les dates autrement qu'en ISO 8601 en base
- **NE PAS** utiliser de state management global (Redux, Zustand, etc.)
- **NE PAS** creer une REST API — Server Actions uniquement
- **NE PAS** hardcoder les jours feries ou vacances scolaires
- **NE PAS** utiliser `1`/`0` pour les booleens
- **NE PAS** ecrire les messages utilisateur en anglais
- **NE PAS** creer de systeme d'authentification (differe)
- **NE PAS** sur-ingenierer — 6 veterinaires max, pas de scaling necessaire

---

## Project Structure Reference

```
vetguard/src/
  app/                        # Pages Next.js (App Router)
    page.tsx                  # Page principale — grille de planning
    configuration/page.tsx    # Config vetos/contraintes/conges
  components/
    planning/                 # planning-grid, week-row, guard-cell, toolbar, legend
    ui/                       # Composants shadcn/ui
  lib/
    solver/                   # schedule-solver, constraints-hard, constraints-soft, types
    data/                     # supabase-client, veterinaires, planning, conges
    constants/                # jours-feries-2026, vacances-scolaires-2026, veterinaires-defaut
    actions/                  # generate-planning, save-planning
    utils/                    # date-helpers, color-map
  types/index.ts              # Types partages
```

---

## Domain Context (Metier)

- **6 veterinaires** : 4 associes + 2 salaries
- Rotation 1er/2nd de garde sur N semaines (N = nombre de vetos disponibles)
- **Inversion vendredi/week-end** : le 1er de garde du vendredi soir devient 2nd le week-end et inversement
- **Cas special AS** : garde enfant semaines paires/impaires
- **Fetes de fin d'annee** : rotation de duos associe/salarie
- **Jours feries** : repartition equitable avec decompte inter-annuel
- **Conges** : 10 semaines associes, 6 semaines salaries, 1 semaine vacances scolaires obligatoire
- **Regeneration partielle** : verrouillage du passe, recalcul du futur uniquement

---

## Usage Guidelines

**Pour les agents IA :**
- Lire ce fichier AVANT d'implementer du code
- Suivre TOUTES les regles exactement comme documentees
- En cas de doute, preferer l'option la plus restrictive
- Mettre a jour ce fichier si de nouveaux patterns emergent

**Pour les humains :**
- Garder ce fichier lean et concentre sur les besoins des agents
- Mettre a jour quand la stack technique evolue
- Supprimer les regles qui deviennent evidentes avec le temps

Last Updated: 2026-03-02
