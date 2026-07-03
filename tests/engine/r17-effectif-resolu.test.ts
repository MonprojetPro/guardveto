import { describe, it, expect } from 'vitest'
import { gardesVersPlanningPartiel } from '../../src/engine/validation/gardesVersPlanning'
import {
  validerPlanning,
  type ValidationInput,
} from '../../src/engine/validation/validerPlanning'
import type { VetEngine } from '../../src/engine/types'

// ============================================================
// R17 conditionné à l'effectif RÉSOLU — fix audit 2026-07-03
// ============================================================
// AVANT : le validateur déclenchait R17 sur `saison === 'ete'` sans consulter
// `nbVetosSemaineSoir`, contredisant le moteur (slot.besoinSecond) et sa
// propre section COUVERTURE → violations FANTÔMES pour tout cabinet réglé
// à 2 vétos/nuit en été. APRÈS : même précédence que le moteur.
// ============================================================

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

// Mardi isolé : un seul slot semaine_soir attendu sur la période.
const MARDI = '2026-01-06'

const vets = [vet('A', 'Alice'), vet('B', 'Bob')]

/** Planning : une garde de semaine avec 1er ET 2nd. */
const planningAvecSecond = gardesVersPlanningPartiel([
  { date: MARDI, type: 'semaine', premier_id: 'A', second_id: 'B' },
])

function inputPour(saison: 'ete' | 'hiver', nbVetosSemaineSoir?: number): ValidationInput {
  return {
    dateDebut: MARDI,
    dateFin: MARDI,
    saison,
    vets,
    nbVetosSemaineSoir,
  }
}

describe('R17 — conditionné à l\'effectif résolu, pas à la saison', () => {
  it('été + effectif réglé à 2 : un 2nd en semaine est LÉGAL (zéro violation fantôme)', () => {
    const violations = validerPlanning(planningAvecSecond, inputPour('ete', 2))
    expect(violations.filter((v) => v.regle === 'R17')).toEqual([])
    // Cohérence avec la COUVERTURE : premier+second attendus et pourvus.
    expect(violations.filter((v) => v.regle === 'COUVERTURE')).toEqual([])
  })

  it('été sans réglage (repli saison → 1) : un 2nd déclenche R17 (comportement historique conservé)', () => {
    const violations = validerPlanning(planningAvecSecond, inputPour('ete'))
    const r17 = violations.filter((v) => v.regle === 'R17')
    expect(r17).toHaveLength(1)
    expect(r17[0].vetId).toBe('B')
    expect(r17[0].date).toBe(MARDI)
  })

  it('hiver + effectif réglé à 1 : un 2nd déclenche R17 (nouvelle capacité, alignée moteur)', () => {
    const violations = validerPlanning(planningAvecSecond, inputPour('hiver', 1))
    expect(violations.filter((v) => v.regle === 'R17')).toHaveLength(1)
  })

  it('hiver sans réglage (repli saison → 2) : pas de R17', () => {
    const violations = validerPlanning(planningAvecSecond, inputPour('hiver'))
    expect(violations.filter((v) => v.regle === 'R17')).toEqual([])
  })
})
