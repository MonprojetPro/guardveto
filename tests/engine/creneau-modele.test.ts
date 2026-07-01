import { describe, it, expect } from 'vitest'
import {
  typeGardePourJourCatalogue,
  creneauCouvreJour,
  type CreneauModele,
} from '@/engine/creneau-modele'
import { typeGardePourJour } from '@/engine/structure-creneaux'

function cm(over: Partial<CreneauModele>): CreneauModele {
  return {
    id: 'x',
    code: null,
    nom: '',
    joursSemaine: [],
    surFeries: false,
    heureDebut: '18:30',
    heureFin: '08:30',
    offsetJoursFin: 1,
    nbPlaces: 2,
    roles: ['premier', 'second'],
    actif: true,
    ordre: 0,
    ...over,
  }
}

// Catalogue PAR DÉFAUT = miroir exact du seed des 4 types (migration P1).
const DEFAUT: CreneauModele[] = [
  cm({ code: 'semaine_soir', joursSemaine: [1, 2, 3, 4], ordre: 1 }),
  cm({ code: 'vendredi_soir', joursSemaine: [5], ordre: 2 }),
  cm({ code: 'weekend', joursSemaine: [6], heureDebut: '08:30', offsetJoursFin: 2, ordre: 3 }),
  cm({ code: 'ferie', joursSemaine: [], surFeries: true, heureDebut: '08:30', ordre: 4 }),
]

// ============================================================
// P2 — LE test qui autorise la bascule du moteur :
// pour le catalogue par défaut, la dérivation catalogue DOIT donner
// EXACTEMENT le même mapping jour→type que le code en dur actuel.
// ============================================================
describe('P2 — dérivation catalogue ≡ mapping en dur (catalogue par défaut)', () => {
  for (let idx = 0; idx <= 6; idx++) {
    it(`jour ${idx} : typeGardePourJourCatalogue == typeGardePourJour`, () => {
      expect(typeGardePourJourCatalogue(DEFAUT, idx)).toBe(typeGardePourJour(idx))
    })
  }
})

describe('creneauCouvreJour', () => {
  it('un créneau de semaine couvre lun-jeu, pas le week-end', () => {
    const c = DEFAUT[0]
    expect(creneauCouvreJour(c, 2, false)).toBe(true)
    expect(creneauCouvreJour(c, 6, false)).toBe(false)
  })
  it('le créneau férié couvre un jour férié, pas un jour ordinaire', () => {
    const ferie = DEFAUT[3]
    expect(creneauCouvreJour(ferie, 2, true)).toBe(true)
    expect(creneauCouvreJour(ferie, 2, false)).toBe(false)
  })
  it('un créneau inactif ne couvre rien', () => {
    expect(creneauCouvreJour(cm({ joursSemaine: [1], actif: false }), 1, false)).toBe(false)
  })
})
