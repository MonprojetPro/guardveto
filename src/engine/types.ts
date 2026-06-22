// ============================================================
// GUARDVETO — Types du moteur de génération
// ============================================================

export type JourSemaine = 'lundi' | 'mardi' | 'mercredi' | 'jeudi' | 'vendredi' | 'samedi' | 'dimanche'
export type TypeGardeEngine = 'semaine_soir' | 'vendredi_soir' | 'weekend' | 'ferie'
export type Saison = 'ete' | 'hiver'
export type RoleGarde = 'premier' | 'second'

// Vétérinaire tel que le moteur le voit
export interface VetEngine {
  id: string
  nom: string
  prenom: string
  statut: 'associe' | 'salarie'
  dernier_recours: boolean
  contraintes: ContrainteEngine[]
  conges: CongeEngine[]
}

/**
 * VetEngine dont les contraintes ont été NORMALISÉES (les paramètres rangés sous
 * `config.params` ont été hissés à la racine — cf. normaliserContraintes.ts).
 *
 * Type « marqué » (branded) produit UNIQUEMENT par `normaliserContraintesVets`.
 * Les fonctions de JUGEMENT qui lisent la config d'une règle (`isValid`,
 * `scorerPlanning`…) EXIGENT ce type : leur passer des vétos non normalisés
 * devient une ERREUR DE COMPILATION.
 *
 * C'est la parade structurelle contre la cécité « params » : le bug récurrent où
 * un lecteur lit la règle au mauvais niveau et la rate en silence (le générateur
 * proposait alors un véto que le validateur rejetait). Désormais, impossible
 * d'oublier de normaliser avant de juger.
 */
declare const __vetNormaliseBrand: unique symbol
export type VetEngineNormalise = VetEngine & { readonly [__vetNormaliseBrand]: true }

export interface ContrainteEngine {
  id: string
  type:
    | 'jour_repos_fixe'
    | 'jour_repos_conditionnel'
    | 'indisponibilite_cyclique'
    | 'duo_interdit'
    // Limite de charge réglable (brique catalogue `au_plus_n`) : au plus N gardes
    // par fenêtre (semaine civile ou glissante). Dur si étage ≤ 2, sinon pénalité.
    | 'au_plus_n'
  config: Record<string, unknown>
  actif: boolean
}

export interface CongeEngine {
  date_debut: string  // ISO yyyy-MM-dd
  date_fin: string
  /** Type du congé — utile pour R10c (pas de garde le WE avant des vacances). */
  type?: 'vacances' | 'formation' | 'sante' | 'autre' | 'indisponibilite'
}

// Un créneau de garde à planifier
export interface SlotGarde {
  date: string        // ISO yyyy-MM-dd (lundi pour semaine, samedi pour WE)
  type: TypeGardeEngine
  saison: Saison
  /**
   * Effectif configurable (P1-B/structurelles) : ce créneau a-t-il besoin d'un 2nd ?
   * Décide l'effectif INDÉPENDAMMENT de la saison (effectif réglable par cabinet).
   * Absent (legacy) → repli sur la saison (hiver = 2, été = 1) pour les semaine_soir ;
   * les vendredi_soir / weekend ont toujours besoin d'un 2nd.
   */
  besoinSecond?: boolean
}

// Une attribution dans le planning en cours de construction
export interface AttributionGarde {
  date: string
  type: TypeGardeEngine
  premier_id: string | null
  second_id: string | null
}

export interface CalendrierResolu {
  /** Dates ISO yyyy-mm-dd des jours fériés */
  feries: Set<string>
  /** Plages de vacances scolaires */
  vacancesScolaires: Array<{ debut: string; fin: string }>
}

// Planning partiellement construit (passé au vérificateur)
export interface PlanningPartiel {
  attributions: AttributionGarde[]
}

// Contexte complet d'une simulation — alias structurel de SolverInput,
// utilisé par la couche data (resoudreContexte / persisterResultat)
// pour nommer explicitement le contrat entre le loader et le solver.
export interface ContexteSimulation {
  dateDebut: string
  dateFin: string
  saison: Saison
  /**
   * Vétos déjà NORMALISÉS à la source (resoudreContexte normalise une fois pour
   * toutes — parade contre la cécité « params »). Tout consommateur reçoit donc
   * des règles dépliées, prêtes à être jugées par isValid sans risque d'oubli.
   */
  vets: VetEngineNormalise[]
  /** Bonus/malus inter-périodes (R20). Passer {} si aucun. */
  bonusMalus: import('./score-lexicographique').BonusMalusMap
  /** Calendrier résolu (fériés + vacances scolaires). Fallback sur listes en dur si absent. */
  calendrier?: CalendrierResolu
  /**
   * Effectif configurable la nuit en semaine (1 ou 2). Absent → repli saison.
   * ⚠️ DOIT être propagé jusqu'au solver : un oubli ici le détruit silencieusement
   * (le loader le charge mais resoudreContexte reconstruit l'objet à la main).
   */
  nbVetosSemaineSoir?: number
  /**
   * Poids d'équité configurables (curseurs cabinet). Absent → DEFAULT_EQUITY_WEIGHTS.
   * Même remarque que ci-dessus : à propager explicitement dans resoudreContexte.
   */
  equityWeights?: import('./equity-weights').EquityWeights
  /**
   * Config des règles structurelles R8/R9 (réglables). Absent → défaut (fermes).
   * Même piège : à propager explicitement dans resoudreContexte ET au validateur.
   */
  structureConfig?: import('./structure-config').StructureConfig
}

// Résultat d'une vérification
export interface ValidationResult {
  valid: boolean
  raison?: string
  warning?: string  // valide mais non optimal (ex: Anne-Cat)
}
