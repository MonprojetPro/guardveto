// ============================================================
// GUARDVETO — Sonde de mutation de l'input (Lot 1 — Dette A)
// ============================================================
// HYPOTHÈSE À PROUVER (TILT — observer avant de fixer) :
//   genererPlanningPur MUTE-t-il encore son input ?
//
// Méthode : on construit un input pilote, on en fige une COPIE PROFONDE de
// référence AVANT l'appel, on appelle genererPlanningPur(input), puis on
// compare input à la référence APRÈS (deep equal). Toute divergence = mutation.
//
// Si AUCUNE mutation → la dette est close (normaliserContraintesVets est
// devenue pure) → ce test devient le filet de non-régression permanent.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur } from '../solver'
import type { SolverInput } from '../solver'
import type { VetEngine } from '../types'
import { VETS_PILOTE, PERIODE_PILOTE, CALENDRIER_PILOTE } from './fixtures-pilote'

// Input pilote SANS structuredClone défensif : on veut savoir si le solver
// touche aux objets qu'on lui passe. seed greedy (lnsTimeoutMs:0) suffit pour
// la sonde — le LNS re-normalise le même input, donc s'il y a mutation elle
// se produit dès le seed.
function inputPilote(): SolverInput {
  return {
    dateDebut: PERIODE_PILOTE.dateDebut,
    dateFin: PERIODE_PILOTE.dateFin,
    saison: PERIODE_PILOTE.saison,
    vets: VETS_PILOTE.map((v) => ({
      ...v,
      contraintes: v.contraintes.map((c) => ({ ...c, config: structuredClone(c.config) })),
      conges: v.conges.map((g) => ({ ...g })),
    })) as VetEngine[],
    bonusMalus: {},
    calendrier: {
      feries: new Set(CALENDRIER_PILOTE.feries),
      vacancesScolaires: CALENDRIER_PILOTE.vacancesScolaires.map((v) => ({ ...v })),
    },
    lnsTimeoutMs: 0,
  }
}

const TEST_TIMEOUT = 30_000

describe('genererPlanningPur — pureté de l’input (Dette A)', () => {
  it('ne mute pas son input (deep equal avant/après)', () => {
    const input = inputPilote()
    const refAvant = structuredClone(input)

    genererPlanningPur(input)

    // Comparaison profonde : aucun champ de l'input ne doit avoir bougé.
    expect(input).toEqual(refAvant)
  }, TEST_TIMEOUT)

  it('ne mute pas l’input même avec le LNS actif', () => {
    const input = { ...inputPilote(), lnsTimeoutMs: undefined }
    const refAvant = structuredClone(input)

    genererPlanningPur(input)

    expect(input).toEqual(refAvant)
  }, TEST_TIMEOUT)
})
