# [TECH-001] Setup projet Next.js + Supabase + Vercel

## Epic
E1 — Foundation

## Story
En tant que développeur, je veux un projet Next.js 15 configuré avec Supabase, Tailwind, shadcn/ui et déployé sur Vercel afin de pouvoir commencer le développement.

## Critères d'acceptation
- [ ] Projet Next.js 15 (App Router) initialisé en TypeScript strict
- [ ] Tailwind CSS configuré avec la palette GuardVeto (couleurs custom)
- [ ] shadcn/ui installé avec les composants de base (Button, Card, Dialog, Form, Badge, Tooltip, Sidebar, Sonner)
- [ ] Polices Figtree + Noto Sans importées depuis Google Fonts
- [ ] Supabase client configuré (client navigateur + client serveur)
- [ ] Variables d'environnement dans .env.local + .env.example
- [ ] .gitignore en place (avant tout autre fichier)
- [ ] Repo Git initialisé + premier commit
- [ ] Déploiement Vercel fonctionnel (page d'accueil visible)
- [ ] date-fns installé
- [ ] Lucide React installé

## Tâches techniques
- [ ] `npx create-next-app@latest guardveto --typescript --tailwind --app --src-dir`
- [ ] Configurer `tailwind.config.ts` avec les couleurs custom (primaire #0891B2, CTA #059669, etc.) + couleurs par véto
- [ ] `npx shadcn@latest init` + installer les composants listés
- [ ] Configurer les polices dans `src/app/layout.tsx`
- [ ] Créer `src/lib/supabase/client.ts` et `src/lib/supabase/server.ts`
- [ ] Créer `.env.local` avec `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Créer `.env.example` (valeurs vides)
- [ ] Créer le repo GitHub + déployer sur Vercel
- [ ] Créer la structure de dossiers (src/engine/, src/components/, src/hooks/)

## Estimation
- Taille : M
- Points : 3
- Durée estimée : 2-3h

## Dépendances
- Requiert : rien (première story)
- Débloque : TECH-002, toutes les stories suivantes

## Agent exécutant
- Dev : SPARK (setup)
