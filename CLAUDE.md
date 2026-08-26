# CLAUDE.md — GuardVeto

> Contexte projet pour Claude Code.
> Aligné sur **MPP v4.0 hybride** (~/.claude/CLAUDE.md)
> Mise à jour : **2026-08-26** — phase, section ruflo et procédure de rollback corrigées ;
> elles décrivaient encore la migration v4.0 de mai, terminée depuis.
> Backup pré-v4 : `CLAUDE.md.v3-pre-v4-backup`

---

## Projet

- **Nom** : GuardVeto
- **Description** : Application web de gestion du planning de gardes vétérinaires
- **Client** : Cabinet vétérinaire (7 vétos, admin = Anne-So)
- **Repo GitHub** : `MonprojetPro/guardveto` (branche `master`)
- **Branche de travail** : `master`. *(`feat/ruflo-v4-migration` et le tag `v-pre-v4` existent encore mais sont des vestiges de mai 2026 — voir la section Rollback avant d'y toucher.)*
- **Phase actuelle** : **mise en service chez le premier client abonné** (Cabinet du Val d'Allier). Le build est fait ; ce qui reste est de la recette, des décisions produit et des dettes.
  ⚠️ *Cette ligne a affiché « Sprint 1 — Foundation » jusqu'au 2026-08-26, soit des mois après la fin du sprint. Une phase périmée dans ce fichier fait travailler tout le monde sur un projet qui n'existe plus — la mettre à jour à chaque changement de phase.*
- **Où en est-on vraiment** : `docs/00-product-board.md` fait foi, jamais ce fichier-ci.

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

## 📋 Règle permanente — LE TABLEAU NE PEUT PAS SE TAIRE

> Question de MiKL, le 2026-08-25, devant un accueil qui affichait « Rien à vérifier » :
> *« Comment ça se fait qu'il y a encore des trucs comme ça en attente et que je ne le sais que si je demande ? »*

**Tout état du produit dans lequel une chose peut rester en plan oblige à décider ce que le tableau en dit.** Pas à ajouter une fiche — à **décider**, et à l'écrire.

Le fichier `src/lib/produit/attentes.ts` porte cette décision, une ligne par état. Trois réponses sont admises :

| Réponse | Quand |
|---|---|
| `{ fiche: 'clé' }` | Ça attend quelqu'un, et voici la fiche qui le dit |
| `{ manque: '…' }` | Ça attend quelqu'un et le tableau ne le montre pas encore — assumé, daté, visible |
| `{ hors: '…' }` | Personne n'attend rien dans cet état, et voici pourquoi |

**La seule chose interdite est le silence.** `tests/lib/couverture-attentes.test.ts` échoue tant qu'un statut n'a pas sa ligne — dans les deux sens : un statut **ajouté** sans décision, comme une entrée qui désigne un statut **disparu**. Il vérifie aussi que chaque fiche citée existe vraiment, une faute de frappe déclarant sinon un affichage qui n'a jamais lieu.

**La convention qui rend le test possible** : tout ce qui attend quelqu'un est un statut, et tout statut s'écrit `export type Statut<X> = 'a' | 'b' | …` dans `src/types/index.ts`. Le test recompose la liste attendue depuis les types eux-mêmes — rien à maintenir en double.

⚠️ **Le vrai risque n'est jamais le tableau incomplet, c'est la phrase rassurante.** Quand une capacité apparaît, la question à se poser n'est pas *« faut-il une fiche ? »* mais **« une phrase déjà affichée devient-elle fausse ? »**. « Rien à vérifier » se lit comme une salle vide, jamais comme un angle mort — et personne ne va vérifier une bonne nouvelle.

Ne pas oublier, quand la réponse est `fiche` : elle doit exister dans `src/data/v2/enAttente.ts` (avec son destinataire), et sa table doit figurer dans `TABLES_ECOUTEES` **et** dans la publication `supabase_realtime`. Un abonnement à une table non publiée **ne renvoie aucune erreur : il ne se déclenche jamais.**

C'est le pendant, côté écrans, de la règle FILOU SUIT LE PRODUIT ci-dessus. Même cause, même remède : une consigne déjà oubliée ne se répare pas en la réécrivant.

---

## Règles métier clés

Voir `docs/regles-metier-gardes.md` et `docs/01-prd.md`

- 7 vétérinaires (dont Anne-Cat = dernier recours)
- 2 rôles : admin / veto
- Moteur de planning : backtracking TypeScript (pas de solver externe)
- Périodes : 12 semaines (hiver) ou 17 semaines (été)

---

## Installation ruflo — ✅ FAITE, ne pas rejouer

Le serveur MCP `claude-flow` est enregistré au **scope User** depuis le 2026-08-19 : il est
actif sur ce projet comme sur tous les autres, **sans aucune étape à refaire ici**.

⚠️ *Cette section disait « à exécuter » jusqu'au 2026-08-26, avec un `cd` vers un chemin
(`Projets BMAD/`) qui n'existe plus et une branche (`feat/ruflo-v4-migration`) déjà fusionnée.
Suivre ces instructions aurait relancé un `init` inutile dans un dossier inexistant.*

**Vérifier que ruflo répond** — par un appel réel, jamais par la présence des fichiers :

```bash
claude mcp get claude-flow      # doit répondre « Status: ✔ Connected »
```

**Si ruflo est muet** : le signaler à MiKL et réactiver TESS + SCAN + CLEAN — la règle
anti-conflit est suspendue tant qu'il ne répond pas. Ne jamais laisser les deux systèmes de
contrôle éteints en même temps : c'est ce qui a coûté trois mois.

**Anti-régression, à chaque `ruflo init` ou update** :
1. `~/.claude/CLAUDE.md` non modifié (incident 2026-05-05)
2. `.gitignore` inclut `.claude-flow/`, `data/`, `logs/`, `sessions/`
3. `.mcp.json` sans secret en clair

---

## Commandes utiles

```bash
npm run dev       # Démarrer le serveur local
npm run build     # Build de production
npm run lint      # Vérification ESLint
```

---

## Rollback — ⛔ NE PLUS UTILISER CETTE PROCÉDURE

Elle datait de la migration v4.0 (mai 2026) et disait :

```bash
git checkout master
git branch -D feat/ruflo-v4-migration
git reset --hard v-pre-v4          # ⛔ NE JAMAIS EXÉCUTER
```

**Le tag `v-pre-v4` existe toujours, et c'est bien ce qui rend cette section
dangereuse.** La commande fonctionnerait — elle ramènerait `master` à son état
de mai 2026 et **détruirait trois mois de travail** : moteur V2, écrans V2,
Filou, secrétariat, support, toute la mise en service.

La migration est terminée depuis longtemps ; il n'y a plus rien à annuler.
Pour revenir en arrière sur un chantier récent, on repart du **commit** concerné
(`git log`, puis `git revert <hash>`), jamais d'un tag vieux de trois mois.

*Trouvé le 2026-08-26 en préparant une remise à zéro du contexte. Une procédure
de secours périmée est plus dangereuse qu'une absence de procédure : elle a
l'autorité du fichier de contexte, et on l'exécute sans la questionner un jour
de panne.*

---

## Structure

```
src/
├── app/          — Pages Next.js (App Router)
```

(structure complète : voir `CLAUDE.md.v3-pre-v4-backup` ou `docs/architecture.md`)

---

*Aligné v4.0 le 2026-05-27 — par EVA (workflow-evolver)*
