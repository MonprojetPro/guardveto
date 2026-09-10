# Chantier 1 — Modules activables par cabinet · Plan d'implémentation

> **Pour les agents d'exécution :** SOUS-SKILL REQUIS — `superpowers:subagent-driven-development`
> (recommandé) ou `superpowers:executing-plans`. Les étapes utilisent des cases à cocher
> (`- [ ]`) pour le suivi.

**Objectif :** permettre d'allumer et d'éteindre, cabinet par cabinet, les grands pans du
produit (`gardes`, `planning-journee`, `chat`) — de sorte qu'un module éteint soit invisible à
l'écran **et refusé au serveur**.

**Architecture :** une colonne `modules_actifs` sur `cabinets` porte l'état. Un **catalogue en
code** (`src/lib/produit/modules.ts`) déclare les modules existants et l'appartenance de chaque
écran. Un **test-gardien** refuse le silence : tout écran V2 qui n'a pas déclaré son module fait
échouer la suite. Une garde serveur `exigerModule()` s'ajoute aux actions concernées.

**Pile technique :** Next.js 16 (App Router), TypeScript strict, Supabase (PostgreSQL + RLS),
Vitest (unitaires), Playwright (e2e).

**Cadrage d'origine :** `docs/cadrage-v3-2026-09-10.md` · **Board :** B-120.

---

## AVANT DE CODER — KIT COMPLET, à cocher par MiKL

Règle KIT COMPLET : un interrupteur de module n'est pas une case à cocher, c'est l'interface
d'un système de droits. Voici tout ce que le pattern implique. **MiKL coche ce qu'il garde.**

| Élément | Statut actuel | Décision |
|---|---|---|
| Stockage de l'état (quels modules pour ce cabinet) | À coder | Inclure ? |
| Catalogue des modules en code + test qui refuse un module inconnu | À coder | Inclure ? |
| Lecture serveur de l'état (`modulesDuCabinet`) | À coder | Inclure ? |
| **Refus côté serveur** d'une action d'un module éteint | À coder | Inclure ? (⚠️ sinon la porte reste ouverte par l'URL) |
| Appartenance de chaque écran à un module + test-gardien du silence | À coder | Inclure ? |
| Masquage des entrées de navigation d'un module éteint | À coder | Inclure ? |
| Écran d'administration MPP pour allumer/éteindre | À coder | Inclure ? |
| Message honnête quand on atterrit sur un écran éteint (plutôt qu'une page blanche ou un 404) | À coder | Inclure ? |
| Filou : un module éteint sort de son périmètre | À coder | Inclure ? |
| Tableau d'accueil : pas de fiche d'attente d'un module éteint | Rien à faire au chantier 1 (aucun statut nouveau) | Reporter aux chantiers 3 et 5 |
| Journal de qui a allumé/éteint quoi et quand | Optionnel | Reporter ? |
| Notification à l'admin du cabinet quand un module change | Optionnel | Reporter ? |

**Hypothèse par défaut si MiKL ne décoche rien** : tout ce qui est marqué « Inclure ? » est
inclus ; les deux « Reporter ? » sont reportés.

---

## AVANT DE CODER — INSPECTION DES CONSUMERS

Entité touchée : **`cabinets`** (ajout de `modules_actifs`).

| Lecteur de `cabinets` | Où | Mode de rafraîchissement | Branché Realtime ? | Action |
|---|---|---|---|---|
| `resoudreCabinetId()` | `src/lib/supabase/cabinet.ts` | Appelé à chaque action serveur | Sans objet (lecture ponctuelle) | RAS — il ne lit pas la nouvelle colonne |
| Barre de navigation V2 | `src/components/v2/BarreV2.tsx` | Rendue depuis le layout, donc à chaque navigation serveur | ❌ Non | Lit `modules_actifs` ; un changement se voit à la navigation suivante |
| Layout V2 | `src/app/(v2)/layout.tsx` | Server Component | ❌ Non | Point d'injection de l'état des modules |
| Écrans V2 (9 routes) | `src/app/(v2)/*` | Server Components | ❌ Non | Chacun déclare son module (Tâche 5) |

**Décision de rafraîchissement, à valider par MiKL** : **pas de Realtime sur `modules_actifs`**.
Un module s'allume une fois par cabinet, par MiKL, pas par l'utilisateur — un rechargement de
page suffit. Brancher du Realtime ici ajouterait un abonnement de plus à surveiller pour un
événement qui arrive une fois par an.

⚠️ **Contre-mesure obligatoire** : parce qu'il n'y a pas de Realtime, un utilisateur déjà
connecté peut avoir une navigation périmée en mémoire. **C'est exactement pourquoi la Tâche 4
(refus serveur) n'est pas optionnelle** : c'est le serveur, pas l'écran, qui fait autorité.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `supabase/migrations/20260910120000_modules_par_cabinet.sql` | La colonne, sa valeur par défaut, sa contrainte |
| `src/lib/produit/modules.ts` | Le catalogue des modules et l'appartenance des écrans. **Une seule source.** |
| `src/lib/produit/modules-serveur.ts` | Lecture (`modulesDuCabinet`) et garde (`exigerModule`). Séparé du catalogue car il touche Supabase. |
| `tests/lib/couverture-modules.test.ts` | Le gardien : aucun écran ne peut se taire |
| `tests/lib/modules-serveur.test.ts` | Le refus serveur fait bien ce qu'il dit |
| `src/components/v2/BarreV2.tsx` | Modifié : masque les entrées éteintes |
| `src/app/(v2)/layout.tsx` | Modifié : résout les modules une fois et les descend |
| `src/app/(v2)/reglages/modules/page.tsx` + `actions.ts` | L'écran d'administration |

**Pourquoi deux fichiers pour les modules** : le catalogue doit être lisible par un test qui
n'ouvre aucune connexion réseau (comme `couverture-attentes.test.ts` et
`filou-couverture-produit.test.ts` le font déjà). Mélanger Supabase dedans rendrait le gardien
impossible à écrire simplement.

---

## Tâche 1 : la colonne `modules_actifs`

**Fichiers :**
- Créer : `supabase/migrations/20260910120000_modules_par_cabinet.sql`

- [ ] **Étape 1 : écrire la migration**

```sql
-- ============================================================
-- GUARDVETO — B-120 chantier 1 : modules activables par cabinet
-- ============================================================
-- Decision ① de MiKL (09/09) : un seul produit, des modules qu'on allume
-- cabinet par cabinet. Cette colonne est aussi le ROBINET DE ROLLOUT de la
-- V3 (decision ⑨) : le planning journee reste eteint partout sauf sur le
-- bac a sable, et la bascule chez Val d'Allier sera un reglage, pas un
-- deploiement.
--
-- Valeur par defaut 'gardes' : tout cabinet existant garde EXACTEMENT ce
-- qu'il avait. Aucune migration de donnees, aucun changement visible.
-- ============================================================

ALTER TABLE cabinets
  ADD COLUMN IF NOT EXISTS modules_actifs TEXT[] NOT NULL DEFAULT ARRAY['gardes'];

COMMENT ON COLUMN cabinets.modules_actifs IS
  'Modules allumes pour ce cabinet. Catalogue de reference : src/lib/produit/modules.ts';

-- Un cabinet sans aucun module serait un compte muet : on l'interdit.
ALTER TABLE cabinets
  ADD CONSTRAINT cabinets_modules_actifs_non_vide
  CHECK (array_length(modules_actifs, 1) >= 1);
```

- [ ] **Étape 2 : appliquer la migration sur le projet Supabase**

⚠️ **Vérifier le `project_ref` avant d'écrire** — leçon maison : ne jamais appliquer une
migration sans avoir confirmé sur quel projet on est.

Utiliser l'outil MCP `mcp__supabase__apply_migration` avec le contenu ci-dessus.

- [ ] **Étape 3 : prouver que la colonne existe et que les cabinets sont intacts**

```sql
SELECT nom, modules_actifs FROM cabinets ORDER BY nom;
```

Attendu : une ligne par cabinet, chacune avec `{gardes}`. **Aucun cabinet à `{}`.**

- [ ] **Étape 4 : commit**

```bash
git add supabase/migrations/20260910120000_modules_par_cabinet.sql
git commit -m "[feat][B-120] Les cabinets portent la liste de leurs modules, par defaut les gardes seules"
```

---

## Tâche 2 : le catalogue des modules

**Fichiers :**
- Créer : `src/lib/produit/modules.ts`
- Test : `tests/lib/couverture-modules.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// tests/lib/couverture-modules.test.ts
import { describe, expect, it } from 'vitest'
import { MODULES, MODULE_SOCLE } from '@/lib/produit/modules'

describe('Le catalogue des modules', () => {
  it('déclare les trois modules de la V3', () => {
    expect(Object.keys(MODULES).sort()).toEqual(['chat', 'gardes', 'planning-journee'])
  })

  it('donne à chaque module un nom lisible et une phrase qui dit ce qu’il fait', () => {
    for (const [id, m] of Object.entries(MODULES)) {
      expect(m.nom, `${id} n’a pas de nom lisible`).toBeTruthy()
      expect(m.description, `${id} n’a pas de description`).toBeTruthy()
    }
  })

  it('désigne les gardes comme le module socle, celui qu’on ne peut pas éteindre', () => {
    expect(MODULE_SOCLE).toBe('gardes')
    expect(MODULES[MODULE_SOCLE].eteignable).toBe(false)
  })
})
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

Commande : `npx vitest run tests/lib/couverture-modules.test.ts`
Attendu : ÉCHEC — `Cannot find module '@/lib/produit/modules'`

- [ ] **Étape 3 : écrire le catalogue**

```ts
// src/lib/produit/modules.ts
// ============================================================
// GUARDVETO — Les modules du produit, et qui a le droit de les voir
// ============================================================
// POURQUOI CE FICHIER EXISTE — decision ① de MiKL, le 2026-09-09 :
//
//   « Il faudra qu'ils aient la possibilite d'activer les modules comme ils
//    veulent. Peut-etre que certains cabinets voudront juste les gardes soir
//    et week-end, d'autres que le planning jour, et d'autres les 2. »
//
// Il porte AUSSI le rollout de la V3 (decision ⑨) : le planning journee reste
// eteint partout sauf sur le bac a sable. La bascule chez le premier client
// sera un reglage — reversible en une seconde — et pas un deploiement.
//
// ── CE QUE CE FICHIER FORCE ─────────────────────────────────────────────────
//
// Meme mecanique que `ia/couverture-produit.ts` (Filou) et `produit/attentes.ts`
// (le tableau) : il ne force pas une reponse, il force UNE DECISION. Chaque
// ecran de la V2 declare a quel module il appartient, ou dit pourquoi il n'en
// depend d'aucun. La seule chose interdite est le silence — un ecran ajoute
// sans decision fait echouer `tests/lib/couverture-modules.test.ts`.
//
// ⚠️ CE QUE CE FICHIER NE FAIT PAS : il ne garde aucune porte. Cacher une
//    entree de menu n'a jamais ferme une URL. Le refus est dans
//    `modules-serveur.ts`, et c'est LUI qui fait autorite.
// ============================================================

/** Un module du produit, tel qu'on l'allume ou l'eteint pour un cabinet. */
export interface Module {
  /** Le nom que MiKL lit dans l'ecran d'administration. */
  nom: string
  /** Ce que le cabinet perd s'il est eteint. Une phrase, pas un paragraphe. */
  description: string
  /** `false` pour le socle : l'eteindre laisserait un compte muet. */
  eteignable: boolean
}

/** Le module sans lequel GuardVeto n'est plus GuardVeto. */
export const MODULE_SOCLE = 'gardes' as const

export const MODULES: Record<string, Module> = {
  gardes: {
    nom: 'Gardes du soir et du week-end',
    description:
      'Le cœur historique : generation, publication et suivi du planning de gardes.',
    eteignable: false,
  },
  'planning-journee': {
    nom: 'Planning de la journee',
    description:
      'Qui est present en journee, par trames recurrentes et retouches a la main.',
    eteignable: true,
  },
  chat: {
    nom: 'Messagerie de l’equipe',
    description:
      'Le fil de discussion entre veterinaires, et les annonces de l’administratrice.',
    eteignable: true,
  },
}

/** Les identifiants de modules connus. Toute autre valeur est une faute de frappe. */
export type IdModule = keyof typeof MODULES
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

Commande : `npx vitest run tests/lib/couverture-modules.test.ts`
Attendu : PASS — 3 tests

- [ ] **Étape 5 : commit**

```bash
git add src/lib/produit/modules.ts tests/lib/couverture-modules.test.ts
git commit -m "[feat][B-120] Le catalogue des modules existe, et les gardes n'y sont pas eteignables"
```

---

## Tâche 3 : l'appartenance des écrans, et le gardien du silence

C'est le cœur du chantier. Sans lui, chaque écran ajouté dans six mois échappera au dispositif —
exactement le défaut que `couverture-produit.ts` a été écrit pour empêcher.

**Fichiers :**
- Modifier : `src/lib/produit/modules.ts` (ajout en fin de fichier)
- Modifier : `tests/lib/couverture-modules.test.ts` (ajout)

- [ ] **Étape 1 : écrire le test qui échoue**

Ajouter à la fin de `tests/lib/couverture-modules.test.ts`. ⚠️ **`MODULES` est déjà importé en
tête du fichier depuis la Tâche 2** — compléter cette ligne d'import plutôt que d'en ajouter une
seconde, qui serait une erreur TypeScript :

```ts
// En tete du fichier, la ligne existante devient :
//   import { MODULES, MODULE_SOCLE, APPARTENANCE } from '@/lib/produit/modules'
// Et on ajoute ces deux imports :
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ECRANS_V2 = join(__dirname, '..', '..', 'src', 'app', '(v2)')

/**
 * Recompose la liste des ecrans depuis le SYSTEME DE FICHIERS, jamais depuis
 * une liste tenue a la main — une liste a la main aurait exactement le defaut
 * qu'on corrige : elle s'oublie.
 */
function ecransReels(): string[] {
  return readdirSync(ECRANS_V2)
    .filter((nom) => statSync(join(ECRANS_V2, nom)).isDirectory())
    .sort()
}

describe('L’appartenance des ecrans aux modules', () => {
  it('ne laisse AUCUN ecran sans decision', () => {
    const sansDecision = ecransReels().filter((e) => !(e in APPARTENANCE))
    expect(
      sansDecision,
      `Ces ecrans n’ont pas dit a quel module ils appartiennent : ${sansDecision.join(', ')}. ` +
        'Ajoutez une ligne dans APPARTENANCE (src/lib/produit/modules.ts) — ' +
        'soit { module: "..." }, soit { socle: "pourquoi il ne depend d’aucun module" }.',
    ).toEqual([])
  })

  it('ne garde AUCUNE decision qui designe un ecran disparu', () => {
    const reels = new Set(ecransReels())
    const fantomes = Object.keys(APPARTENANCE).filter((e) => !reels.has(e))
    expect(
      fantomes,
      `Ces decisions designent des ecrans qui n’existent plus : ${fantomes.join(', ')}`,
    ).toEqual([])
  })

  it('ne cite aucun module inconnu', () => {
    const inconnus = Object.entries(APPARTENANCE)
      .filter(([, d]) => 'module' in d && !(d.module in MODULES))
      .map(([ecran, d]) => `${ecran} → ${(d as { module: string }).module}`)
    expect(
      inconnus,
      `Modules inconnus cites : ${inconnus.join(', ')}. Une faute de frappe ici declare ` +
        'une appartenance qui n’existe pas, donc un ecran qui ne s’eteindra jamais.',
    ).toEqual([])
  })
})
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

Commande : `npx vitest run tests/lib/couverture-modules.test.ts`
Attendu : ÉCHEC — `APPARTENANCE` n'est pas exporté

- [ ] **Étape 3 : ajouter `APPARTENANCE` à la fin de `src/lib/produit/modules.ts`**

```ts
/** Ce qu'on a decide pour un ecran. */
export type Appartenance =
  /** Il appartient a ce module : eteint, l'ecran disparait et le serveur refuse. */
  | { module: string }
  /** Il ne depend d'aucun module, et voici pourquoi. */
  | { socle: string }

/**
 * Chaque dossier d'ecran sous `src/app/(v2)`, et le module dont il depend.
 *
 * La cle est le nom du dossier, tel quel. Le test le recompose depuis le
 * systeme de fichiers : en cas d'ecart, il affiche la cle attendue.
 */
export const APPARTENANCE: Record<string, Appartenance> = {
  // ── Le socle : ces ecrans existent quels que soient les modules ──────────
  accueil: { socle: 'Le tableau de bord. Il s’adapte aux modules, il n’en depend d’aucun.' },
  equipe: { socle: 'Les personnes du cabinet. Sans elles, aucun module n’a de sens.' },
  reglages: { socle: 'Les reglages du cabinet, dont l’ecran des modules lui-meme.' },
  support: { socle: 'L’assistance doit rester joignable meme si tout le reste est eteint.' },
  absences: {
    socle:
      'Les conges et indisponibilites sont la source PARTAGEE des deux mondes ' +
      '(cadrage V3, section 2) : ils servent aux gardes comme au planning journee.',
  },

  // ── Le module des gardes ────────────────────────────────────────────────
  planning: { module: 'gardes' },
  regles: { module: 'gardes' },
  historique: { module: 'gardes' },
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

Commande : `npx vitest run tests/lib/couverture-modules.test.ts`
Attendu : PASS

⚠️ **Si le test échoue en listant un écran non prévu ci-dessus**, c'est que la V2 a bougé depuis
l'écriture de ce plan. Ne pas supprimer le test : ajouter la ligne manquante, c'est précisément
son travail.

- [ ] **Étape 5 : commit**

```bash
git add src/lib/produit/modules.ts tests/lib/couverture-modules.test.ts
git commit -m "[feat][B-120] Aucun ecran ne peut plus se taire sur le module dont il depend"
```

---

## Tâche 4 : la lecture et le refus côté serveur

**C'est la tâche qui ferme réellement la porte.** Les autres ne font que la cacher.

**Fichiers :**
- Créer : `src/lib/produit/modules-serveur.ts`
- Test : `tests/lib/modules-serveur.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
// tests/lib/modules-serveur.test.ts
import { describe, expect, it, vi } from 'vitest'
import { ModuleEteintError, exigerModule, modulesDuCabinet } from '@/lib/produit/modules-serveur'

/** Un faux client Supabase qui rend la liste demandee pour le cabinet. */
function faussSupabase(modules: string[] | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: modules === null ? null : { modules_actifs: modules },
            error: null,
          }),
        }),
      }),
    }),
  } as never
}

vi.mock('@/lib/supabase/cabinet', () => ({
  resoudreCabinetId: async () => 'cab-1',
  CabinetIntrouvableError: class extends Error {},
}))

describe('modulesDuCabinet', () => {
  it('rend les modules allumes du cabinet', async () => {
    expect(await modulesDuCabinet(faussSupabase(['gardes', 'chat']))).toEqual(['gardes', 'chat'])
  })

  it('replie sur le socle si le cabinet est introuvable — jamais sur « tout allume »', async () => {
    expect(await modulesDuCabinet(faussSupabase(null))).toEqual(['gardes'])
  })
})

describe('exigerModule', () => {
  it('laisse passer un module allume', async () => {
    await expect(exigerModule(faussSupabase(['gardes', 'chat']), 'chat')).resolves.toBeUndefined()
  })

  it('REFUSE un module eteint, avec un message que l’admin peut lire', async () => {
    await expect(exigerModule(faussSupabase(['gardes']), 'chat')).rejects.toThrow(ModuleEteintError)
    await expect(exigerModule(faussSupabase(['gardes']), 'chat')).rejects.toThrow(
      /Messagerie de l’equipe/,
    )
  })
})
```

- [ ] **Étape 2 : lancer le test et vérifier qu'il échoue**

Commande : `npx vitest run tests/lib/modules-serveur.test.ts`
Attendu : ÉCHEC — `Cannot find module '@/lib/produit/modules-serveur'`

- [ ] **Étape 3 : écrire l'implémentation**

```ts
// src/lib/produit/modules-serveur.ts
// ============================================================
// GUARDVETO — Le refus serveur d'un module eteint
// ============================================================
// Cacher une entree de menu n'a JAMAIS ferme une URL. Une porte fermee a
// l'ecran et ouverte au serveur n'est pas un defaut d'affichage, c'est une
// faille — et c'est la famille de defauts la plus payee sur ce produit
// (« trois chemins d'ecriture, deux gardiens », 22/08).
//
// ⚠️ LE REPLI EST LE SOCLE, JAMAIS « TOUT ALLUME ». Si le cabinet est
//    introuvable ou la lecture echoue, on rend `['gardes']` : le produit se
//    degrade en fermant, pas en ouvrant. Un repli permissif transformerait
//    une panne de lecture en ouverture generale, sans un seul message.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { MODULES, MODULE_SOCLE } from '@/lib/produit/modules'

export class ModuleEteintError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModuleEteintError'
  }
}

/** Les modules allumes pour le cabinet de l'utilisateur connecte. */
export async function modulesDuCabinet(

  supabase: SupabaseClient<any, any, any>
): Promise<string[]> {
  const cabinetId = await resoudreCabinetId(supabase)

  const { data, error } = await supabase
    .from('cabinets')
    .select('modules_actifs')
    .eq('id', cabinetId)
    .maybeSingle()

  // Repli fermant, jamais ouvrant. Voir l'avertissement en tete de fichier.
  if (error || !data?.modules_actifs) return [MODULE_SOCLE]

  return data.modules_actifs as string[]
}

/**
 * Refuse l'action si le module n'est pas allume pour ce cabinet.
 *
 * A appeler EN PREMIER dans toute action serveur d'un module eteignable,
 * avant toute lecture et toute ecriture.
 */
export async function exigerModule(

  supabase: SupabaseClient<any, any, any>,
  module: string
): Promise<void> {
  const allumes = await modulesDuCabinet(supabase)
  if (allumes.includes(module)) return

  const nom = MODULES[module]?.nom ?? module
  throw new ModuleEteintError(
    `« ${nom} » n’est pas activé pour ce cabinet. Contactez MonProjetPro pour l’ouvrir.`,
  )
}
```

- [ ] **Étape 4 : lancer le test et vérifier qu'il passe**

Commande : `npx vitest run tests/lib/modules-serveur.test.ts`
Attendu : PASS — 4 tests

- [ ] **Étape 5 : commit**

```bash
git add src/lib/produit/modules-serveur.ts tests/lib/modules-serveur.test.ts
git commit -m "[feat][B-120] Le serveur refuse un module eteint, et il se degrade en fermant"
```

---

## Tâche 5 : la navigation masque ce qui est éteint

**Fichiers :**
- Modifier : `src/app/(v2)/layout.tsx`
- Modifier : `src/components/v2/BarreV2.tsx`

- [ ] **Étape 1 : lire les deux fichiers avant de les modifier**

```bash
sed -n '1,60p' "src/app/(v2)/layout.tsx"
sed -n '1,120p' src/components/v2/BarreV2.tsx
```

⚠️ **Ne pas coder de mémoire depuis ce plan** : `BarreV2.tsx` a évolué depuis son écriture. Lire
d'abord la forme réelle de ses props, puis adapter.

- [ ] **Étape 2 : résoudre les modules dans le layout et les descendre**

Dans `src/app/(v2)/layout.tsx`, après la vérification de l'utilisateur :

```tsx
import { modulesDuCabinet } from '@/lib/produit/modules-serveur'

// … après `if (!user) redirect('/login')`
const modules = await modulesDuCabinet(supabase)
```

Puis passer `modules` au composant de barre, par la même voie que `dock`.

- [ ] **Étape 3 : masquer les entrées éteintes dans `BarreV2.tsx`**

Ajouter `modules: string[]` aux props du composant, puis la correspondance entre entrée de menu
et module, à côté de la définition de `entree` :

```tsx
import { APPARTENANCE } from '@/lib/produit/modules'

// `modules` arrive par les props, resolu une seule fois dans le layout (etape 2).
// Ne PAS le relire ici : un composant client n'a pas de cabinet_id de confiance.

/**
 * Une entree du dock s'affiche si l'ecran qu'elle ouvre appartient au socle,
 * ou a un module allume. La source est APPARTENANCE — jamais une seconde
 * liste, qui divergerait le jour ou l'on ajoute un ecran.
 */
const visible = (chemin: string) => {
  const ecran = chemin.replace(/^\//, '')
  const decision = APPARTENANCE[ecran]
  if (!decision) return true       // ecran inconnu : on n'invente pas de refus
  if ('socle' in decision) return true
  return modules.includes(decision.module)
}
```

Puis envelopper chaque `<Link>` d'un module éteignable : `{visible('/planning') && <Link … >}`.

- [ ] **Étape 4 : prouver que ça marche, des deux côtés**

```bash
npm run build
```

Attendu : build réussi, aucune erreur TypeScript.

Puis, sur le déploiement, avec le cabinet bac à sable :
1. `modules_actifs = {gardes}` → les entrées Planning, Règles, Historique sont visibles.
2. Passer à `{gardes,chat}` en base, recharger → rien ne change encore (le chat n'a pas d'écran).
3. Retirer `gardes` est impossible (contrainte + `eteignable: false`) — ne pas essayer en prod.

- [ ] **Étape 5 : commit**

```bash
git add "src/app/(v2)/layout.tsx" src/components/v2/BarreV2.tsx
git commit -m "[feat][B-120] Le dock ne montre plus les espaces d'un module eteint"
```

---

## Tâche 6 : l'écran d'administration

**Fichiers :**
- Créer : `src/app/(v2)/reglages/modules/page.tsx`
- Créer : `src/app/(v2)/reglages/modules/actions.ts`

- [ ] **Étape 1 : écrire l'action serveur**

```ts
'use server'

// ============================================================
// GUARDVETO — Allumer et eteindre un module, cabinet par cabinet
// ============================================================
// ⚠️ RESERVE A MonProjetPro. Ce n'est pas un reglage de cabinet : c'est le
//    perimetre de l'abonnement. Un admin de cabinet qui pourrait s'ouvrir un
//    module s'offrirait une fonction non souscrite.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { MODULES, MODULE_SOCLE } from '@/lib/produit/modules'

export async function basculerModule(
  module: string,
  allumer: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(module in MODULES)) {
    return { ok: false, message: 'Module inconnu.' }
  }
  if (!MODULES[module].eteignable && !allumer) {
    return { ok: false, message: `« ${MODULES[module].nom} » ne peut pas etre eteint.` }
  }

  const supabase = await createClient()
  const cabinetId = await resoudreCabinetId(supabase)

  const { data, error: lecture } = await supabase
    .from('cabinets')
    .select('modules_actifs')
    .eq('id', cabinetId)
    .maybeSingle()

  if (lecture || !data) {
    return { ok: false, message: 'Impossible de lire les modules de ce cabinet.' }
  }

  const actuels = new Set<string>(data.modules_actifs as string[])
  if (allumer) actuels.add(module)
  else actuels.delete(module)
  actuels.add(MODULE_SOCLE)   // le socle ne se retire jamais, quoi qu'il arrive

  const { error } = await supabase
    .from('cabinets')
    .update({ modules_actifs: Array.from(actuels).sort() })
    .eq('id', cabinetId)

  if (error) return { ok: false, message: 'L’enregistrement a echoue.' }

  revalidatePath('/', 'layout')   // la barre est rendue par le layout
  return { ok: true }
}
```

- [ ] **Étape 2 : écrire l'écran**

⚠️ **Avant d'écrire le composant, lire un écran existant** (`src/app/(v2)/reglages/page.tsx`)
et **reprendre ses jetons de style**. Rappel de deux leçons maison : jamais de `<select>` natif
(utiliser le `Select` du projet), et uniquement les jetons `--t-muted` / `--t-border` /
`--t-accent`.

L'écran liste `MODULES`, affiche pour chacun son nom, sa description, un interrupteur, et
grise celui dont `eteignable` vaut `false` avec la mention « toujours actif ».

- [ ] **Étape 3 : déclarer le nouvel écran au gardien**

Le test de la Tâche 3 ne verra pas `reglages/modules` (il ne regarde que le premier niveau),
donc rien à ajouter. **Le vérifier plutôt que le supposer :**

```bash
npx vitest run tests/lib/couverture-modules.test.ts
```

Attendu : PASS. Si le test réclame `modules`, ajouter
`modules: { socle: 'L’ecran qui allume les modules ne peut pas dependre d’un module.' }`.

- [ ] **Étape 4 : prouver l'écran sur le déploiement**

Allumer `planning-journee` sur le bac à sable depuis l'écran, recharger, vérifier en base :

```sql
SELECT nom, modules_actifs FROM cabinets;
```

Attendu : le bac à sable porte `{gardes,planning-journee}`, **les autres cabinets sont
inchangés à `{gardes}`**.

- [ ] **Étape 5 : commit**

```bash
git add "src/app/(v2)/reglages/modules"
git commit -m "[feat][B-120] MiKL allume et eteint les modules, cabinet par cabinet"
```

---

## Tâche 7 : Filou suit le produit

Règle projet non négociable : toute action serveur nouvelle doit dire ce que Filou en fait,
sous peine d'échec du test.

**Fichiers :**
- Modifier : `src/lib/ia/couverture-produit.ts`

- [ ] **Étape 1 : lancer le test-gardien pour qu'il dise la clé exacte attendue**

Commande : `npx vitest run tests/lib/filou-couverture-produit.test.ts`
Attendu : ÉCHEC, avec la clé manquante affichée (probablement
`reglages/modules#basculerModule`). **Prendre la clé telle qu'affichée**, ne pas la deviner.

- [ ] **Étape 2 : écrire la décision**

```ts
  // ── LES MODULES DU PRODUIT (B-120) ──────────────────────────────────────
  'reglages/modules#basculerModule': {
    hors:
      'Allumer un module engage le perimetre de l’abonnement, pas le planning. ' +
      'C’est une decision commerciale de MonProjetPro — Filou n’a rien a y faire.',
  },
```

- [ ] **Étape 3 : vérifier que le gardien passe**

Commande : `npx vitest run tests/lib/filou-couverture-produit.test.ts`
Attendu : PASS

⚠️ **Question ouverte, à trancher par MiKL** : Filou doit-il *savoir* qu'un module est éteint,
pour éviter de proposer une capacité indisponible ? Ce n'est pas le même sujet que la ligne
ci-dessus. **Hypothèse par défaut : oui, mais au chantier où le premier module éteignable aura
des écrans** (chantier 3 ou 5). Aujourd'hui aucun module éteignable n'a de capacité, donc
Filou ne peut rien promettre de faux.

- [ ] **Étape 4 : commit**

```bash
git add src/lib/ia/couverture-produit.ts
git commit -m "[feat][B-120] Filou dit ce qu'il fait de l'interrupteur des modules : rien, et pourquoi"
```

---

## Tâche 8 : la suite complète, et la gate sécurité

- [ ] **Étape 1 : lancer TOUTE la suite**

Commande : `npm test`
Attendu : tous les tests au vert. Référence connue avant ce chantier : **1719 tests verts**
(état du `f8e00f9`). Un test rouge = on s'arrête, on ne commit pas.

- [ ] **Étape 2 : build de production**

Commande : `npm run build`
Attendu : succès, zéro erreur TypeScript.

- [ ] **Étape 3 : gate CERBÈRE — audit ciblé**

Points à auditer, spécifiques à ce chantier :

| À vérifier | Comment |
|---|---|
| Une action d'un module éteint est refusée **au serveur** | Éteindre `chat` en base, appeler l'action directement, attendre `ModuleEteintError` |
| `basculerModule` ne peut pas être appelée par un admin de cabinet | ⚠️ **Trou connu du plan** — voir ci-dessous |
| Le repli de `modulesDuCabinet` ferme, il n'ouvre pas | Test de la Tâche 4, déjà écrit |
| La RLS de `cabinets` autorise-t-elle un cabinet à mettre à jour sa propre ligne ? | `SELECT * FROM pg_policies WHERE tablename = 'cabinets'` |

⚠️ **TROU ASSUMÉ DE CE PLAN, à traiter avant de livrer** : `basculerModule` n'a **aucun contrôle
de rôle**. Telle qu'écrite, un admin de cabinet pourrait s'ouvrir un module non souscrit.
Il manque une notion de « super-administrateur MonProjetPro » qui **n'existe pas encore dans le
produit** (`UserRole = 'admin' | 'veto'`). Deux issues, à trancher par MiKL :
1. **Ajouter le rôle** — propre, mais c'est un sujet à part entière ;
2. **Ne pas exposer l'écran** en V3.1 et basculer les modules en SQL — MiKL est le seul à avoir
   accès à la base. Moins joli, sûr immédiatement.

**Hypothèse par défaut : option 2**, et la Tâche 6 devient « à faire plus tard ».
Je ne prends pas cette décision seul : elle change ce qui est livré.

- [ ] **Étape 4 : convergence OTTO**

Reprendre le tableau KIT COMPLET en tête de ce plan, ligne par ligne, et remplir :

| Ce que l'item annonçait | Ce qui est réellement livré | Verdict |
|---|---|---|
| … (une ligne par case cochée) | … (fichier, fonction — vérifié, pas supposé) | ✅ / ⚠️ / ❌ |

⚠️ ou ❌ → **pas de commit final**. On finit, ou on crée `B-120a` au board.

- [ ] **Étape 5 : ATLAS**

Une ligne dans `docs/patch-log.md`. Si le chantier a révélé un piège non évident, écrire
**aussi** dans `docs/08-lessons-learned.md`.

---

## Ce que ce plan ne fait pas

- **Il ne livre aucune capacité visible pour Anne-Sophie.** C'est un chantier d'infrastructure :
  à la fin, GuardVeto fait exactement ce qu'il faisait, avec un interrupteur en plus. C'est
  voulu — l'interrupteur doit exister **avant** ce qu'il commande.
- **Il ne touche pas au moteur de gardes**, ni aux règles, ni aux compteurs.
- **Il ne crée pas la branche de travail.** À faire au démarrage :
  `git checkout -b feat/v3-planning-journee`, fusionnée dans `master` **par tâche livrée** et
  non à la fin (risque « branche longue », cadrage V3 section 5).
- **Il ne résout pas B-104**, le bloquant V2. Le cadrage le place en chantier 0, avant celui-ci.

---

*Plan écrit le 2026-09-10. Cadrage : `docs/cadrage-v3-2026-09-10.md`. Board : B-120.*
