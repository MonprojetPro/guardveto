// ============================================================
// GUARDVETO — Les colonnes de l'encart compteurs
// ============================================================
// L'encart du planning tient dans une colonne étroite : au-delà de QUATRE
// colonnes chiffrées, les prénoms passent sur deux lignes et les nombres se
// touchent — c'est déjà ce qui arrivait à « Anne-Catherine » avec trois.
// La limite n'est donc pas un caprice, c'est la largeur disponible.
//
// D'où ce catalogue : chaque cabinet choisit SES colonnes (décision MiKL du
// 2026-08-03), dans la limite de quatre, et le réglage suit la personne d'un
// appareil à l'autre (`preferences_affichage`).
//
// Aucune colonne n'est calculée ici : elles lisent toutes des valeurs déjà
// produites par la vue `compteurs_gardes` ou par `calculerBilans` — le MÊME
// calcul que le bilan officiel de fin de période. Ajouter une colonne ne doit
// jamais introduire une seconde façon de compter.
// ============================================================

/** Au-delà, l'encart déborde. Contrainte de largeur, pas de préférence. */
export const MAX_COLONNES = 4

export type CleColonne =
  | 'we'        // week-ends tenus
  | 'nuits'     // nuits de semaine
  | 'premier'   // 1ᵉʳ de garde du week-end (celui qui porte l'avantage financier)
  | 'ecart'     // écart à la juste part — la seule qui dise si c'est ÉQUITABLE
  | 'feries'    // gardes de jours fériés (Noël, 1er mai…)
  | 'total'     // toutes gardes confondues
  | 'premierExcept' // jours de 1ᵉʳ de garde pris à titre exceptionnel

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
}

/** L'ordre du menu de réglage — le plus parlant en premier. */
export const ORDRE_CATALOGUE: CleColonne[] = ['we', 'nuits', 'premier', 'ecart', 'feries', 'total', 'premierExcept']

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
