// ============================================================
// B-123 — quelles cases la grille doit surligner
// ============================================================
import { describe, it, expect } from 'vitest'
import { calculerTouchesApercu } from '@/lib/planning/apercuPropositions'
import type { ChangementPropose } from '@/engine/relecture/arbitrer'

function changement(id: string, affectations: ChangementPropose['affectations']): ChangementPropose {
  return { id, motif: `motif ${id}`, critere: 'epuisement', affectations }
}

describe('calculerTouchesApercu', () => {
  it('associe chaque vetId ARRIVANT à sa date et à sa proposition', () => {
    const touches = calculerTouchesApercu([
      {
        id: 'P1',
        changement: changement('P1', [
          { date: '2026-12-04', type: 'vendredi_soir', role: 'premier', vetId: 'fanny' },
          { date: '2026-12-05', type: 'weekend', role: 'premier', vetId: 'fanny' },
        ]),
      },
    ])

    expect(touches['2026-12-04']?.['fanny']).toBe('P1')
    expect(touches['2026-12-05']?.['fanny']).toBe('P1')
  })

  it('ignore les affectations qui VIDENT une place (vetId null) — non surlignables', () => {
    const touches = calculerTouchesApercu([
      { id: 'P1', changement: changement('P1', [
        { date: '2026-12-04', type: 'semaine_soir', role: 'second', vetId: null },
      ]) },
    ])

    expect(touches['2026-12-04']).toBeUndefined()
  })

  it('regroupe plusieurs propositions sur des dates distinctes', () => {
    const touches = calculerTouchesApercu([
      { id: 'P1', changement: changement('P1', [
        { date: '2026-12-04', type: 'weekend', role: 'premier', vetId: 'antoine' },
      ]) },
      { id: 'P2', changement: changement('P2', [
        { date: '2026-12-11', type: 'weekend', role: 'second', vetId: 'manon' },
      ]) },
    ])

    expect(touches['2026-12-04']?.['antoine']).toBe('P1')
    expect(touches['2026-12-11']?.['manon']).toBe('P2')
    expect(Object.keys(touches)).toHaveLength(2)
  })

  it('rend un objet vide sur une liste vide', () => {
    expect(calculerTouchesApercu([])).toEqual({})
  })
})
