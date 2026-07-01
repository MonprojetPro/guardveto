// ============================================================
// GUARDVETO — P4 slice 2 : R8 (inversion des rôles) généralisée N-places
// ============================================================
// R8 n'est plus câblée sur premier↔second : la règle est « le rôle tenu le
// week-end doit être DIFFÉRENT de celui tenu le vendredi soir ». Pour 2 rôles,
// c'est l'inversion 1er/2nd historique (byte-identique — prouvé par le banc).
// Pour N places, chaque véto doit changer de rôle. Prouvé ici dans les DEUX
// gardiens : la contrainte dure (isValid) ET le validateur indépendant.
//
// (Le COUPLE vendredi_soir↔weekend reste en dur — sa généralisation via
// RelationCreneau viendra avec les structures custom, P5.)
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid } from '@/engine/rules/hard-constraints'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, PlanningPartiel, SlotGarde, AttributionGarde } from '@/engine/types'

const mkVet = (id: string): VetEngine => ({
  id, nom: id.toUpperCase(), prenom: id,
  statut: 'associe', dernier_recours: false, contraintes: [], conges: [],
})
const vets = [mkVet('a'), mkVet('b'), mkVet('x')]
const vetsNorm = normaliserContraintesVets(vets)

const VENDREDI = '2026-01-09' // vendredi
const SAMEDI = '2026-01-10' // samedi (même semaine)

// Vendredi soir à 3 places : A=1er, B=2nd, X=3e.
const attrVendredi: AttributionGarde = {
  date: VENDREDI,
  type: 'vendredi_soir',
  placements: [
    { role: 'premier', vetId: 'a' },
    { role: 'second', vetId: 'b' },
    { role: 'troisieme', vetId: 'x' },
  ],
}
const slotWe: SlotGarde = { date: SAMEDI, type: 'weekend', saison: 'hiver', besoinSecond: true }

describe('P4 slice 2 — R8 dure (isValid) généralisée : le rôle doit changer', () => {
  const planning: PlanningPartiel = { attributions: [attrVendredi] }
  const xNorm = vetsNorm.find((v) => v.id === 'x')!

  it('X (3e vendredi) RESTANT 3e le week-end → refusé (R8)', () => {
    const r = isValid(slotWe, xNorm, 'troisieme', vetsNorm, planning)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/R8/)
  })

  it('X (3e vendredi) prenant un AUTRE rôle (1er) le week-end → accepté', () => {
    const r = isValid(slotWe, xNorm, 'premier', vetsNorm, planning)
    expect(r.valid).toBe(true)
  })
})

describe('P4 slice 2 — R8 validateur indépendant généralisé', () => {
  const input = {
    dateDebut: VENDREDI, dateFin: SAMEDI, saison: 'hiver' as const, vets,
  }

  it('un véto garde son rôle (3e→3e) → 1 seule violation R8, sur lui', () => {
    // A et B permutent (1er↔2nd) mais X reste 3e.
    const weekend: AttributionGarde = {
      date: SAMEDI, type: 'weekend',
      placements: [
        { role: 'premier', vetId: 'b' },
        { role: 'second', vetId: 'a' },
        { role: 'troisieme', vetId: 'x' },
      ],
    }
    const planning: PlanningPartiel = { attributions: [attrVendredi, weekend] }
    const r8 = validerPlanning(planning, input).filter((v) => v.regle === 'R8')
    expect(r8).toHaveLength(1)
    expect(r8[0].vetId).toBe('x')
  })

  it('tous les vétos changent de rôle → aucune violation R8', () => {
    // Rotation complète : A→2nd, B→3e, X→1er (personne ne garde son rôle).
    const weekend: AttributionGarde = {
      date: SAMEDI, type: 'weekend',
      placements: [
        { role: 'premier', vetId: 'x' },
        { role: 'second', vetId: 'a' },
        { role: 'troisieme', vetId: 'b' },
      ],
    }
    const planning: PlanningPartiel = { attributions: [attrVendredi, weekend] }
    const r8 = validerPlanning(planning, input).filter((v) => v.regle === 'R8')
    expect(r8).toHaveLength(0)
  })
})
