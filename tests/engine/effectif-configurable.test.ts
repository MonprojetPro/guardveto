// ============================================================
// GUARDVETO — Effectif configurable (Vague 1 structurelles)
// ============================================================
// L'effectif de garde la nuit en semaine (1 ou 2 vétos) est désormais piloté
// par la config (nbVetosSemaineSoir / slot.besoinSecond), INDÉPENDAMMENT de la
// saison. Défaut absent = repli saison (hiver 2 / été 1) → comportement legacy.
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid } from '@/engine/rules/hard-constraints'
import { genererPlanningPur } from '@/engine/solver'
import { premierId, secondId } from '@/engine/attribution'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { SlotGarde, PlanningPartiel, VetEngine, VetEngineNormalise } from '@/engine/types'

const planningVide: PlanningPartiel = { attributions: [] }
const slotSemaine = (besoinSecond?: boolean, saison: 'ete' | 'hiver' = 'ete'): SlotGarde => ({
  date: '2026-07-07', type: 'semaine_soir', saison, besoinSecond, // 2026-07-07 = mardi
})

function vet(id: string): VetEngineNormalise {
  return normaliserContraintesVets([
    { id, nom: id, prenom: id, statut: 'salarie', dernier_recours: false, contraintes: [], conges: [] },
  ])[0]
}

describe('Effectif configurable — R17/R18 pilotés par besoinSecond', () => {
  it('été + besoinSecond=true → le 2nd est AUTORISÉ (effectif forcé à 2)', () => {
    const v = vet('a')
    expect(isValid(slotSemaine(true, 'ete'), v, 'second', [v], planningVide).valid).toBe(true)
  })

  it('été sans config (legacy) → le 2nd est REFUSÉ (repli saison = 1)', () => {
    const v = vet('a')
    expect(isValid(slotSemaine(undefined, 'ete'), v, 'second', [v], planningVide).valid).toBe(false)
  })

  it('hiver + besoinSecond=false → le 2nd est REFUSÉ (effectif forcé à 1)', () => {
    const v = vet('a')
    const r = isValid(slotSemaine(false, 'hiver'), v, 'second', [v], planningVide)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/R17/)
  })
})

describe('Effectif configurable — génération de bout en bout', () => {
  const vets = ['a', 'b', 'c', 'd', 'e'].map(vet)
  // Une semaine (lundi 2026-07-06 → dimanche 2026-07-12).
  const base = { dateDebut: '2026-07-06', dateFin: '2026-07-12', vets, bonusMalus: {}, lnsTimeoutMs: 0 }

  it('hiver nbVetosSemaineSoir=1 → aucune nuit de semaine n\'a de 2nd', () => {
    const res = genererPlanningPur({ ...base, saison: 'hiver', nbVetosSemaineSoir: 1 })
    expect(res.success).toBe(true)
    if (!res.success) return
    const nuits = res.planning.attributions.filter((a) => a.type === 'semaine_soir')
    expect(nuits.length).toBeGreaterThan(0)
    expect(nuits.every((a) => secondId(a) === null)).toBe(true)
  })

  it('été nbVetosSemaineSoir=2 → chaque nuit de semaine a un 2nd', () => {
    const res = genererPlanningPur({ ...base, saison: 'ete', nbVetosSemaineSoir: 2 })
    expect(res.success).toBe(true)
    if (!res.success) return
    const nuits = res.planning.attributions.filter((a) => a.type === 'semaine_soir')
    expect(nuits.length).toBeGreaterThan(0)
    expect(nuits.every((a) => premierId(a) !== null && secondId(a) !== null)).toBe(true)
  })
})
