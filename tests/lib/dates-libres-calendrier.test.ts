import { describe, it, expect } from 'vitest'
import { versISO, depuisISO } from '@/components/chantier/DatesLibresCalendrier'

describe('versISO / depuisISO (B-168)', () => {
  it('versISO lit le jour en LOCAL, jamais via toISOString (piège de fuseau)', () => {
    // Minuit local : un passage par toISOString() (UTC) ferait reculer d'un
    // jour pour quiconque est à l'est de Greenwich (la France).
    const minuitLocal = new Date(2026, 10, 9) // 9 novembre 2026, mois 0-indexé
    expect(versISO(minuitLocal)).toBe('2026-11-09')
  })

  it('depuisISO redonne exactement le meme jour', () => {
    expect(versISO(depuisISO('2026-12-07'))).toBe('2026-12-07')
  })

  it('aller-retour stable sur un changement d’annee', () => {
    expect(versISO(depuisISO('2026-12-31'))).toBe('2026-12-31')
    expect(versISO(depuisISO('2027-01-01'))).toBe('2027-01-01')
  })
})
