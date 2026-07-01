// ============================================================
// GUARDVETO — Brique `espacement_weekend` : fréquence des week-ends
// ============================================================
// « au plus 1 garde de WEEK-END toutes les N semaines » (= 1 WE sur N).
// Interprétation A (espacement). Réglable : dure (étage ≤ 2 → bloque) ou
// molle (étage ≥ 3 → pénalise sans bloquer). Ne concerne QUE les créneaux
// `weekend` — un soir de semaine n'est jamais bloqué par cette règle.
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid, penaliteContraintesConfig } from '@/engine/rules/hard-constraints'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, SlotGarde, PlanningPartiel, ContrainteEngine } from '@/engine/types'

// Samedis consécutifs (2026-01-05 est un lundi → 2026-01-03 = samedi).
const SAT1 = '2026-01-03', SAT2 = '2026-01-10', SAT4 = '2026-01-24'

function vetAvecFrequence(n: number, force: number): ReturnType<typeof normaliserContraintesVets>[number] {
  const config: Record<string, unknown> = {
    brique: 'espacement_weekend', force, params: { n_semaines: n },
  }
  const v: VetEngine = {
    id: 'v', prenom: 'Manon', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'f1', type: 'espacement_weekend', actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

const slotWe = (date: string): SlotGarde => ({ date, type: 'weekend', saison: 'hiver', besoinSecond: true })
const slotSoir = (date: string): SlotGarde => ({ date, type: 'semaine_soir', saison: 'hiver', besoinSecond: false })

// Manon déjà de garde le WE du SAT1.
const planningWe1: PlanningPartiel = {
  attributions: [{ date: SAT1, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] }],
}

describe('espacement_weekend — DUR (étage 2) : « 1 WE sur 3 »', () => {
  it('refuse un WE 2 semaines trop tôt (SAT2, 7 jours après SAT1)', () => {
    const v = vetAvecFrequence(3, 2)
    const r = isValid(slotWe(SAT2), v, 'premier', [v], planningWe1)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/FREQ_WE/)
  })

  it('autorise un WE assez espacé (SAT4, 3 semaines après SAT1)', () => {
    const v = vetAvecFrequence(3, 2)
    expect(isValid(slotWe(SAT4), v, 'premier', [v], planningWe1).valid).toBe(true)
  })

  it('ne s\'applique PAS à un soir de semaine', () => {
    const v = vetAvecFrequence(3, 2)
    expect(isValid(slotSoir('2026-01-06'), v, 'premier', [v], planningWe1).valid).toBe(true)
  })

  it('n_semaines = 1 → inerte (tous les week-ends permis)', () => {
    const v = vetAvecFrequence(1, 2)
    expect(isValid(slotWe(SAT2), v, 'premier', [v], planningWe1).valid).toBe(true)
  })
})

describe('espacement_weekend — MOU (étage 4) : ne bloque pas, mais pénalise', () => {
  it('autorise le WE trop rapproché mais ajoute une pénalité', () => {
    const v = vetAvecFrequence(3, 4)
    expect(isValid(slotWe(SAT2), v, 'premier', [v], planningWe1).valid).toBe(true)
    expect(penaliteContraintesConfig(slotWe(SAT2), v, 'premier', planningWe1)).toBeGreaterThan(0)
  })
})

describe('espacement_weekend — validateur indépendant', () => {
  const planningWe2: PlanningPartiel = {
    attributions: [
      { date: SAT1, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
      { date: SAT2, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
    ],
  }
  const input = { dateDebut: SAT1, dateFin: '2026-02-01', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }

  it('signale deux week-ends trop rapprochés quand la règle est DURE', () => {
    const v = vetAvecFrequence(3, 2)
    const violations = validerPlanning(planningWe2, { ...input, vets: [v] })
    expect(violations.some((x) => x.regle === 'FREQ_WE' && x.vetId === 'v')).toBe(true)
  })

  it('ne signale RIEN quand la règle est MOLLE (préférence)', () => {
    const v = vetAvecFrequence(3, 4)
    const violations = validerPlanning(planningWe2, { ...input, vets: [v] })
    expect(violations.some((x) => x.regle === 'FREQ_WE')).toBe(false)
  })
})
