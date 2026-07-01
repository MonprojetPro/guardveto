import { describe, it, expect } from 'vitest'
import {
  clePlace,
  estPlaceFigee,
  placePour,
  type RoulementPlace,
  type RoulementCabinet,
} from '@/engine/roulement'

function place(over: Partial<RoulementPlace> = {}): RoulementPlace {
  return {
    code: 'weekend',
    role: 'premier',
    mode: 'roulement',
    politiqueConge: 'saute',
    sequenceVets: ['v1', 'v2'],
    positionReprise: 0,
    actif: true,
    ...over,
  }
}

describe('roulement — clePlace', () => {
  it('indexe par code:role', () => {
    expect(clePlace('weekend', 'premier')).toBe('weekend:premier')
    expect(clePlace('semaine_soir', 'second')).toBe('semaine_soir:second')
  })
})

describe('roulement — estPlaceFigee', () => {
  it('undefined → non figée', () => expect(estPlaceFigee(undefined)).toBe(false))
  it('roulement actif avec séquence → figée', () => expect(estPlaceFigee(place())).toBe(true))
  it('mode genere → non figée', () => expect(estPlaceFigee(place({ mode: 'genere' }))).toBe(false))
  it('séquence vide → non figée', () => expect(estPlaceFigee(place({ sequenceVets: [] }))).toBe(false))
  it('inactive → non figée', () => expect(estPlaceFigee(place({ actif: false }))).toBe(false))
})

describe('roulement — placePour', () => {
  it('retrouve la place par code:role, sinon undefined', () => {
    const map: RoulementCabinet = new Map([[clePlace('weekend', 'premier'), place()]])
    expect(placePour(map, 'weekend', 'premier')?.mode).toBe('roulement')
    expect(placePour(map, 'weekend', 'second')).toBeUndefined()
    expect(placePour(undefined, 'weekend', 'premier')).toBeUndefined()
  })
})
