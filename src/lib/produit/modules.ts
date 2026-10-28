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
  /** `false` si l'eteindre laisserait un compte muet. */
  eteignable: boolean
}

/**
 * Le module historique, et le REPLI quand la liste d'un cabinet ne peut pas
 * etre lue (repli fermant : l'ecran que le cabinet a toujours eu).
 *
 * B-175a (28/10) : il n'est plus « non eteignable ». Un cabinet peut ne tenir
 * que le planning de la journee ; la base refuse seulement qu'il n'en garde
 * AUCUN (contrainte `cardinality(modules_actifs) >= 1`).
 */
export const MODULE_SOCLE = 'gardes' as const

export const MODULES: Record<string, Module> = {
  gardes: {
    nom: 'Gardes du soir et du week-end',
    description:
      'Le cœur historique : generation, publication et suivi du planning de gardes.',
    eteignable: true,
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

/**
 * B-175 — les modules que l'ADMIN d'un cabinet allume et éteint elle-même
 * (Organisation, encart « Vos plannings »). Décision de MiKL, le 27/10 :
 * « il faut que ce choix appartienne à l'admin ».
 *
 * ⚠️ PENDANT EN BASE : la fonction `basculer_module_cabinet` porte la MÊME
 *    liste, en dur (migration 20261027120000). C'est elle qui fait autorité ;
 *    celle-ci ne sert qu'à afficher. Les deux doivent bouger ensemble.
 *    `gardes` y est depuis B-175a (28/10, un cabinet « journées seules »).
 *    `chat` non (aucun écran n'existe : l'allumer ouvrirait sur rien).
 *    Il faut toujours en garder UN allumé : la base le refuse sinon.
 */
export const MODULES_REGLABLES_PAR_ADMIN = ['gardes', 'planning-journee'] as const

/** Les identifiants de modules connus. Toute autre valeur est une faute de frappe. */
export type IdModule = keyof typeof MODULES

// ── L'APPARTENANCE DES ECRANS ───────────────────────────────────────────────

/** Ce qu'on a decide pour un ecran. */
export type Appartenance =
  /** Il appartient a ce module : eteint, l'ecran disparait et le serveur refuse. */
  | { module: string }
  /**
   * B-175a — il sert a PLUSIEURS modules : visible des que l'un d'eux est
   * allume (le planning porte les gardes ET les journees).
   */
  | { modules: string[] }
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
  // Sous-ecran de `reglages` (B-134). Il apparait dans ce catalogue depuis que
  // le test-gardien descend dans les SOUS-DOSSIERS (01/10) : avant, un ecran
  // place sous un dossier du socle n'avait aucune decision a rendre, donc ne
  // pouvait jamais s'eteindre.
  'reglages/agenda': {
    socle:
      'Chacun regle son agenda Google personnel (B-173). Ouvert par cabinet ' +
      '(agenda_perso_ouvert), pas par module : il porte les gardes ET les journees, ' +
      'et n’envoie simplement rien de ce qu’un module eteint ne produit pas.',
  },
  'reglages/notifications': {
    socle:
      'Chacun regle les e-mails qu’il recoit. Les e-mails existent quels que ' +
      'soient les modules allumes — un module eteint n’en envoie simplement pas.',
  },
  absences: {
    socle:
      'Les conges et indisponibilites sont la source PARTAGEE des deux mondes ' +
      '(cadrage V3, section 2) : ils servent aux gardes comme au planning journee.',
  },

  // ── Le module du planning journée ───────────────────────────────────────
  // B-120 chantier 2. PREMIER ÉCRAN ÉTEIGNABLE du produit : jusqu'ici,
  // `ecranVisible` et `exigerModule` n'avaient que des écrans du socle ou des
  // gardes à traiter, donc rien à éteindre pour de vrai.
  journee: { module: 'planning-journee' },

  // ── Le module des gardes ────────────────────────────────────────────────
  // B-175a — la grille porte les gardes ET les journées (B-148/B-172) : un
  // cabinet « journées seules » doit la garder.
  planning: { modules: ['gardes', 'planning-journee'] },
  // B-175 — Organisation porte l'encart « Vos plannings » (l'interrupteur des
  // modules) et une partie par module : elle ne peut dépendre d'aucun d'eux,
  // sinon éteindre un module fermerait la porte qui permet de le rallumer.
  regles: {
    socle:
      'L’organisation du cabinet : l’interrupteur des modules et une partie par ' +
      'module (gardes, journées), chacune n’apparaissant que si son module est allumé.',
  },
  // B-175a — les compteurs de gardes ET celui des journées (B-175).
  historique: { modules: ['gardes', 'planning-journee'] },
  // B-176 — la page du lien « Je prends ce créneau » (appel à volontaires),
  // passée de la V1 à la V2 le 28/10. Sans gardes, pas de créneau à prendre.
  'crise/volontaire': { module: 'gardes' },
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
  if ('modules' in decision) return decision.modules.some((m) => modulesAllumes.includes(m))
  return modulesAllumes.includes(decision.module)
}
