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

// ── L'APPARTENANCE DES ECRANS ───────────────────────────────────────────────

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

/**
 * Un ecran est-il visible, compte tenu des modules allumes ?
 *
 * ⚠️ Cette fonction sert a AFFICHER, jamais a autoriser. Un ecran inconnu
 *    rend `true` : on n'invente pas un refus depuis un catalogue incomplet,
 *    c'est le role du test-gardien de crier, et de `exigerModule` de fermer.
 */
export function ecranVisible(ecran: string, modulesAllumes: string[]): boolean {
  const decision = APPARTENANCE[ecran]
  if (!decision) return true
  if ('socle' in decision) return true
  return modulesAllumes.includes(decision.module)
}
