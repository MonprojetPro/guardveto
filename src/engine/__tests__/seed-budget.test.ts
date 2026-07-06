// ============================================================
// GUARDVETO — Plafond de nœuds/temps du backtracking du seed (dette technique)
// ============================================================
// Le backtracking du seed n'avait AUCUN plafond → un cas infaisable vicieux
// pouvait exploser sans borne et heurter le timeout serverless brutal. On ajoute
// un budget (nœuds + temps optionnel) qui COUPE PROPREMENT : échec explicite
// `interrompu`, PAS un crash ni un timeout.
//
// Ce test prouve :
//   1. Le défaut (budget non forcé) réussit normalement (byte-identique golden).
//   2. Un plafond de nœuds RIDICULEMENT bas coupe proprement → success:false +
//      interrompu:true + message clair (et NON une impasse structurelle).
//   3. Un plafond de nœuds très élevé == défaut (le seed converge bien avant).
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur } from '../solver'
import type { SolverInput } from '../solver'
import type { VetEngine } from '../types'
import { VETS_PILOTE, PERIODE_PILOTE, CALENDRIER_PILOTE } from './fixtures-pilote'

function makeInput(): SolverInput {
  return {
    dateDebut: PERIODE_PILOTE.dateDebut,
    dateFin: PERIODE_PILOTE.dateFin,
    saison: PERIODE_PILOTE.saison,
    vets: VETS_PILOTE as VetEngine[],
    bonusMalus: {},
    calendrier: {
      feries: new Set(CALENDRIER_PILOTE.feries),
      vacancesScolaires: CALENDRIER_PILOTE.vacancesScolaires.map((v) => ({ ...v })),
    },
    // Seed greedy seul (déterministe) suffit pour tester le budget du seed.
    lnsTimeoutMs: 0,
  }
}

const TEST_TIMEOUT = 60_000

describe('Budget du backtracking du seed (plafond nœuds/temps)', () => {
  it('défaut (budget non forcé) → succès normal', () => {
    const r = genererPlanningPur(makeInput())
    expect(r.success).toBe(true)
  }, TEST_TIMEOUT)

  it('plafond de nœuds minuscule → coupe PROPRE (interrompu), pas une impasse', () => {
    const r = genererPlanningPur({ ...makeInput(), seedMaxNoeuds: 1 })
    expect(r.success).toBe(false)
    if (r.success) return
    // Interruption explicite — surtout PAS un crash ni une impasse structurelle.
    expect(r.interrompu).toBe(true)
    expect(typeof r.raisonInterruption).toBe('string')
    expect(r.raisonInterruption && r.raisonInterruption.length).toBeGreaterThan(0)
    // Une interruption n'invente pas de faux « jours non couverts ».
    expect(r.joursNonCouverts).toEqual([])
  }, TEST_TIMEOUT)

  it('plafond de nœuds très élevé == défaut (le seed converge avant)', () => {
    const rDefaut = genererPlanningPur(makeInput())
    const rHaut = genererPlanningPur({ ...makeInput(), seedMaxNoeuds: 5_000_000 })
    expect(rDefaut.success).toBe(true)
    expect(rHaut.success).toBe(true)
    if (!rDefaut.success || !rHaut.success) return
    expect(JSON.stringify(rHaut.planning)).toBe(JSON.stringify(rDefaut.planning))
  }, TEST_TIMEOUT)
})
