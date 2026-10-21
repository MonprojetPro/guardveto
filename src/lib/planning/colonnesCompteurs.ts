// ============================================================
// GUARDVETO — Les colonnes de l'encart compteurs
// ============================================================
// L'encart du planning tenait dans une colonne étroite : au-delà de QUATRE
// colonnes chiffrées, les prénoms passaient sur deux lignes et les nombres se
// touchaient — c'est déjà ce qui arrivait à « Anne-Catherine » avec trois.
//
// 🔑 CETTE CONTRAINTE N'EST PLUS UNIVERSELLE DEPUIS B-145 lot 2c (06/10) :
//    l'encart s'ouvre maintenant en pop-up (`CompteursModale`) sur l'écran
//    chantier, largement plus large que les 262 px de l'ancienne colonne
//    latérale. MiKL, le 21/10, en capture : la largeur ne justifie plus
//    quatre, « il y a largement la place pour au moins 7 ou 8 colonnes ».
//
//    Le plafond de CE fichier (`MAX_COLONNES`) est donc devenu le plafond
//    ABSOLU de stockage — ce qu'une préférence peut porter, huit. La largeur
//    RÉELLEMENT disponible à l'écran est une question d'affichage, pas de
//    catalogue : `CompteursPanel` reçoit un `maxAffichable` qui la borne au
//    plus étroit des deux contextes (4 sur l'ancienne colonne latérale de
//    `PlanningV2`, 8 dans la pop-up). Une préférence à 8 posée depuis la
//    pop-up se tronque donc proprement à 4 si elle s'affiche un jour dans
//    l'ancien gabarit, au lieu de déborder.
//
// D'où ce catalogue : chaque cabinet choisit SES colonnes (décision MiKL du
// 2026-08-03), dans la limite du plafond du contexte, et le réglage suit la
// personne d'un appareil à l'autre (`preferences_affichage`).
//
// Aucune colonne n'est calculée ici : elles lisent toutes des valeurs déjà
// produites par la vue `compteurs_gardes`, par `calculerBilans` — le MÊME
// calcul que le bilan officiel de fin de période — ou, pour les trois
// colonnes « Journées », par `queryCompteursJournee` (même source que l'écran
// Journées : la table `presences_journee`). Ajouter une colonne ne doit
// jamais introduire une seconde façon de compter.
// ============================================================

/** Plafond ABSOLU de stockage — voir l'en-tête. L'affichage le borne encore
 *  selon son contexte (`maxAffichable` de `CompteursPanel`). */
export const MAX_COLONNES = 8

export type CleColonne =
  | 'we'        // week-ends tenus
  | 'nuits'     // nuits de semaine
  | 'premier'   // 1ᵉʳ de garde du week-end (celui qui porte l'avantage financier)
  | 'ecart'     // écart à la juste part — la seule qui dise si c'est ÉQUITABLE
  | 'feries'    // gardes de jours fériés (Noël, 1er mai…)
  | 'total'     // toutes gardes confondues
  | 'premierExcept' // jours de 1ᵉʳ de garde pris à titre exceptionnel
  // B-171 — les trois tranches du module Journées. N'ont de sens QUE pour un
  // cabinet qui l'a activé : `CompteursPanel` ne les propose dans le menu de
  // réglage que si on le lui dit (`disponibleJournee`).
  | 'jMatin'       // présences posées sur un bloc du matin
  | 'jApresMidi'   // présences posées sur un bloc de l'après-midi
  | 'jEntiere'     // présences posées sur un bloc de journée entière

export interface DefinitionColonne {
  cle: CleColonne
  /** L'en-tête, forcément court : la colonne fait quelques dizaines de pixels. */
  entete: string
  /** Ce que la colonne veut dire, en toutes lettres (menu de réglage, infobulle). */
  description: string
  /** Une barre de proportion sous le nombre aide à comparer d'un coup d'œil. */
  barre: boolean
}

export const COLONNES: Record<CleColonne, DefinitionColonne> = {
  we: {
    cle: 'we',
    entete: 'WE',
    description: 'Week-ends tenus',
    barre: true,
  },
  nuits: {
    cle: 'nuits',
    entete: 'Nuits',
    description: 'Nuits de semaine',
    barre: true,
  },
  premier: {
    cle: 'premier',
    entete: '1ᵉʳ WE',
    description: '1ᵉʳ de garde du week-end (celui qui porte l’avantage financier)',
    barre: false,
  },
  ecart: {
    cle: 'ecart',
    entete: 'Écart',
    description: 'Écart à la juste part de week-ends — le même calcul que le bilan de fin de période',
    barre: false,
  },
  feries: {
    cle: 'feries',
    entete: 'Fériés',
    description: 'Gardes de jours fériés (Noël, 1ᵉʳ mai…)',
    barre: false,
  },
  total: {
    cle: 'total',
    entete: 'Total',
    description: 'Toutes gardes confondues',
    barre: true,
  },
  // Backlog 8 bis. Compte des JOURS, pas des week-ends — d'où l'en-tête
  // distinct de « 1ᵉʳ WE » : mélanger les deux unités dans une même colonne
  // ferait valoir un dimanche autant qu'un week-end entier. N'apparaît que si
  // le cabinet la choisit : la plupart n'auront jamais d'exception.
  premierExcept: {
    cle: 'premierExcept',
    entete: '1ᵉʳ except.',
    description:
      'Jours de 1ᵉʳ de garde pris à titre exceptionnel (remplacement d’un seul jour, quand l’admin a dit qu’il comptait)',
    barre: false,
  },
  jMatin: {
    cle: 'jMatin',
    entete: 'Matin',
    description: 'Journées — présences posées sur un bloc du matin',
    barre: true,
  },
  jApresMidi: {
    cle: 'jApresMidi',
    entete: 'Ap.-midi',
    description: 'Journées — présences posées sur un bloc de l’après-midi',
    barre: true,
  },
  jEntiere: {
    cle: 'jEntiere',
    entete: 'Journée',
    description: 'Journées — présences posées sur un bloc de journée entière',
    barre: true,
  },
}

/** L'ordre du menu de réglage — le plus parlant en premier. */
export const ORDRE_CATALOGUE: CleColonne[] = [
  'we', 'nuits', 'premier', 'ecart', 'feries', 'total', 'premierExcept',
  'jMatin', 'jApresMidi', 'jEntiere',
]

/** Les 3 colonnes Journées — n'ont de sens que si le cabinet a ce module. */
export const COLONNES_JOURNEE: readonly CleColonne[] = ['jMatin', 'jApresMidi', 'jEntiere']

/**
 * Ce qu'on affiche quand personne n'a rien réglé. « Écart » en fait partie :
 * les trois autres donnent des nombres bruts, et sans lui rien ne dit si la
 * répartition est juste — il fallait lire la phrase du bas pour apprendre
 * qu'il y avait dix week-ends d'écart, sans savoir chez qui.
 */
export const COLONNES_DEFAUT: CleColonne[] = ['we', 'nuits', 'premier', 'ecart']

/**
 * Nettoie une préférence venue de la base : clés inconnues écartées, doublons
 * supprimés, ordre du catalogue imposé, plafond appliqué. Une préférence vide
 * ou illisible retombe sur le défaut — un encart sans aucune colonne
 * n'apprendrait rien et donnerait l'impression d'un écran cassé.
 */
export function normaliserColonnes(brut: unknown): CleColonne[] {
  if (!Array.isArray(brut)) return COLONNES_DEFAUT
  const vues = new Set<CleColonne>()
  for (const x of brut) {
    if (typeof x === 'string' && x in COLONNES) vues.add(x as CleColonne)
  }
  if (vues.size === 0) return COLONNES_DEFAUT
  return ORDRE_CATALOGUE.filter((c) => vues.has(c)).slice(0, MAX_COLONNES)
}
