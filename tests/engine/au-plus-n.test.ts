// ============================================================
// GUARDVETO — Brique `au_plus_n` : limite de charge réglable
// ============================================================
// « au plus N gardes par fenêtre » (semaine civile par défaut). Réglable :
// dure (étage ≤ 2 → bloque) ou molle (étage ≥ 3 → pénalise sans bloquer).
// Couvre le cas signalé (un véto enchaîne trop de gardes dans la semaine).
//
// NB : aucune règle de ce type n'est posée pour le cabinet pilote — on teste
// seulement que la CAPACITÉ fonctionne quand un cabinet la configurera.
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid, penaliteContraintesConfig } from '@/engine/rules/hard-constraints'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, SlotGarde, PlanningPartiel, ContrainteEngine } from '@/engine/types'

// Semaine ISO : 2026-01-05 (lun) … 2026-01-11 (dim).
const LUN = '2026-01-05', MAR = '2026-01-06', MER = '2026-01-07'

function vetAvecLimite(n: number, force: number): ReturnType<typeof normaliserContraintesVets>[number] {
  const config: Record<string, unknown> = {
    brique: 'au_plus_n', force, params: { n, fenetre: 'semaine_civile' },
  }
  const v: VetEngine = {
    id: 'v', prenom: 'Victor', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'l1', type: 'au_plus_n', actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

const slot = (date: string): SlotGarde => ({ date, type: 'semaine_soir', saison: 'hiver', besoinSecond: false })

// Planning : Victor déjà de garde lundi + mardi (2 gardes dans la semaine).
const planning2: PlanningPartiel = {
  attributions: [
    { date: LUN, type: 'semaine_soir', premier_id: 'v', second_id: null },
    { date: MAR, type: 'semaine_soir', premier_id: 'v', second_id: null },
  ],
}

describe('au_plus_n — DUR (étage 2) : bloque le dépassement', () => {
  it('refuse une 3e garde dans la même semaine (max 2)', () => {
    const v = vetAvecLimite(2, 2)
    const r = isValid(slot(MER), v, 'premier', [v], planning2)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/AU_PLUS_N/)
  })

  it('autorise la 2e garde (sous la limite)', () => {
    const v = vetAvecLimite(2, 2)
    const planning1: PlanningPartiel = { attributions: [planning2.attributions[0]] }
    expect(isValid(slot(MAR), v, 'premier', [v], planning1).valid).toBe(true)
  })
})

describe('au_plus_n — MOU (étage 4) : ne bloque pas, mais pénalise', () => {
  it('autorise la 3e garde mais ajoute une pénalité', () => {
    const v = vetAvecLimite(2, 4)
    expect(isValid(slot(MER), v, 'premier', [v], planning2).valid).toBe(true)
    expect(penaliteContraintesConfig(slot(MER), v, 'premier', planning2)).toBeGreaterThan(0)
  })
})

describe('au_plus_n — validateur indépendant', () => {
  const planning3: PlanningPartiel = {
    attributions: [
      { date: LUN, type: 'semaine_soir', premier_id: 'v', second_id: null },
      { date: MAR, type: 'semaine_soir', premier_id: 'v', second_id: null },
      { date: MER, type: 'semaine_soir', premier_id: 'v', second_id: null },
    ],
  }
  const input = { dateDebut: LUN, dateFin: '2026-01-11', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }

  it('signale le dépassement quand la règle est DURE', () => {
    const v = vetAvecLimite(2, 2)
    const violations = validerPlanning(planning3, { ...input, vets: [v] })
    expect(violations.some((x) => x.regle === 'AU_PLUS_N' && x.vetId === 'v')).toBe(true)
  })

  it('ne signale RIEN quand la règle est MOLLE (préférence)', () => {
    const v = vetAvecLimite(2, 4)
    const violations = validerPlanning(planning3, { ...input, vets: [v] })
    expect(violations.some((x) => x.regle === 'AU_PLUS_N')).toBe(false)
  })
})
