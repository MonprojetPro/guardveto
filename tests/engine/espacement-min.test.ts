// ============================================================
// GUARDVETO — Brique `espacement_min` : écart minimal entre deux gardes
// ============================================================
// « au moins X jours entre deux gardes » d'un même véto (anti nuits enchaînées).
// Réglable : dure (étage ≤ 2 → bloque) ou molle (étage ≥ 3 → pénalise).
// Aucune règle de ce type n'est posée pour le cabinet pilote — on teste la
// CAPACITÉ.
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid, penaliteContraintesConfig } from '@/engine/rules/hard-constraints'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, SlotGarde, PlanningPartiel, ContrainteEngine } from '@/engine/types'

const LUN = '2026-01-05', MAR = '2026-01-06', MER = '2026-01-07'

function vetAvecEspacement(ecart: number, force: number) {
  const config: Record<string, unknown> = {
    brique: 'espacement_min', force, params: { ecart_min_jours: ecart },
  }
  const v: VetEngine = {
    id: 'v', prenom: 'Victor', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'e1', type: 'espacement_min', actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

const slot = (date: string): SlotGarde => ({ date, type: 'semaine_soir', saison: 'hiver', besoinSecond: false })

// Victor déjà de garde lundi.
const planningLun: PlanningPartiel = {
  attributions: [{ date: LUN, type: 'semaine_soir', premier_id: 'v', second_id: null }],
}

describe('espacement_min — DUR (étage 2)', () => {
  it('refuse une garde le lendemain (écart 1 < 2)', () => {
    const v = vetAvecEspacement(2, 2)
    const r = isValid(slot(MAR), v, 'premier', [v], planningLun)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/ESPACEMENT/)
  })

  it('autorise une garde 2 jours après (écart 2 ≥ 2)', () => {
    const v = vetAvecEspacement(2, 2)
    expect(isValid(slot(MER), v, 'premier', [v], planningLun).valid).toBe(true)
  })
})

describe('espacement_min — MOU (étage 4) : ne bloque pas, mais pénalise', () => {
  it('autorise le lendemain mais ajoute une pénalité', () => {
    const v = vetAvecEspacement(2, 4)
    expect(isValid(slot(MAR), v, 'premier', [v], planningLun).valid).toBe(true)
    expect(penaliteContraintesConfig(slot(MAR), v, 'premier', planningLun)).toBeGreaterThan(0)
  })
})

describe('espacement_min — validateur indépendant', () => {
  const planningLunMar: PlanningPartiel = {
    attributions: [
      { date: LUN, type: 'semaine_soir', premier_id: 'v', second_id: null },
      { date: MAR, type: 'semaine_soir', premier_id: 'v', second_id: null },
    ],
  }
  const input = { dateDebut: LUN, dateFin: '2026-01-11', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }

  it('signale deux gardes trop rapprochées quand la règle est DURE', () => {
    const v = vetAvecEspacement(2, 2)
    const violations = validerPlanning(planningLunMar, { ...input, vets: [v] })
    expect(violations.some((x) => x.regle === 'ESPACEMENT' && x.vetId === 'v')).toBe(true)
  })

  it('ne signale RIEN quand la règle est MOLLE', () => {
    const v = vetAvecEspacement(2, 4)
    const violations = validerPlanning(planningLunMar, { ...input, vets: [v] })
    expect(violations.some((x) => x.regle === 'ESPACEMENT')).toBe(false)
  })
})
