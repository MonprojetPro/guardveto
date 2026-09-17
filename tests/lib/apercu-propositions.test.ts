// ============================================================
// B-123 — ce que la grille doit dessiner quand Filou propose un changement
// ============================================================
// ⚠️ LE TEST DE LA PREMIÈRE VERSION PASSAIT AU VERT SUR UN CODE CASSÉ. Il
// vérifiait la table intermédiaire (`date → vetId → propId`) sans jamais la
// confronter à l'état réel de la grille — or c'est précisément là que le
// défaut vivait : une case n'était marquée que si la personne qui devait y
// ARRIVER y était DÉJÀ. Chaque test ci-dessous part donc d'un créneau tel que
// la grille l'affiche, jamais des seules propositions.
// ============================================================
import { describe, it, expect } from 'vitest'
import {
  calculerPlacesProposees,
  calculerApercuCreneaux,
  cleCreneau,
} from '@/lib/planning/apercuPropositions'
import type { ChangementPropose } from '@/engine/relecture/arbitrer'

function changement(id: string, affectations: ChangementPropose['affectations']): ChangementPropose {
  return { id, motif: `motif ${id}`, critere: 'epuisement', affectations }
}

describe('calculerPlacesProposees', () => {
  it('met les affectations à plat en gardant le lien vers la proposition', () => {
    const places = calculerPlacesProposees([
      {
        id: 'P1',
        changement: changement('P1', [
          { date: '2026-12-04', type: 'vendredi_soir', role: 'second', vetId: 'fanny' },
          { date: '2026-12-05', type: 'weekend', role: 'premier', vetId: 'fanny' },
        ]),
      },
    ])

    expect(places).toHaveLength(2)
    expect(places[0]).toEqual({
      date: '2026-12-04',
      type: 'vendredi_soir',
      vetId: 'fanny',
      propositionId: 'P1',
    })
  })

  it('conserve les places qui se VIDENT — la v1 les jetait', () => {
    const places = calculerPlacesProposees([
      {
        id: 'P1',
        changement: changement('P1', [
          { date: '2026-12-04', type: 'semaine_soir', role: 'second', vetId: null },
        ]),
      },
    ])

    expect(places).toHaveLength(1)
    expect(places[0].vetId).toBeNull()
  })
})

describe('calculerApercuCreneaux', () => {
  it("marque la case de celui qui PART, pas seulement de celui qui arrive", () => {
    // Le cœur du défaut du 17/09 : Fanny arrive sur un créneau où elle n'est
    // pas. La v1 ne dessinait rien, faute de la trouver déjà en place.
    const apercu = calculerApercuCreneaux(
      calculerPlacesProposees([
        {
          id: 'P1',
          changement: changement('P1', [
            { date: '2026-12-05', type: 'weekend', role: 'premier', vetId: 'fanny' },
          ]),
        },
      ]),
      [{ date: '2026-12-05', type: 'weekend', occupants: ['antoine'] }],
    )

    const c = apercu[cleCreneau('2026-12-05', 'weekend')]
    expect(c).toBeDefined()
    expect(c.sortants).toEqual(['antoine'])
    expect(c.entrants).toEqual(['fanny'])
    expect(c.propositionId).toBe('P1')
  })

  it('reproduit la proposition F1 du 17/09 : 5 créneaux marqués, pas 1', () => {
    // Données réelles, relues dans `propositions_relecture` (F1, appliquée le
    // 17/09 à 10:37) et confrontées à la grille de la capture de recette.
    // L'écran n'en avait marqué qu'UN : Anne-Sophie le 1er décembre.
    const places = calculerPlacesProposees([
      {
        id: 'F1',
        changement: changement('F1', [
          { date: '2026-12-04', type: 'vendredi_soir', role: 'second', vetId: 'fanny' },
          { date: '2026-12-05', type: 'weekend', role: 'premier', vetId: 'fanny' },
          { date: '2026-11-30', type: 'semaine_soir', role: 'premier', vetId: 'manon' },
          { date: '2026-12-01', type: 'semaine_soir', role: 'premier', vetId: 'anne-sophie' },
          { date: '2026-12-01', type: 'semaine_soir', role: 'second', vetId: 'antoine' },
          { date: '2026-12-02', type: 'semaine_soir', role: 'premier', vetId: 'manon' },
        ]),
      },
    ])

    const apercu = calculerApercuCreneaux(places, [
      { date: '2026-11-30', type: 'semaine_soir', occupants: ['antoine', 'fanny'] },
      { date: '2026-12-01', type: 'semaine_soir', occupants: ['manon', 'anne-sophie'] },
      { date: '2026-12-02', type: 'semaine_soir', occupants: ['jean', 'victor'] },
      { date: '2026-12-04', type: 'vendredi_soir', occupants: ['victor', 'antoine'] },
      { date: '2026-12-05', type: 'weekend', occupants: ['antoine', 'victor'] },
    ])

    expect(Object.keys(apercu)).toHaveLength(5)
    expect(apercu[cleCreneau('2026-11-30', 'semaine_soir')].entrants).toContain('manon')
    expect(apercu[cleCreneau('2026-12-02', 'semaine_soir')].entrants).toContain('manon')
    expect(apercu[cleCreneau('2026-12-05', 'weekend')].entrants).toContain('fanny')
  })

  it("ignore un créneau où seuls les RÔLES permutent — rien à montrer", () => {
    // C'est le cas du 1er décembre dans F1 : Anne-Sophie et Antoine sont déjà
    // tous les deux là, la proposition ne fait que les échanger de place.
    // Marquer la case ferait ouvrir un changement invisible à l'écran.
    const apercu = calculerApercuCreneaux(
      calculerPlacesProposees([
        {
          id: 'P1',
          changement: changement('P1', [
            { date: '2026-12-01', type: 'semaine_soir', role: 'premier', vetId: 'anne-sophie' },
            { date: '2026-12-01', type: 'semaine_soir', role: 'second', vetId: 'antoine' },
          ]),
        },
      ]),
      [{ date: '2026-12-01', type: 'semaine_soir', occupants: ['antoine', 'anne-sophie'] }],
    )

    expect(apercu).toEqual({})
  })

  it("n'est pas trompé par l'inversion des rôles du vendredi (B-111)", () => {
    // La vue inverse rôles ET personnes sur la ligne du vendredi. Comme on
    // compare des ENSEMBLES de personnes, l'ordre des occupants n'a aucun
    // effet : le résultat est le même dans les deux sens.
    const places = calculerPlacesProposees([
      {
        id: 'P1',
        changement: changement('P1', [
          { date: '2026-12-04', type: 'vendredi_soir', role: 'premier', vetId: 'fanny' },
          { date: '2026-12-04', type: 'vendredi_soir', role: 'second', vetId: 'jean' },
        ]),
      },
    ])

    const aLEndroit = calculerApercuCreneaux(places, [
      { date: '2026-12-04', type: 'vendredi_soir', occupants: ['antoine', 'jean'] },
    ])
    const aLEnvers = calculerApercuCreneaux(places, [
      { date: '2026-12-04', type: 'vendredi_soir', occupants: ['jean', 'antoine'] },
    ])

    expect(aLEndroit).toEqual(aLEnvers)
    expect(aLEndroit[cleCreneau('2026-12-04', 'vendredi_soir')].sortants).toEqual(['antoine'])
    expect(aLEndroit[cleCreneau('2026-12-04', 'vendredi_soir')].entrants).toEqual(['fanny'])
  })

  it('fait ressortir la personne qui part quand la place se VIDE', () => {
    const apercu = calculerApercuCreneaux(
      calculerPlacesProposees([
        {
          id: 'P1',
          changement: changement('P1', [
            { date: '2026-12-04', type: 'semaine_soir', role: 'premier', vetId: 'jean' },
            { date: '2026-12-04', type: 'semaine_soir', role: 'second', vetId: null },
          ]),
        },
      ]),
      [{ date: '2026-12-04', type: 'semaine_soir', occupants: ['jean', 'manon'] }],
    )

    const c = apercu[cleCreneau('2026-12-04', 'semaine_soir')]
    expect(c.sortants).toEqual(['manon'])
    expect(c.entrants).toEqual([])
  })

  it("ignore un créneau proposé que la grille n'affiche pas", () => {
    const apercu = calculerApercuCreneaux(
      calculerPlacesProposees([
        {
          id: 'P1',
          changement: changement('P1', [
            { date: '2027-03-01', type: 'weekend', role: 'premier', vetId: 'fanny' },
          ]),
        },
      ]),
      [{ date: '2026-12-05', type: 'weekend', occupants: ['antoine'] }],
    )

    expect(apercu).toEqual({})
  })

  it('rend un objet vide sans proposition', () => {
    expect(calculerApercuCreneaux([], [{ date: '2026-12-05', type: 'weekend', occupants: ['a'] }])).toEqual({})
  })
})
