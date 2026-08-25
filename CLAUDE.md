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

> ✅ **Ruflo RACCORDÉ le 2026-08-19** — serveur MCP `claude-flow` enregistré au scope **User** (actif dans tous les projets, présents et futurs). Vérifier : `claude mcp get claude-flow` → `Status: ✔ Connected`.
>
> 🚨 **Une délégation à ruflo n'est réelle que si un outil `mcp__claude-flow__*` a été appelé.** De mai à août 2026, `ruflo init` avait bien été lancé mais le serveur MCP n'avait **jamais** été enregistré : les fichiers étaient présents (et gitignorés, donc invisibles en `git status`), les hooks tournaient, mais **aucun outil ruflo n'était appelable**. Conséquence : les contrôles délégués à ruflo (tests, code review, sécurité, INSPECTION CONSUMERS) n'étaient exécutés par personne, les skills MPP équivalents étant éteints par la règle anti-conflit v4.0. Détail complet : `~/.claude/CLAUDE.md`.
>
> ⚠️ **Sensible sur ce projet** : auth + RLS sont critiques. Le TILT et l'audit CERBÈRE s'appliquent d'autant plus que ces contrôles n'ont pas tourné depuis mai.

### Répartition active

| Domaine | Moteur |
|---|---|
| Code (auth, gestion congés, RLS, RPC) | 🟦 **RUFLO** ✅ raccordé |
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

## 🦊 Règle permanente — FILOU SUIT LE PRODUIT, sans exception

> Exigence de MiKL, le 2026-08-25 : *« dès qu'une fonctionnalité est ajoutée ou retirée, quoi que ce soit qui concerne Filou, je veux qu'il soit automatiquement configuré pour. Ça devrait déjà être le cas depuis le début, et je m'aperçois que non. »*

**Toute capacité ajoutée ou retirée du produit oblige à décider ce que Filou en fait.** Pas à lui donner un outil — à **décider**, et à l'écrire.

Le fichier `src/lib/ia/couverture-produit.ts` porte cette décision, une ligne par action serveur. Trois réponses sont admises :

| Réponse | Quand |
|---|---|
| `{ outil: 'nom' }` | Filou sait le faire, voici l'outil |
| `{ manque: '…' }` | Il ne le couvre pas encore — assumé, daté, visible |
| `{ hors: '…' }` | Hors de son périmètre, et voici pourquoi |

**La seule chose interdite est le silence.** `tests/lib/filou-couverture-produit.test.ts` échoue tant qu'une action n'a pas sa ligne — dans les deux sens : une action **ajoutée** sans décision, comme une entrée qui désigne une action **disparue**. Il vérifie aussi que chaque outil cité existe vraiment : une faute de frappe déclarerait une couverture inexistante et donnerait exactement la fausse assurance qu'il doit empêcher.

**Pourquoi un test et pas une consigne** : « penser à mettre Filou à jour » était déjà la consigne, et elle a été oubliée depuis le début. Le secrétariat et l'assistance ont été livrés un matin ; Filou ne l'a su que le soir, sur demande de MiKL. Et le symptôme n'était pas « il ne sait pas faire » — à *« qui a accès au planning ? »*, il répondait la liste des vétérinaires, **sans le secrétariat et sans que rien ne signale l'absence**.

⚠️ **Le vrai risque n'est jamais le catalogue incomplet, c'est la réponse incomplète présentée comme complète.** Quand une capacité apparaît, la question à se poser n'est pas *« faut-il un outil ? »* mais **« une question existante reçoit-elle désormais une réponse fausse ? »**.

Ne pas oublier, quand la réponse est `outil` : le **prompt système** (`agentFilou.ts`) doit dire QUAND l'appeler, et `outils/sources.ts` doit porter son libellé lisible — un outil sans libellé fait échouer `sources.test.ts`.

---

## Règles métier clés

Voir `docs/regles-metier-gardes.md` et `docs/01-prd.md`

- 7 vétérinaires (dont Anne-Cat = dernier recours)
- 2 rôles : admin / veto
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
