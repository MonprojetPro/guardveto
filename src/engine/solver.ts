// ============================================================
// GUARDVETO — Solver backtracking
// ============================================================
// Génère un planning complet et optimal pour une période
// donnée en respectant toutes les contraintes dures et en
// minimisant les pénalités souples + l'écart d'équité.
//
// Algorithme :
//   1. Génère les créneaux à pourvoir (slots WE d'abord, puis semaine)
//   2. Pour chaque créneau, trie les candidats par score d'équité
//   3. Backtrack si impasse → essaie le candidat suivant
// ============================================================

import type { VetEngine, SlotGarde, PlanningPartiel, TypeGardeEngine, RoleGarde, Saison } from './types'
import { jourIndex, addDays, estJourFerie } from './utils'
import { isValid } from './rules/hard-constraints'
import { penalite } from './rules/soft-constraints'
import { compterParVet } from './rules/optimization'
import { POIDS, type BonusMalusMap } from './scorer'

// ── Types publics ────────────────────────────────────────

export interface SolverInput {
  /** Premier jour de la période — doit être un lundi */
  dateDebut: string
  /** Dernier jour de la période (inclusif) */
  dateFin: string
  saison: Saison
  vets: VetEngine[]
  /** Bonus/malus inter-périodes (R20). Passer {} si aucun. */
  bonusMalus: BonusMalusMap
}

export interface JourNonCouvert {
  date: string
  type: TypeGardeEngine
  role: RoleGarde
  /** Raison de blocage si identifiable */
  contrainteBloquante?: string
}

export type SolveResult =
  | {
      success: true
      planning: PlanningPartiel
      /** Nombre de millisecondes pour générer le planning */
      dureeMs: number
    }
  | {
      success: false
      joursNonCouverts: JourNonCouvert[]
      /** Planning partiel jusqu'au point d'impasse */
      planningPartiel: PlanningPartiel
      dureeMs: number
    }

// ── Types internes ───────────────────────────────────────

interface SolverStep {
  date: string
  type: TypeGardeEngine
  saison: Saison
  role: RoleGarde
}

// ── Génération des créneaux ──────────────────────────────

/**
 * Génère la liste ordonnée des étapes à planifier.
 *
 * Ordre : vendredi_soir + weekend (tous les WE en chronologique)
 *         puis semaine_soir (tous les jours Mon-Thu en chronologique).
 *
 * Raison : les WE sont les créneaux les plus contraints (R9 lie
 * vendredi et WE, R3/R5 conditionne les repos de semaine sur le WE).
 * Les traiter en premier maximise l'élagage précoce du backtracking.
 */
function genererSteps(dateDebut: string, dateFin: string, saison: Saison): SolverStep[] {
  const weSteps: SolverStep[] = []
  const semaineSteps: SolverStep[] = []

  let current = dateDebut
  while (current <= dateFin) {
    const idx = jourIndex(current) // 0=dim, 1=lun, ..., 6=sam

    if (idx === 5) {
      // Vendredi → vendredi_soir (toujours 2 de garde)
      weSteps.push({ date: current, type: 'vendredi_soir', saison, role: 'premier' })
      weSteps.push({ date: current, type: 'vendredi_soir', saison, role: 'second' })
    } else if (idx === 6) {
      // Samedi → weekend (toujours 2 de garde)
      weSteps.push({ date: current, type: 'weekend', saison, role: 'premier' })
      weSteps.push({ date: current, type: 'weekend', saison, role: 'second' })
    } else if (idx >= 1 && idx <= 4) {
      // Lundi à Jeudi → semaine_soir
      semaineSteps.push({ date: current, type: 'semaine_soir', saison, role: 'premier' })
      // En hiver : 2 de garde (1er + 2nd). En été : 1 seul (R17).
      if (saison === 'hiver') {
        semaineSteps.push({ date: current, type: 'semaine_soir', saison, role: 'second' })
      }
    }
    // Dimanche : couvert par le weekend du samedi → aucun slot propre

    current = addDays(current, 1)
  }

  return [...weSteps, ...semaineSteps]
}

// ── Scoring des candidats ────────────────────────────────

/**
 * Score d'un vétérinaire pour un créneau donné.
 * Score plus bas = vétérinaire prioritaire (moins de gardes, équité à rétablir).
 *
 * Composantes :
 *  - Compteur dans la dimension principale du créneau × son poids
 *  - Pénalité souple (R10 : WE consécutifs)
 *  - Bonus/malus inter-périodes (R20) : réduit le compteur effectif
 *  - Anne-Cat (dernier recours) → score maximal = essayée en dernier
 */
function scorerCandidat(
  step: SolverStep,
  vet: VetEngine,
  planning: PlanningPartiel,
  bonusMalus: BonusMalusMap,
  allVets: VetEngine[]
): number {
  // Dernier recours → toujours en dernier
  if (vet.dernier_recours) return 1_000_000

  const compteurs = compterParVet(planning, allVets)
  const c = compteurs.find((x) => x.vetId === vet.id) ?? {
    vetId: vet.id,
    weGardes: 0,
    weekendPremier: 0,
    feriesGardes: 0,
    semainePremier: 0,
    semaineSecond: 0,
    grandsWePerdus: 0,
  }
  const bm = bonusMalus[vet.id] ?? 0
  const pen = penalite(
    { date: step.date, type: step.type, saison: step.saison },
    vet,
    step.role,
    planning
  )

  if (step.type === 'weekend' || step.type === 'vendredi_soir') {
    // R11 + R20 : équité WE — bonus/malus réduit le compteur effectif
    // Si bm > 0 (véto doit plus de gardes), son score est réduit → essayé avant
    const weEffectif = c.weGardes - bm

    // R11b : équité du rôle 1er le week-end (avantage financier).
    // R8 impose : 1er du week-end = 2nd du vendredi soir, et 2nd du week-end =
    // 1er du vendredi soir. On agit donc sur les DEUX rôles du vendredi pour
    // répartir l'avantage financier :
    //  - vendredi 2nd (→ deviendra 1er le WE) : on privilégie ceux qui ont été
    //    le moins souvent 1er (malus croissant avec weekendPremier).
    //  - vendredi 1er (→ deviendra 2nd le WE) : on y oriente au contraire ceux
    //    qui ont DÉJÀ beaucoup été 1er (bonus = malus négatif).
    let malusRole = 0
    if (step.type === 'vendredi_soir' && step.role === 'second') {
      malusRole = c.weekendPremier * POIDS.WE_PREMIER_ROLE
    } else if (step.type === 'vendredi_soir' && step.role === 'premier') {
      malusRole = -c.weekendPremier * POIDS.WE_PREMIER_ROLE
    }

    return weEffectif * POIDS.WE_GARDE + malusRole + pen
  }

  // Garde de semaine : priorité selon le type de jour et le rôle
  if (estJourFerie(step.date)) {
    // R12 : équité fériés
    return c.feriesGardes * POIDS.FERIES + pen
  }

  if (step.role === 'premier') {
    // R13 : équité gardes semaine en 1er
    return c.semainePremier * POIDS.SEMAINE_PREMIER + pen
  }

  // R14 : équité 2nd de garde
  return c.semaineSecond * POIDS.SEMAINE_SECOND + pen
}

// ── Gestion du planning ──────────────────────────────────

/**
 * Retourne un nouveau planning avec le vétérinaire assigné au créneau+rôle.
 * Crée l'attribution si absente, ou complète premier_id / second_id.
 */
function assignerStep(
  planning: PlanningPartiel,
  step: SolverStep,
  vetId: string
): PlanningPartiel {
  const attributions = [...planning.attributions]
  const idx = attributions.findIndex(
    (a) => a.date === step.date && a.type === step.type
  )

  if (idx >= 0) {
    attributions[idx] = {
      ...attributions[idx],
      [step.role === 'premier' ? 'premier_id' : 'second_id']: vetId,
    }
  } else {
    attributions.push({
      date: step.date,
      type: step.type,
      premier_id: step.role === 'premier' ? vetId : null,
      second_id: step.role === 'second' ? vetId : null,
    })
  }

  return { attributions }
}

// ── Backtracking ─────────────────────────────────────────

/**
 * Backtracking récursif.
 *
 * @param steps     Liste ordonnée de toutes les étapes à planifier
 * @param index     Index courant dans `steps`
 * @param planning  Planning partiellement construit (immuable)
 * @param vets      Tous les vétérinaires
 * @param bonusMalus  Bonus/malus inter-périodes
 * @param deepest   Référence mutable : index le plus profond atteint (pour diagnostics)
 * @returns         Planning complet si succès, null sinon
 */
function backtrack(
  steps: SolverStep[],
  index: number,
  planning: PlanningPartiel,
  vets: VetEngine[],
  bonusMalus: BonusMalusMap,
  deepest: { value: number }
): PlanningPartiel | null {
  // Cas de base : toutes les étapes sont planifiées
  if (index === steps.length) return planning

  // Trace de profondeur pour les diagnostics d'impasse
  if (index > deepest.value) deepest.value = index

  const step = steps[index]
  const slot: SlotGarde = { date: step.date, type: step.type, saison: step.saison }

  // Candidats valides (contraintes dures) triés par score (équité + pénalités)
  const candidates = vets
    .filter((vet) => isValid(slot, vet, step.role, vets, planning).valid)
    .sort(
      (a, b) =>
        scorerCandidat(step, a, planning, bonusMalus, vets) -
        scorerCandidat(step, b, planning, bonusMalus, vets)
    )

  // Essaie chaque candidat dans l'ordre de priorité
  for (const vet of candidates) {
    const newPlanning = assignerStep(planning, step, vet.id)
    const result = backtrack(steps, index + 1, newPlanning, vets, bonusMalus, deepest)
    if (result !== null) return result
  }

  // Aucun candidat n'a mené à une solution → backtrack
  return null
}

// ── API publique ─────────────────────────────────────────

/**
 * genererPlanningPur — Solver pur (sans Supabase).
 *
 * Prend toutes les données en entrée et retourne un planning complet
 * ou un rapport d'impasse détaillé.
 */
export function genererPlanningPur(input: SolverInput): SolveResult {
  const { dateDebut, dateFin, saison, vets, bonusMalus } = input
  const t0 = Date.now()

  const steps = genererSteps(dateDebut, dateFin, saison)
  const deepest = { value: -1 }

  const planning = backtrack(
    steps,
    0,
    { attributions: [] },
    vets,
    bonusMalus,
    deepest
  )

  const dureeMs = Date.now() - t0

  if (planning !== null) {
    return { success: true, planning, dureeMs }
  }

  // Impasse : construit le rapport des jours non couverts
  // Les étapes à partir de `deepest.value` n'ont pas pu être planifiées
  const indexImpasse = Math.max(0, deepest.value)
  const joursNonCouverts: JourNonCouvert[] = steps.slice(indexImpasse).map((s) => {
    // Identifie la contrainte bloquante pour la première étape non couverte
    let contrainteBloquante: string | undefined
    if (s === steps[indexImpasse]) {
      const slot: SlotGarde = { date: s.date, type: s.type, saison: s.saison }
      const premierKo = vets
        .map((v) => isValid(slot, v, s.role, vets, { attributions: [] }))
        .find((r) => !r.valid)
      contrainteBloquante = premierKo?.raison
    }
    return { date: s.date, type: s.type, role: s.role, contrainteBloquante }
  })

  return {
    success: false,
    joursNonCouverts,
    planningPartiel: { attributions: [] },
    dureeMs,
  }
}

// ── Wrapper Supabase (à compléter après STORY-006) ───────

/**
 * genererPlanning — Charge les données depuis Supabase et génère le planning.
 *
 * TODO : implémenter le chargement Supabase quand le schéma est disponible.
 * Requiert les tables : periodes, veterinaires, contraintes, conges, bonus_malus.
 *
 * @param _periodeId  UUID de la période à planifier
 */
export async function genererPlanning(_periodeId: string): Promise<SolveResult> {
  throw new Error(
    'genererPlanning() nécessite le schéma Supabase (STORY-006). Utiliser genererPlanningPur() pour les tests.'
  )
}
