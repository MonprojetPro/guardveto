// ============================================================
// GUARDVETO — Solver greedy V1 + LNS
// ============================================================
// Génère un planning complet et optimal pour une période donnée.
//
// Architecture (V2) :
//   1. genererSeedGreedy(input)  → solution initiale via backtracking
//   2. lnsHillClimbing(seed, input) → amélioration par LNS (destroy-repair)
//   3. genererPlanningPur(input) → orchestre seed + LNS
//
// Algorithme LNS (hill-climbing systématique, neighborhood = 1 semaine) :
//   - Détruire : supprimer toutes les attributions d'une semaine
//   - Réparer   : greedy pur sur les créneaux de cette semaine
//   - Accepter  : comparerScores(nouveau, actuel) < 0 (amélioration stricte)
//   - Itérer    : passes successives sur toutes les semaines → convergence
//
// API publique inchangée (compatible V1) :
//   - SolverInput   → ajoute le champ optionnel lnsTimeoutMs
//   - SolveResult   → inchangé
//   - genererPlanningPur(input)  → orchestration modifiée (seed + LNS)
//   - genererPlanning(periodeId) → inchangée (async, placeholder Supabase)
// ============================================================

import type {
  VetEngine,
  SlotGarde,
  PlanningPartiel,
  TypeGardeEngine,
  RoleGarde,
  Saison,
  AttributionGarde,
  CalendrierResolu,
} from './types'
import { jourIndex, addDays, estJourFerie, lundiDeSemaine } from './utils'
import { normaliserContraintesVets } from './normaliserContraintes'
import { isValid } from './rules/hard-constraints'
import { penalite } from './rules/soft-constraints'
import { compterParVet } from './rules/optimization'
import { comparerScores, scorerPlanning, type VecteurScore, type BonusMalusMap } from './score-lexicographique'

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
  /** Budget temps pour la phase LNS en ms (défaut 30 000). */
  lnsTimeoutMs?: number
  /** Données calendaires résolues depuis Supabase. Fallback sur les listes en dur si absent. */
  calendrier?: CalendrierResolu
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
  allVets: VetEngine[],
  calendrier?: CalendrierResolu
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
    planning,
    calendrier
  )

  if (step.type === 'weekend' || step.type === 'vendredi_soir') {
    // R11 + R20 : équité WE — bonus/malus réduit le compteur effectif
    // Si bm > 0 (véto doit plus de gardes), son score est réduit → essayé avant
    const weEffectif = c.weGardes - bm

    // R11b : équité du rôle 1er le week-end (avantage financier).
    let malusRole = 0
    if (step.type === 'vendredi_soir' && step.role === 'second') {
      malusRole = c.weekendPremier * POIDS_LNS.WE_PREMIER_ROLE
    } else if (step.type === 'vendredi_soir' && step.role === 'premier') {
      malusRole = -c.weekendPremier * POIDS_LNS.WE_PREMIER_ROLE
    }

    return weEffectif * POIDS_LNS.WE_GARDE + malusRole + pen
  }

  // Garde de semaine : priorité selon le type de jour et le rôle
  if (estJourFerie(step.date, calendrier)) {
    // R12 : équité fériés
    return c.feriesGardes * POIDS_LNS.FERIES + pen
  }

  if (step.role === 'premier') {
    // R13 : équité gardes semaine en 1er
    return c.semainePremier * POIDS_LNS.SEMAINE_PREMIER + pen
  }

  // R14 : équité 2nd de garde
  return c.semaineSecond * POIDS_LNS.SEMAINE_SECOND + pen
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
  deepest: { value: number },
  calendrier?: CalendrierResolu
): PlanningPartiel | null {
  // Cas de base : toutes les étapes sont planifiées
  if (index === steps.length) return planning

  // Trace de profondeur pour les diagnostics d'impasse
  if (index > deepest.value) deepest.value = index

  const step = steps[index]
  const slot: SlotGarde = { date: step.date, type: step.type, saison: step.saison }

  // Candidats valides (contraintes dures) triés par score (équité + pénalités)
  const candidates = vets
    .filter((vet) => isValid(slot, vet, step.role, vets, planning, calendrier).valid)
    .sort(
      (a, b) =>
        scorerCandidat(step, a, planning, bonusMalus, vets, calendrier) -
        scorerCandidat(step, b, planning, bonusMalus, vets, calendrier)
    )

  // Essaie chaque candidat dans l'ordre de priorité
  for (const vet of candidates) {
    const newPlanning = assignerStep(planning, step, vet.id)
    const result = backtrack(steps, index + 1, newPlanning, vets, bonusMalus, deepest, calendrier)
    if (result !== null) return result
  }

  // Aucun candidat n'a mené à une solution → backtrack
  return null
}

// ── Seed greedy (wrapper du backtracking existant) ────────

/**
 * genererSeedGreedy — Génère la solution initiale via backtracking greedy.
 * Renommé depuis l'ancien genererPlanningPur ; sert de seed pour le LNS.
 */
function genererSeedGreedy(input: SolverInput): SolveResult {
  const { dateDebut, dateFin, saison, vets, bonusMalus, calendrier } = input
  const t0 = Date.now()

  const steps = genererSteps(dateDebut, dateFin, saison)
  const deepest = { value: -1 }

  const planning = backtrack(
    steps,
    0,
    { attributions: [] },
    vets,
    bonusMalus,
    deepest,
    calendrier
  )

  const dureeMs = Date.now() - t0

  if (planning !== null) {
    return { success: true, planning, dureeMs }
  }

  // Impasse : construit le rapport des jours non couverts
  const indexImpasse = Math.max(0, deepest.value)
  const joursNonCouverts: JourNonCouvert[] = steps.slice(indexImpasse).map((s) => {
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

// ── LNS — utilitaires internes ───────────────────────────

/** Extrait tous les lundis de la période (borne inclusive). */
function extraireLundis(dateDebut: string, dateFin: string): string[] {
  const lundis: string[] = []
  let current = lundiDeSemaine(dateDebut)
  if (current < dateDebut) current = addDays(current, 7)
  while (current <= dateFin) {
    lundis.push(current)
    current = addDays(current, 7)
  }
  return lundis
}

/** Renvoie un planning sans les attributions de la semaine commençant par `lundi`. */
function supprimerSemaine(planning: PlanningPartiel, lundi: string): PlanningPartiel {
  const dimanche = addDays(lundi, 6)
  return {
    attributions: planning.attributions.filter(
      (a) => a.date < lundi || a.date > dimanche
    ),
  }
}

/** Génère les étapes (steps) d'une semaine donnée (lundi → dimanche inclus). */
function genererStepsSemaine(lundi: string, saison: Saison): SolverStep[] {
  const weSteps: SolverStep[] = []
  const semaineSteps: SolverStep[] = []

  for (let i = 0; i <= 6; i++) {
    const date = addDays(lundi, i)
    const idx = jourIndex(date)
    if (idx === 5) {
      weSteps.push({ date, type: 'vendredi_soir', saison, role: 'premier' })
      weSteps.push({ date, type: 'vendredi_soir', saison, role: 'second' })
    } else if (idx === 6) {
      weSteps.push({ date, type: 'weekend', saison, role: 'premier' })
      weSteps.push({ date, type: 'weekend', saison, role: 'second' })
    } else if (idx >= 1 && idx <= 4) {
      semaineSteps.push({ date, type: 'semaine_soir', saison, role: 'premier' })
      if (saison === 'hiver') {
        semaineSteps.push({ date, type: 'semaine_soir', saison, role: 'second' })
      }
    }
    // Dimanche : couvert par le WE du samedi
  }

  return [...weSteps, ...semaineSteps]
}

/** Scoring LNS — indépendant du bonusMalus (optim intra-période). */
const POIDS_LNS = {
  WE_GARDE: 100,
  WE_PREMIER_ROLE: 25,
  FERIES: 60,
  SEMAINE_PREMIER: 30,
  SEMAINE_SECOND: 10,
} as const

function scorerCandidatLNS(
  step: SolverStep,
  vet: VetEngine,
  planning: PlanningPartiel,
  allVets: VetEngine[],
  calendrier?: CalendrierResolu
): number {
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

  const pen = penalite(
    { date: step.date, type: step.type, saison: step.saison },
    vet,
    step.role,
    planning,
    calendrier
  )

  if (step.type === 'weekend' || step.type === 'vendredi_soir') {
    let malusRole = 0
    if (step.type === 'vendredi_soir' && step.role === 'second') {
      malusRole = c.weekendPremier * POIDS_LNS.WE_PREMIER_ROLE
    } else if (step.type === 'vendredi_soir' && step.role === 'premier') {
      malusRole = -c.weekendPremier * POIDS_LNS.WE_PREMIER_ROLE
    }
    return c.weGardes * POIDS_LNS.WE_GARDE + malusRole + pen
  }
  if (estJourFerie(step.date, calendrier)) return c.feriesGardes * POIDS_LNS.FERIES + pen
  if (step.role === 'premier') return c.semainePremier * POIDS_LNS.SEMAINE_PREMIER + pen
  return c.semaineSecond * POIDS_LNS.SEMAINE_SECOND + pen
}

/** Réparation greedy d'une semaine détruite. Retourne null si impasse. */
function repairerSemaine(
  partialPlanning: PlanningPartiel,
  steps: SolverStep[],
  vets: VetEngine[],
  calendrier?: CalendrierResolu
): PlanningPartiel | null {
  let planning = partialPlanning

  for (const step of steps) {
    const slot: SlotGarde = { date: step.date, type: step.type, saison: step.saison }
    const valids = vets.filter((v) => isValid(slot, v, step.role, vets, planning, calendrier).valid)

    if (valids.length === 0) return null

    const sorted = [...valids].sort(
      (a, b) =>
        scorerCandidatLNS(step, a, planning, vets, calendrier) -
        scorerCandidatLNS(step, b, planning, vets, calendrier)
    )

    const attributions = [...planning.attributions]
    const idx = attributions.findIndex(
      (a) => a.date === step.date && a.type === step.type
    )
    if (idx >= 0) {
      attributions[idx] = {
        ...attributions[idx],
        [step.role === 'premier' ? 'premier_id' : 'second_id']: sorted[0].id,
      }
    } else {
      const nouv: AttributionGarde = {
        date: step.date,
        type: step.type,
        premier_id: step.role === 'premier' ? sorted[0].id : null,
        second_id: step.role === 'second' ? sorted[0].id : null,
      }
      attributions.push(nouv)
    }
    planning = { attributions }
  }

  return planning
}

// ── Score incrémental par semaine ────────────────────────

/**
 * scorerSemaine — calcule le VecteurScore en ne considérant que
 * les attributions appartenant à la semaine commençant par `lundi`.
 *
 * C'est le delta incrémental : évite de recalculer tout le planning
 * à chaque itération LNS. Retourne un vecteur partiel (étage EQUITE
 * non inclus car la variance est globale — on utilise scorerPlanning
 * complet pour les comparaisons finales).
 */
export function scorerSemaine(
  planning: PlanningPartiel,
  lundi: string,
  vets: VetEngine[],
  saison: Saison
): VecteurScore {
  const dimanche = addDays(lundi, 6)
  const planSemaine: PlanningPartiel = {
    attributions: planning.attributions.filter(
      (a) => a.date >= lundi && a.date <= dimanche
    ),
  }
  return scorerPlanning(planSemaine, vets, saison)
}

// ── LNS hill-climbing ────────────────────────────────────

interface LNSHillResult {
  planning: PlanningPartiel
  ameliorations: number
  passesSeches: number
  timeoutAtteint: boolean
}

/**
 * lnsHillClimbing — améliore `seedPlanning` par passes successives LNS.
 * Neighborhood = 1 semaine (destroy-repair greedy).
 * Critère d'acceptation : comparerScores(nouveau, actuel) < 0 (strict).
 */
function lnsHillClimbing(
  seedPlanning: PlanningPartiel,
  input: SolverInput,
  t0: number
): LNSHillResult {
  const { dateDebut, dateFin, saison, vets, calendrier } = input
  const timeoutMs = input.lnsTimeoutMs ?? 30_000
  const maxPassesSansAmelioration = 3

  let meilleur = seedPlanning
  let scoreMeilleur = scorerPlanning(meilleur, vets, saison)

  const lundis = extraireLundis(dateDebut, dateFin)

  let passesSansAmelioration = 0
  let ameliorations = 0
  let passesSeches = 0
  let timeoutAtteint = false

  while (passesSansAmelioration < maxPassesSansAmelioration) {
    if (performance.now() - t0 >= timeoutMs) {
      timeoutAtteint = true
      break
    }

    let ameliorationCettePasse = false

    for (const lundi of lundis) {
      if (performance.now() - t0 >= timeoutMs) {
        timeoutAtteint = true
        break
      }

      // Détruire : supprimer la semaine
      const partial = supprimerSemaine(meilleur, lundi)
      const steps = genererStepsSemaine(lundi, saison).filter(
        (s) => s.date >= dateDebut && s.date <= dateFin
      )
      if (steps.length === 0) continue

      // Réparer : greedy LNS sur la semaine
      const repaired = repairerSemaine(partial, steps, vets, calendrier)
      if (repaired === null) continue

      // Comparer : garder si strictement amélioré
      const scoreNew = scorerPlanning(repaired, vets, saison)
      if (comparerScores(scoreNew, scoreMeilleur) < 0) {
        meilleur = repaired
        scoreMeilleur = scoreNew
        ameliorations++
        ameliorationCettePasse = true
      }
    }

    if (ameliorationCettePasse) {
      passesSansAmelioration = 0
    } else {
      passesSansAmelioration++
      passesSeches++
    }
  }

  return { planning: meilleur, ameliorations, passesSeches, timeoutAtteint }
}

// ── API publique ─────────────────────────────────────────

/**
 * genererPlanningPur — Solver pur (sans Supabase).
 *
 * Orchestre :
 *   1. Seed greedy (backtracking) → solution initiale équitable
 *   2. LNS hill-climbing → amélioration du score lexicographique
 *
 * Retourne un planning complet ou un rapport d'impasse détaillé.
 * API publique compatible V1 (SolverInput + SolveResult inchangés).
 */
export function genererPlanningPur(input: SolverInput): SolveResult {
  const t0 = performance.now()

  // ── 0. Normalisation des contraintes ─────────────────
  // Hisse config.params.* à la racine pour que TOUS les contrôles lisent la
  // règle, qu'elle soit V1 (plate) ou V2 (sous params). Sans ça, seul le duo
  // était appliqué (bug F4-002). Cf. normaliserContraintes.ts.
  const inputN: SolverInput = { ...input, vets: normaliserContraintesVets(input.vets) }

  // ── 1. Seed greedy ───────────────────────────────────
  const seed = genererSeedGreedy(inputN)

  if (!seed.success) {
    // Impasse backtracking → retourner directement le rapport d'impasse
    return {
      ...seed,
      dureeMs: performance.now() - t0,
    }
  }

  // ── 2. LNS hill-climbing ─────────────────────────────
  const lnsResult = lnsHillClimbing(seed.planning, inputN, t0)

  return {
    success: true,
    planning: lnsResult.planning,
    dureeMs: performance.now() - t0,
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
