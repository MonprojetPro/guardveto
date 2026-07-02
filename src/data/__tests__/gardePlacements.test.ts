// ============================================================
// GUARDVETO — P3b slice 1 : construction des lignes garde_placements
// ============================================================
// Fige la double écriture (mémoire → lignes garde_placements) : une place
// pourvue = une ligne (place_index + rôle + véto) ; une place vide = pas de
// ligne (miroir de second_id NULL) ; une garde non résolue (verrouillée) est
// ignorée. Couche pure, aucune base.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  construireGardePlacements,
  type AttributionPersistee,
} from '../gardePlacements'

const CAB = 'cab-1'

function attr(over: Partial<AttributionPersistee>): AttributionPersistee {
  return { date: '2026-01-05', dbType: 'semaine', placements: [], ...over }
}

describe('construireGardePlacements', () => {
  it('2 places pourvues → 2 lignes indexées 0/1 avec rôles et vétos', () => {
    const map = new Map([['2026-01-05|semaine', 'g-1']])
    const rows = construireGardePlacements(
      [attr({ placements: [{ role: 'premier', vetId: 'v-a' }, { role: 'second', vetId: 'v-b' }] })],
      map,
      CAB,
    )
    expect(rows).toEqual([
      { cabinet_id: CAB, garde_id: 'g-1', place_index: 0, role: 'premier', veterinaire_id: 'v-a' },
      { cabinet_id: CAB, garde_id: 'g-1', place_index: 1, role: 'second', veterinaire_id: 'v-b' },
    ])
  })

  it('place vide (vetId null) → aucune ligne pour cette place (miroir second_id NULL)', () => {
    const map = new Map([['2026-01-05|semaine', 'g-1']])
    const rows = construireGardePlacements(
      [attr({ placements: [{ role: 'premier', vetId: 'v-a' }, { role: 'second', vetId: null }] })],
      map,
      CAB,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ garde_id: 'g-1', place_index: 0, veterinaire_id: 'v-a' })
  })

  it('N places (3) → 3 lignes, index 0/1/2', () => {
    const map = new Map([['2026-01-10|weekend', 'g-we']])
    const rows = construireGardePlacements(
      [attr({
        date: '2026-01-10', dbType: 'weekend',
        placements: [
          { role: 'premier', vetId: 'v-a' },
          { role: 'second', vetId: 'v-b' },
          { role: 'troisieme', vetId: 'v-c' },
        ],
      })],
      map,
      CAB,
    )
    expect(rows.map((r) => r.place_index)).toEqual([0, 1, 2])
    expect(rows.map((r) => r.role)).toEqual(['premier', 'second', 'troisieme'])
    expect(rows.every((r) => r.garde_id === 'g-we')).toBe(true)
  })

  it('garde non résolue (absente de la map = verrouillée) → ignorée', () => {
    const rows = construireGardePlacements(
      [attr({ placements: [{ role: 'premier', vetId: 'v-a' }] })],
      new Map(), // aucun id résolu
      CAB,
    )
    expect(rows).toEqual([])
  })

  it('la clé combine date ET type DB (deux types le même jour ne se mélangent pas)', () => {
    const map = new Map([
      ['2026-01-05|semaine', 'g-sem'],
      ['2026-01-05|ferie', 'g-fer'],
    ])
    const rows = construireGardePlacements(
      [
        attr({ date: '2026-01-05', dbType: 'semaine', placements: [{ role: 'premier', vetId: 'v-a' }] }),
        attr({ date: '2026-01-05', dbType: 'ferie', placements: [{ role: 'premier', vetId: 'v-b' }] }),
      ],
      map,
      CAB,
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.garde_id === 'g-sem')?.veterinaire_id).toBe('v-a')
    expect(rows.find((r) => r.garde_id === 'g-fer')?.veterinaire_id).toBe('v-b')
  })
})
