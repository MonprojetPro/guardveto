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
  /** Équité des gardes de semaine tenues à partir de la 3ᵉ place (renfort). */
  SEMAINE_RENFORT: number
  /** R15 — équité des « grands week-ends perdus » par les salariés. */
  GRANDS_WE: number
  /**
   * Vague 6 tranche A (#21) — COHORTES d'équité par tag (dimension × tag ×
   * poids). Chaque cohorte S'AJOUTE aux 6 dimensions globales ci-dessus, sa
   * variance étant calculée uniquement sur les porteurs du tag. Absent/vide →
   * BYTE-IDENTIQUE (aucune entrée de score cohorte). Voyage DANS EquityWeights
   * précisément pour être threadée partout où equityWeights l'est déjà, sans
   * ajouter de champ à SolverInput/ContexteSimulation (piège resoudreContexte).
   */
  cohortes?: EquityCohorte[]
}

/**
 * Rôle portant l'AVANTAGE FINANCIER par défaut (R11b) = 'premier'.
 *
 * P4 : ce rôle n'est plus présumé par le code. Le moteur équilibre le rôle
 * `roleAvantageFinancier` du créneau (qui l'obtient combien de fois) ; le WEIGHT
 * associé reste la dimension d'équité `weekend_premier` (WE_PREMIER_ROLE).
 *   • undefined (absent de l'input) → ce défaut historique 'premier'.
 *   • null → AUCUN rôle avantagé (l'IA a appris qu'être 1er ne change rien pour
 *     ce cabinet → on n'équilibre pas le rôle).
 *   • autre label → l'avantage porte sur ce rôle-là.
 */
export const DEFAULT_ROLE_AVANTAGE_FINANCIER = 'premier'

/**
 * Mappe la valeur BASE (`cabinets.role_avantage_financier`) vers le paramètre
 * moteur `roleAvantageFinancier` :
 *   'premier' | 'second' → tel quel ;
 *   'aucun'              → null (pas d'équilibrage du rôle) ;
 *   absent / inconnu     → undefined (repli défaut moteur = 'premier').
 * Lecture BEST-EFFORT : une colonne pas encore migrée ne casse rien.
 */
export function mapperRoleAvantageFinancierDb(v: unknown): string | null | undefined {
  if (v === 'aucun') return null
  if (v === 'premier' || v === 'second') return v
  return undefined
}

/** Valeurs par défaut = comportement historique (aucun changement de planning). */
export const DEFAULT_EQUITY_WEIGHTS: EquityWeights = {
  WE_GARDE: 100,
  WE_PREMIER_ROLE: 25,
  FERIES: 60,
  SEMAINE_PREMIER: 30,
  SEMAINE_SECOND: 10,
  // Même poids que le 2nd : une place de renfort est la même nature de garde.
  // Sans effet sur les plannings existants (compteur nul → variance nulle).
  SEMAINE_RENFORT: 10,
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
  'semaine_renfort',
  'grands_weekend',
] as const
export type EquityDimension = (typeof EQUITY_DIMENSIONS)[number]

/** Les champs NUMÉRIQUES de poids d'EquityWeights (hors `cohortes`). */
export type EquityWeightField =
  | 'WE_GARDE' | 'WE_PREMIER_ROLE' | 'FERIES'
  | 'SEMAINE_PREMIER' | 'SEMAINE_SECOND' | 'SEMAINE_RENFORT' | 'GRANDS_WE'

/** dimension (clé règle) → champ EquityWeights consommé par le moteur. */
export const DIMENSION_TO_FIELD: Record<EquityDimension, EquityWeightField> = {
  weekend: 'WE_GARDE',
  weekend_premier: 'WE_PREMIER_ROLE',
  ferie: 'FERIES',
  semaine_premier: 'SEMAINE_PREMIER',
  semaine_second: 'SEMAINE_SECOND',
  semaine_renfort: 'SEMAINE_RENFORT',
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
  // Même cran que le 2nd : c'est la même nature de garde, une place de plus.
  // Aucun effet sur les cabinets à 2 places — le compteur y reste nul, et la
  // variance d'un compteur toujours nul est nulle.
  semaine_renfort: 'peu_important',
}

/** Une dimension réglée (telle qu'extraite d'une règle `equilibrer`). */
export interface EquityRule {
  dimension: EquityDimension
  importance: ImportanceLevel
  /**
   * Vague 6 tranche A (#21) — COHORTE : si présent, la règle ne concerne QUE les
   * vétos portant ce tag (normalisé trim().toLowerCase()). Absent (undefined) →
   * dimension GLOBALE historique (byte-identique). Une dimension globale et une
   * cohorte taguée sur la même dimension = DEUX entrées de score indépendantes
   * (la variance de la cohorte S'AJOUTE à la variance globale, elle ne la remplace
   * PAS — l'admin met la globale sur « Ignorée » s'il veut une partition pure).
   */
  tag?: string
}

/**
 * Vague 6 tranche A (#21) — une COHORTE d'équité : (dimension × tag × poids).
 * Chaque cohorte = une entrée de score indépendante, dont la variance est
 * calculée UNIQUEMENT sur les vétos porteurs du tag, puis pondérée par `poids`
 * (résolu depuis le cran d'importance, comme les dimensions globales). Voyage
 * DANS EquityWeights (cf. `EquityWeights.cohortes`) → threadée partout où
 * equityWeights l'est déjà (loader → solver → scoreur → crise → replay), sans
 * nouveau champ de SolverInput/ContexteSimulation à propager (anti-bombe
 * resoudreContexte).
 */
export interface EquityCohorte {
  dimension: EquityDimension
  /** Tag NORMALISÉ (trim().toLowerCase()) désignant les porteurs de la cohorte. */
  tag: string
  /** Poids moteur (résolu du cran d'importance via IMPORTANCE_TO_WEIGHT). */
  poids: number
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
  // 2. Sépare les règles GLOBALES (sans tag) des règles COHORTE (avec tag).
  //    • Globales → écrasent le poids de LEUR dimension (dernière gagne si doublon).
  //    • Cohortes → une entrée de score indépendante par (dimension, tag) — une
  //      importance « ignoree » (poids 0) est INERTE : on ne la matérialise pas
  //      (byte-identique : pas d'entrée cohorte à poids nul dans le scoreur).
  const cohortes: EquityCohorte[] = []
  for (const r of rules) {
    const poids = IMPORTANCE_TO_WEIGHT[r.importance]
    if (typeof poids !== 'number') continue
    const tag = typeof r.tag === 'string' ? r.tag.trim().toLowerCase() : ''
    if (tag !== '') {
      if (poids > 0) cohortes.push({ dimension: r.dimension, tag, poids })
      continue
    }
    // Règle globale (sans tag) : comportement historique inchangé.
    const field = DIMENSION_TO_FIELD[r.dimension]
    if (field) out[field] = poids
  }
  // Absent/vide → BYTE-IDENTIQUE (pas de clé `cohortes` du tout).
  if (cohortes.length > 0) out.cohortes = cohortes
  return out
}

/** dimension d'équité → champ du CompteurVet (rules/optimization.ts) équilibré.
 *  Utilisé par le scoreur pour dériver la variance d'une COHORTE (#21).
 *  ⚠️ `grands_weekend` → `grandsWePerdus`, qui n'est incrémenté que pour les
 *  SALARIÉS (compterParVet l.113) : une cohorte sur cette dimension ne « voit »
 *  donc que les salariés porteurs du tag. Limitation ASSUMÉE et documentée
 *  (voie sûre : aucune modification de compterParVet → byte-identique au score
 *  global des 6 dimensions). Les 5 autres dimensions comptent tous les vétos. */
export const DIMENSION_TO_COMPTEUR: Record<
  EquityDimension,
  | 'weGardes' | 'weekendPremier' | 'feriesGardes'
  | 'semainePremier' | 'semaineSecond' | 'semaineRenfort' | 'grandsWePerdus'
> = {
  weekend: 'weGardes',
  weekend_premier: 'weekendPremier',
  ferie: 'feriesGardes',
  semaine_premier: 'semainePremier',
  semaine_second: 'semaineSecond',
  semaine_renfort: 'semaineRenfort',
  grands_weekend: 'grandsWePerdus',
}
