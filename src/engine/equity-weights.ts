// ============================================================
// GUARDVETO — Poids d'équité : SOURCE UNIQUE (purge dette n°2)
// ============================================================
// Avant : les poids d'équité existaient en DEUX endroits avec le risque de
// diverger — `POIDS_INTRA.EQ_*` (score-lexicographique.ts, scoreur global par
// variance) et `POIDS_LNS` (solver.ts, scoring des candidats greedy + LNS).
// 5 poids numériquement identiques copiés à la main → un changement d'un côté
// n'était pas répercuté de l'autre (curseur « à moitié appliqué », roadmap §3).
//
// Ici : une seule définition. Les deux consommateurs la référencent. C'est aussi
// le point d'injection futur pour rendre l'équité CONFIGURABLE (curseurs par
// cabinet) — il suffira de passer un EquityWeights au lieu du défaut.
//
// ⚠️ Les deux scoreurs gardent des FORMULES de nature différente (variance
// globale vs compteur individuel) — seules les CONSTANTES sont mutualisées.
// ============================================================

/** Poids relatifs des dimensions d'équité (R11–R15). */
export interface EquityWeights {
  /** R11 — équité du nombre de week-ends de garde. */
  WE_GARDE: number
  /** R11b — équité du rôle 1er le week-end (avantage financier). */
  WE_PREMIER_ROLE: number
  /** R12 — équité des gardes de jours fériés. */
  FERIES: number
  /** R13 — équité des gardes de semaine en 1er. */
  SEMAINE_PREMIER: number
  /** R14 — équité des gardes de semaine en 2nd. */
  SEMAINE_SECOND: number
  /** R15 — équité des « grands week-ends perdus » par les salariés. */
  GRANDS_WE: number
}

/** Valeurs par défaut = comportement historique (aucun changement de planning). */
export const DEFAULT_EQUITY_WEIGHTS: EquityWeights = {
  WE_GARDE: 100,
  WE_PREMIER_ROLE: 25,
  FERIES: 60,
  SEMAINE_PREMIER: 30,
  SEMAINE_SECOND: 10,
  GRANDS_WE: 60,
}

// ════════════════════════════════════════════════════════════
// ÉQUITÉ EN TANT QUE RÈGLES (famille `equilibrer`) — source unique
// ════════════════════════════════════════════════════════════
// L'équité n'est plus une table de curseurs séparée : c'est une FAMILLE DE
// RÈGLES (brique `equilibrer`) gérée comme les autres, mais de forme différente
// (elle concerne un COMPTEUR, pas un véto). Chaque dimension = une règle avec
// une IMPORTANCE en 4 crans nommés, que le moteur traduit en poids numérique.
//
// Ce bloc est la SOURCE UNIQUE partagée par : le loader (extraction des poids),
// l'écran /regles (libellés + défauts) et les tests. Pas de React ici.

/** Les crans d'importance, du plus faible au plus fort (ordre signifiant).
 *  `ignoree` (poids 0) = la dimension n'est PAS équilibrée du tout (= désactiver). */
export const IMPORTANCE_LEVELS = [
  'ignoree',
  'peu_important',
  'normal',
  'important',
  'essentiel',
] as const
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number]

/** Cran nommé → poids moteur. Choisi pour retomber sur les défauts historiques. */
export const IMPORTANCE_TO_WEIGHT: Record<ImportanceLevel, number> = {
  ignoree: 0,
  peu_important: 10,
  normal: 30,
  important: 60,
  essentiel: 100,
}

/** Les 6 dimensions d'équité = les 6 compteurs équilibrés (R11–R15). */
export const EQUITY_DIMENSIONS = [
  'weekend',
  'weekend_premier',
  'ferie',
  'semaine_premier',
  'semaine_second',
  'grands_weekend',
] as const
export type EquityDimension = (typeof EQUITY_DIMENSIONS)[number]

/** dimension (clé règle) → champ EquityWeights consommé par le moteur. */
export const DIMENSION_TO_FIELD: Record<EquityDimension, keyof EquityWeights> = {
  weekend: 'WE_GARDE',
  weekend_premier: 'WE_PREMIER_ROLE',
  ferie: 'FERIES',
  semaine_premier: 'SEMAINE_PREMIER',
  semaine_second: 'SEMAINE_SECOND',
  grands_weekend: 'GRANDS_WE',
}

/**
 * Importance PAR DÉFAUT de chaque dimension (quand le cabinet n'a posé aucune
 * règle). Reproduit le comportement historique : WE essentiel, fériés/grands-WE
 * importants, semaine 1er + 1er-du-WE normaux, semaine 2nd peu important.
 * (Seul 1er-du-WE glisse de 25→30 — écart négligeable, assumé.)
 */
export const DEFAULT_IMPORTANCE: Record<EquityDimension, ImportanceLevel> = {
  weekend: 'essentiel',
  ferie: 'important',
  grands_weekend: 'important',
  semaine_premier: 'normal',
  weekend_premier: 'normal',
  semaine_second: 'peu_important',
}

/** Une dimension réglée (telle qu'extraite d'une règle `equilibrer`). */
export interface EquityRule {
  dimension: EquityDimension
  importance: ImportanceLevel
}

/**
 * buildEquityWeights — assemble un EquityWeights à partir des règles d'équité
 * du cabinet. Chaque dimension absente retombe sur son importance par défaut
 * (→ comportement historique). Une dimension/importance inconnue est ignorée
 * (la dimension garde alors son défaut). Jamais d'exception : robustesse moteur.
 */
export function buildEquityWeights(rules: EquityRule[]): EquityWeights {
  // 1. Part des défauts (importance par défaut → poids).
  const out = { ...DEFAULT_EQUITY_WEIGHTS }
  for (const dim of EQUITY_DIMENSIONS) {
    out[DIMENSION_TO_FIELD[dim]] = IMPORTANCE_TO_WEIGHT[DEFAULT_IMPORTANCE[dim]]
  }
  // 2. Écrase avec les règles réellement posées (dernière gagne si doublon).
  for (const r of rules) {
    const field = DIMENSION_TO_FIELD[r.dimension]
    const poids = IMPORTANCE_TO_WEIGHT[r.importance]
    if (field && typeof poids === 'number') out[field] = poids
  }
  return out
}
