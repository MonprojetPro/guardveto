# CLAUDE.md — GuardVeto

> Contexte projet pour Claude Code.
> Global : voir ~/.claude/CLAUDE.md

## Projet

**Nom** : GuardVeto
**Description** : Application web de gestion du planning de gardes vétérinaires
**Client** : Cabinet vétérinaire (7 vétos, admin = Anne-So)
**Phase actuelle** : Sprint 1 — Foundation (TECH-001, TECH-002, STORY-001 à 003)

## Stack

- **Framework** : Next.js 16 (App Router) + TypeScript strict
- **Style** : Tailwind CSS 4 + shadcn/ui
- **BDD** : Supabase (PostgreSQL + Auth + RLS)
- **Déploiement** : Vercel
- **Tests** : Playwright (TESS)
- **Polices** : Figtree (titres) + Noto Sans (corps)

## Agents principaux

- **SPARK** — développement
- **TESS** — tests Playwright
- **SCAN** — code review
- **ATLAS** — capitalisation leçons

## Règles métier clés

Voir `docs/regles-metier-gardes.md` et `docs/01-prd.md`

- 7 vétérinaires (dont Anne-Cat = dernier recours)
- 3 rôles : admin / veto / secretaire
- Moteur de planning : backtracking TypeScript (pas de solver externe)
- Périodes : 12 semaines (hiver) ou 17 semaines (été)

## Commandes utiles

```bash
npm run dev       # Démarrer le serveur local
npm run build     # Build de production
npm run lint      # Vérification ESLint
```

## Structure

```
src/
├── app/          — Pages Next.js (App Router)
├── components/
│   ├── layout/   — Header, Sidebar, RoleGate
│   └── ui/       — shadcn/ui components
├── engine/       — Moteur de génération du planning
├── hooks/        — Hooks React (useAuth, etc.)
├── lib/
│   └── supabase/ — client.ts + server.ts
└── types/        — Types TypeScript partagés
supabase/
└── migrations/   — SQL versionnées
tests/            — Tests Playwright (TESS)
docs/             — Documentation projet (PRD, archi, UX, stories)
```

## Supabase

Ref projet : mpvrokmtwqlmhvxaaxdn
URL : récupérée dans .env.local

## Variables d'environnement requises

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```
