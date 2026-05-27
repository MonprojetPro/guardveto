# CLAUDE.md — GuardVeto

> Contexte projet pour Claude Code.
> Aligné sur **MPP v4.0 hybride** (~/.claude/CLAUDE.md)
> Mise à jour : 2026-05-27 (migration v4.0 — branche `feat/ruflo-v4-migration`)
> Backup pré-v4 : `CLAUDE.md.v3-pre-v4-backup`

---

## Projet

- **Nom** : GuardVeto
- **Description** : Application web de gestion du planning de gardes vétérinaires
- **Client** : Cabinet vétérinaire (7 vétos, admin = Anne-So)
- **Repo GitHub** : `MonprojetPro/guardveto` (branche `master`)
- **Branche migration v4.0** : `feat/ruflo-v4-migration` (tag rollback : `v-pre-v4`)
- **Phase actuelle** : Sprint 1 — Foundation (TECH-001, TECH-002, STORY-001 à 003)

## Stack

- **Framework** : Next.js 16 (App Router) + TypeScript strict
- **Style** : Tailwind CSS 4 + shadcn/ui
- **BDD** : Supabase (PostgreSQL + Auth + RLS)
- **Déploiement** : Vercel
- **Tests** : ruflo testing (Playwright intégré)
- **Polices** : Figtree (titres) + Noto Sans (corps)

---

## Mode v4.0 hybride MPP + Ruflo

### Répartition active

| Domaine | Moteur |
|---|---|
| Code (auth, gestion congés, RLS, RPC) | 🟦 **RUFLO** (à installer) |
| Tests, code review, refacto, debug | 🟦 **RUFLO** (TILT MPP imposé sur auth) |
| Sécurité (auth + RLS — CRITIQUE) | 🟦 **RUFLO** + supervision ARCH |
| Stratégie produit, fonctionnalités | 🟧 **REX + OTTO** (MPP) |
| UX/UI design | 🟧 **PIXEL** (MPP) |
| Copywriting (notifications, raisons refus, emails) | 🟧 **NORA** (MPP) |
| Documentation client vétérinaires | 🟧 **DOC** (MPP) |
| Mémoire métier (incidents auth) | 🟧 **MEMO + ATLAS** (MPP) |
| Orchestration | 🟧 **MAX** dispatche |

### Règles renforcées sur ce projet — Auth + RLS

⚠️ Ce projet manipule auth et RLS Supabase. Règles MPP universelles **critiques** :

- **TILT** : 1 fix échoué sur auth = TILT immédiat (cf. règle globale)
- **INSPECTION CONSUMERS** : sur toute modification des tables `conges`, `veterinaires`, `auth`
- Tests d'auth E2E obligatoires avant tout merge sur master
- Pas de modification des policies RLS sans review explicite

---

## Règles métier clés

Voir `docs/regles-metier-gardes.md` et `docs/01-prd.md`

- 7 vétérinaires (dont Anne-Cat = dernier recours)
- 3 rôles : admin / veto / secretaire
- Moteur de planning : backtracking TypeScript (pas de solver externe)
- Périodes : 12 semaines (hiver) ou 17 semaines (été)

---

## Installation ruflo — à exécuter

Sur cette branche `feat/ruflo-v4-migration` :

```bash
cd "C:/Users/Mikaculus/Desktop/Projets BMAD/GuardVeto"
npx -y ruflo@latest init --hybrid --with-embeddings --no-global
```

**Vérifications post-install OBLIGATOIRES** :
1. ✅ `~/.claude/CLAUDE.md` non modifié (incident 2026-05-05)
2. ✅ `.gitignore` inclut `.claude-flow/`, `data/`, `logs/`, `sessions/`
3. ✅ `.mcp.json` créé sans secrets en clair

---

## Commandes utiles

```bash
npm run dev       # Démarrer le serveur local
npm run build     # Build de production
npm run lint      # Vérification ESLint
```

---

## Rollback

```bash
git checkout master
git branch -D feat/ruflo-v4-migration
# Si ruflo a touché : git reset --hard v-pre-v4
```

---

## Structure

```
src/
├── app/          — Pages Next.js (App Router)
```

(structure complète : voir `CLAUDE.md.v3-pre-v4-backup` ou `docs/architecture.md`)

---

*Aligné v4.0 le 2026-05-27 — par EVA (workflow-evolver)*
