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

export interface ContrainteEngine {
  id: string
  type: 'jour_repos_fixe' | 'jour_repos_conditionnel' | 'indisponibilite_cyclique' | 'duo_interdit'
  config: Record<string, unknown>
  actif: boolean
}

export interface CongeEngine {
  date_debut: string  // ISO yyyy-MM-dd
  date_fin: string
}

// Un créneau de garde à planifier
export interface SlotGarde {
  date: string        // ISO yyyy-MM-dd (lundi pour semaine, samedi pour WE)
  type: TypeGardeEngine
  saison: Saison
}

// Une attribution dans le planning en cours de construction
export interface AttributionGarde {
  date: string
  type: TypeGardeEngine
  premier_id: string | null
  second_id: string | null
}

// Planning partiellement construit (passé au vérificateur)
export interface PlanningPartiel {
  attributions: AttributionGarde[]
}

// Résultat d'une vérification
export interface ValidationResult {
  valid: boolean
  raison?: string
  warning?: string  // valide mais non optimal (ex: Anne-Cat)
}
