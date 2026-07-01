// ============================================================
// GUARDVETO — Types du moteur de génération
// ============================================================

export type JourSemaine = 'lundi' | 'mardi' | 'mercredi' | 'jeudi' | 'vendredi' | 'samedi' | 'dimanche'
export type TypeGardeEngine = 'semaine_soir' | 'vendredi_soir' | 'weekend' | 'ferie'
export type Saison = 'ete' | 'hiver'
/**
 * Label d'une place sur un créneau. **Libre** (P3a-2) : le catalogue décide
 * combien de places et comment elles s'appellent (1er, 2nd, 3e…). Les valeurs
 * 'premier' / 'second' restent les DÉFAUTS conventionnels (catalogue seed), et
 * la sémantique historique (R11b avantage financier du 1er, R8 inversion) reste
 * portée par ces NOMS — pas par le type. La généralisation de cette sémantique
 * en règles/relations configurables est P4 ; P3a-2 ne pose que le rail générique.
 */
export type RoleGarde = string

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
    // Espacement minimal réglable (brique catalogue `espacement_min`) : au moins
    // X jours entre deux gardes d'un même véto (anti nuits enchaînées).
    | 'espacement_min'
    // Fréquence des week-ends réglable (brique catalogue `espacement_weekend`) :
    // au plus 1 garde de week-end toutes les N semaines (« 1 WE sur N »). Dur si
    // étage ≤ 2, sinon pénalité. Ne s'applique qu'aux créneaux `weekend`.
    | 'espacement_weekend'
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

/**
 * Une PLACE à pourvoir sur un créneau : un rôle (label) + le véto assigné.
 *
 * P3a : le rôle reste 'premier' | 'second' (défaut à 2 places). Il se généralisera
 * en label libre (`string`) quand le catalogue pilotera N places par créneau (P3a-2).
 */
export interface Placement {
  role: RoleGarde
  /** Véto assigné à cette place, ou null si non encore pourvue. */
  vetId: string | null
}

/**
 * Une attribution dans le planning en cours de construction.
 *
 * Modèle « liste de placements » (P3a) : une garde n'est plus un couple figé
 * (premier_id, second_id) mais une LISTE de places à label. Cela lève le verrou
 * « exactement 2 rôles » et débloque N vétos / plusieurs gardes par jour.
 *
 * ÉQUIVALENCE : pour le défaut, `placements = [{premier,…},{second,…}]` — une
 * place non pourvue a `vetId: null` (miroir exact de premier_id/second_id à null).
 * Les accès historiques passent par les helpers de `attribution.ts` (côté solver)
 * et par des accesseurs ré-implémentés indépendamment côté validateur.
 */
export interface AttributionGarde {
  date: string
  type: TypeGardeEngine
  placements: Placement[]
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
  /**
   * Catalogue de créneaux du cabinet (fondamentaux universels — P1/P2). Même
   * piège que ci-dessus : à propager explicitement dans resoudreContexte.
   * Absent → le moteur retombe sur le mapping en dur (comportement historique).
   */
  creneaux?: import('./creneau-modele').CreneauModele[]
}

// Résultat d'une vérification
export interface ValidationResult {
  valid: boolean
  raison?: string
  warning?: string  // valide mais non optimal (ex: Anne-Cat)
}
