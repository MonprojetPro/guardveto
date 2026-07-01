// ============================================================
// GUARDVETO — Déterminisme PAR DÉFAUT du solver (Lot 1 — Dette B)
// ============================================================
// Le solver doit être REPRODUCTIBLE avec les réglages PAR DÉFAUT (sans
// lnsTimeoutMs imposé), LNS compris. C'est l'invariant exigé par la route
// /api/generate/replay : « même entrée → même planning ».
//
// AVANT le fix : le LNS s'arrêtait sur performance.now()-t0 >= timeoutMs
// (défaut 30 000 ms) → nombre de passes variable selon le CPU/charge →
// résultat potentiellement différent entre deux runs. Ce test échoue (ou est
// fragile) avant le fix, passe après (critère d'arrêt déterministe).
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur } from '../solver'
import type { SolverInput } from '../solver'
import type { PlanningPartiel, VetEngine } from '../types'
import { VETS_PILOTE, PERIODE_PILOTE, CALENDRIER_PILOTE } from './fixtures-pilote'

/** Input pilote avec LNS ACTIF par défaut (aucun lnsTimeoutMs imposé). */
function makeInputLnsDefaut(): SolverInput {
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
    // PAS de lnsTimeoutMs : on teste le comportement par défaut (LNS actif).
  }
}

function empreinte(planning: PlanningPartiel): string {
  return JSON.stringify(
    [...planning.attributions]
      .sort((a, b) =>
        a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date),
      )
      .map((a) => `${a.date}|${a.type}|${a.placements.map((p) => p.vetId ?? '-').join('|')}`),
  )
}

const TEST_TIMEOUT = 60_000

describe('Déterminisme par défaut (LNS actif) — Dette B', () => {
  it('deux générations par défaut → planning identique', () => {
    const r1 = genererPlanningPur(makeInputLnsDefaut())
    const r2 = genererPlanningPur(makeInputLnsDefaut())
    expect(r1.success && r2.success).toBe(true)
    if (!r1.success || !r2.success) return
    expect(empreinte(r1.planning)).toBe(empreinte(r2.planning))
  }, TEST_TIMEOUT)

  // Preuve que le plafond de passes est un critère d'arrêt DÉTERMINISTE :
  // couper à un petit nombre de passes (lnsMaxPasses bas) donne le MÊME
  // résultat entre deux runs (impossible à garantir avec une coupe au chrono,
  // car le nombre de passes y dépendrait du CPU).
  it('lnsMaxPasses borné → résultat reproductible entre deux runs', () => {
    const mk = (): SolverInput => ({ ...makeInputLnsDefaut(), lnsMaxPasses: 2 })
    const r1 = genererPlanningPur(mk())
    const r2 = genererPlanningPur(mk())
    expect(r1.success && r2.success).toBe(true)
    if (!r1.success || !r2.success) return
    expect(empreinte(r1.planning)).toBe(empreinte(r2.planning))
  }, TEST_TIMEOUT)

  // Le plafond doit aussi être cohérent avec la convergence : un plafond TRÈS
  // élevé (≥ convergence) donne le même résultat que le défaut (les deux
  // s'arrêtent en réalité à la convergence, jamais au plafond).
  it('plafond élevé == défaut (les deux convergent avant le plafond)', () => {
    const rDefaut = genererPlanningPur(makeInputLnsDefaut())
    const rHaut = genererPlanningPur({ ...makeInputLnsDefaut(), lnsMaxPasses: 500 })
    expect(rDefaut.success && rHaut.success).toBe(true)
    if (!rDefaut.success || !rHaut.success) return
    expect(empreinte(rDefaut.planning)).toBe(empreinte(rHaut.planning))
  }, TEST_TIMEOUT)
})
