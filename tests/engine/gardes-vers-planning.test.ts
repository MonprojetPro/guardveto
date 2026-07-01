import { describe, it, expect } from 'vitest'
import {
  gardesVersPlanningPartiel,
  type GardeRow,
} from '../../src/engine/validation/gardesVersPlanning'
import {
  validerPlanning,
  type ValidationInput,
} from '../../src/engine/validation/validerPlanning'
import type { VetEngine } from '../../src/engine/types'

// Helpers de construction
function vet(id: string, prenom: string): VetEngine {
  return {
    id,
    nom: prenom,
    prenom,
    statut: 'associe',
    dernier_recours: false,
    contraintes: [],
    conges: [],
  } as VetEngine
}

// Semaine de référence : 2026-01-02 (ven) / 03 (sam) / 04 (dim)
const VEN = '2026-01-02'
const SAM = '2026-01-03'

describe('gardesVersPlanningPartiel — reconstruction fidèle (Chantier B)', () => {
  it('un week-end génère le week-end (rôles natifs) + le vendredi (rôles INVERSÉS)', () => {
    const gardes: GardeRow[] = [
      { date: SAM, type: 'weekend', premier_id: 'A', second_id: 'B' },
    ]
    const { attributions } = gardesVersPlanningPartiel(gardes)

    const we = attributions.find((a) => a.type === 'weekend')
    const ven = attributions.find((a) => a.type === 'vendredi_soir')

    expect(we).toEqual({
      date: SAM, type: 'weekend',
      placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }],
    })
    // R8 : le 1er du WE (A) devient 2nd le vendredi ; le 2nd (B) devient 1er.
    expect(ven).toEqual({
      date: VEN, type: 'vendredi_soir',
      placements: [{ role: 'premier', vetId: 'B' }, { role: 'second', vetId: 'A' }],
    })
  })

  it('une garde semaine → semaine_soir (rôles natifs), pas de vendredi synthétisé', () => {
    const gardes: GardeRow[] = [
      { date: '2026-01-06', type: 'semaine', premier_id: 'A', second_id: 'B' },
    ]
    const { attributions } = gardesVersPlanningPartiel(gardes)
    expect(attributions).toEqual([
      {
        date: '2026-01-06', type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }],
      },
    ])
  })

  it('un férié en semaine → semaine_soir', () => {
    const gardes: GardeRow[] = [
      { date: '2026-01-01', type: 'ferie', premier_id: 'A', second_id: 'B' },
    ]
    const { attributions } = gardesVersPlanningPartiel(gardes)
    expect(attributions[0].type).toBe('semaine_soir')
  })
})

describe('Reconstruction + validerPlanning — pas de violation fantôme', () => {
  const vets = [vet('A', 'Alice'), vet('B', 'Bob')]
  const inputBase: ValidationInput = {
    dateDebut: VEN,
    dateFin: '2026-01-04',
    saison: 'hiver',
    vets,
    // structureConfig absent → défaut = R8/R9 EN DUR (le cas le plus strict)
  }

  it('un week-end valide ne lève AUCUNE violation R8/R9 ni « vendredi non couvert »', () => {
    const planning = gardesVersPlanningPartiel([
      { date: SAM, type: 'weekend', premier_id: 'A', second_id: 'B' },
    ])
    const violations = validerPlanning(planning, inputBase)
    expect(violations).toEqual([])
  })

  it('un congé validé chevauchant une garde est bien détecté (R16)', () => {
    const vetsAvecConge = [
      { ...vet('A', 'Alice'), conges: [{ date_debut: SAM, date_fin: SAM, type: 'vacances' }] } as VetEngine,
      vet('B', 'Bob'),
    ]
    const planning = gardesVersPlanningPartiel([
      { date: SAM, type: 'weekend', premier_id: 'A', second_id: 'B' },
    ])
    const violations = validerPlanning(planning, { ...inputBase, vets: vetsAvecConge })
    expect(violations.some((v) => v.regle === 'R16' && v.vetId === 'A')).toBe(true)
  })
})
