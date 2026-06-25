// ============================================================
// GUARDVETO — Helpers « périodes » (validité par période)
// ============================================================
// Fige le miroir validite_json ↔ periode_id (le loader moteur filtre sur
// periode_id ; validite_json doit rester cohérent) + le libellé non ambigu.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  construireValiditeJson,
  periodeLabelBase,
  periodeLabelCourt,
  type PeriodeMini,
} from '../periodes'

describe('construireValiditeJson', () => {
  it('null ⇒ permanente', () => {
    expect(construireValiditeJson(null)).toEqual({ type: 'permanente', version: 1 })
  })
  it('un id ⇒ périodique avec le même id (cohérence avec periode_id)', () => {
    expect(construireValiditeJson('per-123')).toEqual({
      type: 'periode', periode_id: 'per-123', version: 1,
    })
  })
})

describe('periodeLabelBase', () => {
  it('libellé custom prioritaire', () => {
    expect(periodeLabelBase({ saison: 'hiver', numero: 3, libelle: 'Saison test' })).toBe('Saison test')
  })
  it('été sans libellé', () => {
    expect(periodeLabelBase({ saison: 'ete', numero: null, libelle: null })).toBe('Été')
  })
  it('hiver sans libellé → numéro', () => {
    expect(periodeLabelBase({ saison: 'hiver', numero: 3, libelle: null })).toBe('Hiver P3')
  })
})

describe('periodeLabelCourt', () => {
  it('lève l’ambiguïté entre deux périodes homonymes via les dates', () => {
    const p: PeriodeMini = {
      id: 'p1', saison: 'hiver', numero: 3, libelle: null,
      date_debut: '2026-01-05', date_fin: '2026-03-29',
    }
    const label = periodeLabelCourt(p)
    expect(label).toContain('Hiver P3')
    expect(label).toContain('2026') // mois/année présents pour désambiguïser
  })
})
