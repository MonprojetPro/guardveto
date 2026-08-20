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
  attributions: [{ date: LUN, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] }],
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
      { date: LUN, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
      { date: MAR, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
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

// ============================================================
// Le couple vendredi soir ↔ week-end n'est PAS un enchaînement
// ============================================================
// Celui qui prend le week-end prend AUSSI le vendredi soir : R9 (même binôme)
// l'y oblige. Ces deux créneaux sont donc TOUJOURS à un jour d'écart.
//
// Sans exception, « au moins 2 jours entre deux gardes » se déclenchait sur
// CHAQUE week-end. Deux dégâts (recette MiKL du 2026-08-20) :
//   1. la pénalité, dépensée dix fois sur du normal, ne pesait plus rien face
//      aux VRAIS enchaînements — Antoine s'est retrouvé de garde les 16, 17
//      ET 18 novembre ;
//   2. la règle ne pouvait pas être durcie : en « Jamais », elle aurait rendu
//      tout week-end impossible à attribuer.
//
// Ces tests figent l'exception. S'ils cassent, la règle est redevenue un
// détecteur de fumée au-dessus de la plaque de cuisson.

const VEN = '2026-01-09', SAM = '2026-01-10'

describe('espacement_min — le couple structurel vendredi ↔ week-end', () => {
  const planningVendredi: PlanningPartiel = {
    attributions: [
      { date: VEN, type: 'vendredi_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
    ],
  }
  const slotWeekend = (date: string): SlotGarde =>
    ({ date, type: 'weekend', saison: 'hiver', besoinSecond: false })

  // ⚠️ Le rôle visé est SECOND, pas premier : R8 inverse les rôles entre le
  //    vendredi et le week-end. Le poser « premier » des deux côtés ferait
  //    échouer le test sur R8 — et non sur l'espacement qu'on veut prouver.
  it('le week-end reste attribuable au titulaire du vendredi, même en règle DURE', () => {
    const v = vetAvecEspacement(2, 2)
    expect(isValid(slotWeekend(SAM), v, 'second', [v], planningVendredi).valid).toBe(true)
  })

  it('et il n’est pas non plus PÉNALISÉ quand la règle est molle', () => {
    const v = vetAvecEspacement(2, 4)
    expect(penaliteContraintesConfig(slotWeekend(SAM), v, 'second', planningVendredi)).toBe(0)
  })

  it('le validateur indépendant ne signale pas ce couple', () => {
    const v = vetAvecEspacement(2, 2)
    const planning: PlanningPartiel = {
      attributions: [
        ...planningVendredi.attributions,
        { date: SAM, type: 'weekend', placements: [{ role: 'premier', vetId: null }, { role: 'second', vetId: 'v' }] },
      ],
    }
    const violations = validerPlanning(planning, {
      dateDebut: VEN, dateFin: '2026-01-18', saison: 'hiver', nbVetosSemaineSoir: 1, vets: [v],
    })
    expect(violations.some((x) => x.regle === 'ESPACEMENT')).toBe(false)
  })

  it('MAIS un vrai enchaînement reste refusé — jeudi puis vendredi', () => {
    // Le garde-fou de l'exception : elle ne doit blanchir QUE le couple lié.
    // Jeudi soir + vendredi soir, ce sont bien deux nuits d'affilée subies.
    const v = vetAvecEspacement(2, 2)
    const planningJeudi: PlanningPartiel = {
      attributions: [
        { date: '2026-01-08', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
      ],
    }
    const slotVendredi: SlotGarde = { date: VEN, type: 'vendredi_soir', saison: 'hiver', besoinSecond: false }
    expect(isValid(slotVendredi, v, 'premier', [v], planningJeudi).valid).toBe(false)
  })

  it('MAIS deux soirs de semaine consécutifs restent refusés', () => {
    const v = vetAvecEspacement(2, 2)
    expect(isValid(slot(MAR), v, 'premier', [v], planningLun).valid).toBe(false)
  })
})
