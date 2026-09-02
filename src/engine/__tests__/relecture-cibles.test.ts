// ============================================================
// B-096 — LE CIBLAGE VISAIT LA CHARGE TOTALE, PAS LE DÉSÉQUILIBRE
// ============================================================
// Le cas qui a tout déclenché, reproduit à l'identique : MiKL, le 2026-09-02,
// devant Hiver P2 — « Fanny fait 3 week-ends et Antoine 5, pourquoi ? ».
//
// Sur cette période, les totaux étaient serrés (Antoine 27, Fanny 24) alors que
// les week-ends ne l'étaient pas du tout (5 contre 3), et l'avantage financier
// encore moins (3 fois 1er contre 1). Le ciblage ne regardait que le total :
// Antoine n'a été retenu que par hasard (2ᵉ au classement), et Fanny pas du
// tout — alors qu'elle est l'autre moitié exacte du problème.
//
// Le premier test ci-dessous ÉCHOUERAIT avec l'ancien critère. C'est le seul
// qui prouve quelque chose ; les autres protègent contre les deux excès
// symétriques (tout prendre, ou trop peu).
// ============================================================

import { describe, it, expect } from 'vitest'
import { personnesAuxExtremes } from '../relecture/cibles'
import type { PlanningPartiel, VetEngine } from '../types'

function vet(id: string, prenom: string, extra: Partial<VetEngine> = {}): VetEngine {
  return {
    id, nom: prenom, prenom, statut: 'associe',
    dernier_recours: false, contraintes: [], conges: [],
    ...extra,
  }
}

/**
 * Six personnes aux totaux SERRÉS, avec un déséquilibre franc sur les
 * week-ends. C'est la forme exacte du cas réel.
 *
 *   semaines : tout le monde en a 4 (2 soirs × 2 rôles répartis)
 *   week-ends : « antoine » en a 3, « fanny » aucun, les autres 1 chacun
 */
function planningTotauxSerresWeekendsDesequilibres(): PlanningPartiel {
  const semaine = (date: string, premier: string, second: string) => ({
    date, type: 'semaine_soir',
    placements: [{ role: 'premier', vetId: premier }, { role: 'second', vetId: second }],
  })
  const we = (date: string, premier: string, second: string) => ({
    date, type: 'weekend',
    placements: [{ role: 'premier', vetId: premier }, { role: 'second', vetId: second }],
  })

  return {
    attributions: [
      // Fanny compense en soirs de semaine ce qu'elle n'a pas en week-ends :
      // son TOTAL reste proche de celui d'Antoine. C'est tout le piège.
      semaine('2025-11-03', 'fanny', 'manon'),
      semaine('2025-11-04', 'fanny', 'victor'),
      semaine('2025-11-05', 'fanny', 'jean'),
      semaine('2025-11-06', 'fanny', 'manon'),
      semaine('2025-11-10', 'victor', 'jean'),
      semaine('2025-11-11', 'manon', 'victor'),

      we('2025-11-08', 'antoine', 'jean'),
      we('2025-11-15', 'antoine', 'manon'),
      we('2025-11-22', 'antoine', 'victor'),
      we('2025-11-29', 'jean', 'manon'),
    ],
  }
}

const EQUIPE = [
  vet('antoine', 'Antoine'), vet('fanny', 'Fanny'), vet('jean', 'Jean'),
  vet('manon', 'Manon'), vet('victor', 'Victor'),
]

describe('personnesAuxExtremes — le déséquilibre de week-ends', () => {
  it('retient Antoine ET Fanny, les deux extrêmes des week-ends', () => {
    const cibles = personnesAuxExtremes(planningTotauxSerresWeekendsDesequilibres(), {
      vets: EQUIPE,
    })
    // Antoine a 3 week-ends, Fanny zéro. Si l'un des deux manque, aucun
    // mouvement ne pourra rééquilibrer les week-ends — c'est exactement ce qui
    // s'est passé le 02/09.
    expect(cibles).toContain('antoine')
    expect(cibles).toContain('fanny')
  })

  it('retient aussi les extrêmes du rôle qui porte l’avantage financier', () => {
    // Antoine est 1er trois fois, Fanny jamais. Le constat « le rôle qui
    // rapporte doit tourner » ne peut se corriger que si les deux sont ciblés.
    const cibles = personnesAuxExtremes(planningTotauxSerresWeekendsDesequilibres(), {
      vets: EQUIPE,
      roleAvantageFinancier: 'premier',
    })
    expect(cibles).toContain('antoine')
    expect(cibles).toContain('fanny')
  })

  it('ne prend pas tout le monde — sinon le filtre ne filtre rien', () => {
    // Le filtre existe pour borner la combinatoire. S'il rend l'équipe
    // entière, on a remplacé un mauvais filtre par pas de filtre du tout.
    const grande = [
      ...EQUIPE,
      vet('a1', 'A1'), vet('a2', 'A2'), vet('a3', 'A3'), vet('a4', 'A4'),
    ]
    const cibles = personnesAuxExtremes(planningTotauxSerresWeekendsDesequilibres(), {
      vets: grande, parExtremite: 1,
    })
    expect(cibles.length).toBeLessThan(grande.length)
  })
})

describe('personnesAuxExtremes — les cas qui fausseraient le filtre', () => {
  it('n’inclut JAMAIS le dernier recours', () => {
    // À zéro sur toutes les dimensions, il serait le minimum de chacune et
    // remplirait la liste à lui seul, pour des mouvements que le prompt
    // interdit de proposer.
    const equipe = [...EQUIPE, vet('anneCat', 'Anne-Catherine', { dernier_recours: true })]
    const cibles = personnesAuxExtremes(planningTotauxSerresWeekendsDesequilibres(), {
      vets: equipe,
    })
    expect(cibles).not.toContain('anneCat')
  })

  it('rend le même résultat deux fois de suite', () => {
    // À égalité de compteur, un tri instable désignerait des personnes
    // différentes d'un appel à l'autre : on ne saurait plus si un changement de
    // relecture vient du produit ou du hasard.
    const planning = planningTotauxSerresWeekendsDesequilibres()
    expect(personnesAuxExtremes(planning, { vets: EQUIPE }))
      .toEqual(personnesAuxExtremes(planning, { vets: EQUIPE }))
  })

  it('ne casse pas sur une équipe vide', () => {
    expect(personnesAuxExtremes(planningTotauxSerresWeekendsDesequilibres(), { vets: [] }))
      .toEqual([])
  })
})
