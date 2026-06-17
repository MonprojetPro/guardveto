// ============================================================
// GUARDVETO — Grammaire de briques V2 (archi §4.4)
// Story : F4-001 — Normaliser le schéma config des contraintes
// ============================================================
//
// Un "étage" dans le score lexicographique à 7 niveaux (0 = rouge critique,
// 6 = équité de confort). Chaque brique déclare son étage pour que le solver
// sache où peser la violation de cette contrainte.

export type Etage = 0 | 1 | 2 | 3 | 4 | 5 | 6

// Les 4 axes de ciblage (qui/quand/quoi/combien)
export interface AxesBrique {
  /** Vétérinaire(s) ciblé(s) — UUID, tableau d'UUID, ou 'tous' */
  qui?:     string | string[]
  /** Type de créneau ciblé — 'weekend', 'semaine', 'vendredi_soir', 'ferie', etc. */
  quand?:   string | string[]
  /** Type de présence — 'sur_place' | 'astreinte' */
  quoi?:    string
  /** Quantité — entier ou plage min/max */
  combien?: number | { min?: number; max?: number }
}

// Format normalisé V2 (grammaire 6-axes)
export interface ConfigBriqueV2 {
  /** Identifiant de la règle, ex: 'R1_equite_gardes', 'interdire_creneau' */
  brique:  string
  /** Les 4 axes de ciblage (qui/quand/quoi/combien) */
  axes:    AxesBrique
  /** Étage dans le score lexicographique (0 = rouge critique, 6 = équité) */
  force:   Etage
  /** Paramètres spécifiques à la brique (libres, typés par la brique elle-même) */
  params:  Record<string, unknown>
}

// Format V1 hétérogène (libre — brique_type = 'legacy')
export interface ConfigBriqueLegacy {
  [key: string]: unknown
}

// Union discriminée par brique_type (colonne DB)
export type ConfigBrique = ConfigBriqueV2 | ConfigBriqueLegacy
