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
      role: 'second',
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
      [{ date: '2026-12-05', type: 'weekend', occupants: [{ vetId: 'antoine', role: 'premier' }] }],
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
      { date: '2026-11-30', type: 'semaine_soir', occupants: [{ vetId: 'antoine', role: 'premier' }, { vetId: 'fanny', role: 'second' }] },
      { date: '2026-12-01', type: 'semaine_soir', occupants: [{ vetId: 'manon', role: 'premier' }, { vetId: 'anne-sophie', role: 'second' }] },
      { date: '2026-12-02', type: 'semaine_soir', occupants: [{ vetId: 'jean', role: 'premier' }, { vetId: 'victor', role: 'second' }] },
      { date: '2026-12-04', type: 'vendredi_soir', occupants: [{ vetId: 'victor', role: 'premier' }, { vetId: 'antoine', role: 'second' }] },
      { date: '2026-12-05', type: 'weekend', occupants: [{ vetId: 'antoine', role: 'premier' }, { vetId: 'victor', role: 'second' }] },
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
      [{ date: '2026-12-01', type: 'semaine_soir', occupants: [{ vetId: 'antoine', role: 'premier' }, { vetId: 'anne-sophie', role: 'second' }] }],
    )

    expect(apercu).toEqual({})
  })

  it("NE BARRE PERSONNE sur le vendredi soir — l'inversion rend le rôle faux (B-111)", () => {
    // La ligne du vendredi est DÉRIVÉE du week-end, rôles et personnes
    // inversés. Apparier par rôle y désignerait la mauvaise personne un jour
    // sur trois : c'est le défaut payé le 04/09 sur les cadenas. On montre donc
    // qui arrive, et on se tait sur qui part — quel que soit l'ordre affiché.
    const places = calculerPlacesProposees([
      {
        id: 'P1',
        changement: changement('P1', [
          { date: '2026-12-04', type: 'vendredi_soir', role: 'premier', vetId: 'fanny' },
        ]),
      },
    ])

    const aLEndroit = calculerApercuCreneaux(places, [
      { date: '2026-12-04', type: 'vendredi_soir', occupants: [{ vetId: 'antoine', role: 'premier' }, { vetId: 'jean', role: 'second' }] },
    ])
    const aLEnvers = calculerApercuCreneaux(places, [
      { date: '2026-12-04', type: 'vendredi_soir', occupants: [{ vetId: 'jean', role: 'premier' }, { vetId: 'antoine', role: 'second' }] },
    ])

    expect(aLEndroit).toEqual(aLEnvers)
    expect(aLEndroit[cleCreneau('2026-12-04', 'vendredi_soir')].sortants).toEqual([])
    expect(aLEndroit[cleCreneau('2026-12-04', 'vendredi_soir')].entrants).toEqual(['fanny'])
  })

  it("NE BARRE PAS une place que la proposition ne touche pas — recette MiKL du 17/09", () => {
    // ⚠️ LE DÉFAUT EXACT, capture à l'appui : sur le week-end du 5 décembre, la
    // grille barrait Antoine ET Victor pour faire entrer Fanny. Or la
    // proposition ne portait qu'une affectation — `premier: Fanny`. Victor, en
    // second, ne bougeait pas. MiKL : « pourquoi Victor et Antoine sont barrés
    // et il y a juste Fanny ? ».
    //
    // Une proposition ne décrit QUE ce qu'elle change, jamais l'état complet du
    // créneau. La v2 comparait deux ensembles et supposait le contraire.
    const apercu = calculerApercuCreneaux(
      calculerPlacesProposees([
        {
          id: 'F1',
          changement: changement('F1', [
            { date: '2026-12-05', type: 'weekend', role: 'premier', vetId: 'fanny' },
          ]),
        },
      ]),
      [
        {
          date: '2026-12-05',
          type: 'weekend',
          occupants: [
            { vetId: 'antoine', role: 'premier' },
            { vetId: 'victor', role: 'second' },
          ],
        },
      ],
    )

    const c = apercu[cleCreneau('2026-12-05', 'weekend')]
    expect(c.sortants).toEqual(['antoine'])
    expect(c.entrants).toEqual(['fanny'])
    expect(c.sortants).not.toContain('victor')
  })

  it('ne fait pas sortir quelqu’un que la proposition REPLACE sur le même créneau', () => {
    // Manon cède le premier rôle à Anne-Sophie, et Antoine arrive en second.
    // Manon part vraiment ; Anne-Sophie, elle, change juste de place.
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
      [
        {
          date: '2026-12-01',
          type: 'semaine_soir',
          occupants: [
            { vetId: 'manon', role: 'premier' },
            { vetId: 'anne-sophie', role: 'second' },
          ],
        },
      ],
    )

    const c = apercu[cleCreneau('2026-12-01', 'semaine_soir')]
    expect(c.sortants).toEqual(['manon'])
    expect(c.entrants).toEqual(['antoine'])
    expect(c.sortants).not.toContain('anne-sophie')
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
      [{ date: '2026-12-04', type: 'semaine_soir', occupants: [{ vetId: 'jean', role: 'premier' }, { vetId: 'manon', role: 'second' }] }],
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
      [{ date: '2026-12-05', type: 'weekend', occupants: [{ vetId: 'antoine', role: 'premier' }] }],
    )

    expect(apercu).toEqual({})
  })

  it('rattache le VENDREDI SOIR a son week-end — recette MiKL du 20/09', () => {
    // MiKL : « Filou propose de changer le week-end du 4, alors pourquoi le
    // vendredi 4 n'est pas lui aussi entoure ? ». La proposition dit
    // `vendredi_soir`, la grille affiche ce jour-la en `weekend` : deux noms
    // pour un seul creneau, donc deux cles qui ne se rencontraient jamais.
    const apercu = calculerApercuCreneaux(
      calculerPlacesProposees([
        {
          id: 'P1',
          changement: changement('P1', [
            { date: '2026-12-04', type: 'vendredi_soir', role: 'second', vetId: 'fanny' },
          ]),
        },
      ]),
      [
        {
          date: '2026-12-04',
          type: 'weekend',
          occupants: [
            { vetId: 'victor', role: 'premier' },
            { vetId: 'antoine', role: 'second' },
          ],
        },
      ],
    )

    const c = apercu[cleCreneau('2026-12-04', 'weekend')]
    expect(c).toBeDefined()
    expect(c.entrants).toEqual(['fanny'])
    // Le role vient d'une place `vendredi_soir` : inverse par la vue, donc
    // inutilisable pour designer qui part (B-111).
    expect(c.sortants).toEqual([])
  })

  it('marque les TROIS jours du week-end, pas seulement celui qui est nomme', () => {
    // MiKL : « tout comme le dimanche 6 qui n'est meme pas dans la liste ».
    // Un week-end est UN creneau pour Filou et TROIS lignes sur la grille.
    const apercu = calculerApercuCreneaux(
      calculerPlacesProposees([
        {
          id: 'P1',
          changement: changement('P1', [
            { date: '2026-12-05', type: 'weekend', role: 'premier', vetId: 'fanny' },
          ]),
        },
      ]),
      [
        { date: '2026-12-04', type: 'weekend', occupants: [{ vetId: 'antoine', role: 'premier' }, { vetId: 'victor', role: 'second' }] },
        { date: '2026-12-05', type: 'weekend', occupants: [{ vetId: 'antoine', role: 'premier' }, { vetId: 'victor', role: 'second' }] },
        { date: '2026-12-06', type: 'weekend', occupants: [{ vetId: 'antoine', role: 'premier' }, { vetId: 'victor', role: 'second' }] },
      ],
    )

    for (const jour of ['2026-12-04', '2026-12-05', '2026-12-06']) {
      const c = apercu[cleCreneau(jour, 'weekend')]
      expect(c, `le ${jour} doit etre marque`).toBeDefined()
      expect(c.entrants).toContain('fanny')
      expect(c.sortants).toContain('antoine')
    }
  })

  it('ne deborde PAS sur le week-end suivant', () => {
    // Deux week-ends separes par la semaine : marquer le premier ne doit rien
    // faire au second, sinon la grille accuserait un changement inexistant.
    const apercu = calculerApercuCreneaux(
      calculerPlacesProposees([
        {
          id: 'P1',
          changement: changement('P1', [
            { date: '2026-12-05', type: 'weekend', role: 'premier', vetId: 'fanny' },
          ]),
        },
      ]),
      [
        { date: '2026-12-05', type: 'weekend', occupants: [{ vetId: 'antoine', role: 'premier' }] },
        { date: '2026-12-06', type: 'weekend', occupants: [{ vetId: 'antoine', role: 'premier' }] },
        { date: '2026-12-12', type: 'weekend', occupants: [{ vetId: 'jean', role: 'premier' }] },
        { date: '2026-12-13', type: 'weekend', occupants: [{ vetId: 'jean', role: 'premier' }] },
      ],
    )

    expect(apercu[cleCreneau('2026-12-06', 'weekend')]).toBeDefined()
    expect(apercu[cleCreneau('2026-12-12', 'weekend')]).toBeUndefined()
    expect(apercu[cleCreneau('2026-12-13', 'weekend')]).toBeUndefined()
  })

  it('rend un objet vide sans proposition', () => {
    expect(calculerApercuCreneaux([], [{ date: '2026-12-05', type: 'weekend', occupants: [{ vetId: 'a', role: 'premier' }] }])).toEqual({})
  })
})
