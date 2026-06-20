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
