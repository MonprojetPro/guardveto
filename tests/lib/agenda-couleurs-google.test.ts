import { describe, it, expect } from 'vitest'
import {
  COULEURS_GOOGLE,
  estColorIdValide,
  couleurGooglePar,
} from '@/lib/agenda/couleurs-google'

describe('COULEURS_GOOGLE — les 11 couleurs Google Agenda', () => {
  it('contient exactement 11 entrées', () => {
    expect(COULEURS_GOOGLE).toHaveLength(11)
  })

  it('les ids vont de 1 à 11, sans trou ni doublon', () => {
    const ids = COULEURS_GOOGLE.map((c) => c.id).sort((a, b) => Number(a) - Number(b))
    expect(ids).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])
  })

  it('chaque entrée a un libellé français distinct du nom Google', () => {
    for (const c of COULEURS_GOOGLE) {
      expect(c.libelleFr.length).toBeGreaterThan(0)
      expect(c.nomGoogle.length).toBeGreaterThan(0)
    }
  })

  it('chaque hex est une forme #RRGGBB valide', () => {
    for (const c of COULEURS_GOOGLE) {
      expect(c.hex).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
})

describe('estColorIdValide — le portier', () => {
  it('accepte un id existant', () => {
    expect(estColorIdValide('1')).toBe(true)
    expect(estColorIdValide('11')).toBe(true)
  })

  it('refuse un id hors plage', () => {
    expect(estColorIdValide('0')).toBe(false)
    expect(estColorIdValide('12')).toBe(false)
  })

  it('refuse null, undefined et une chaîne vide', () => {
    expect(estColorIdValide(null)).toBe(false)
    expect(estColorIdValide(undefined)).toBe(false)
    expect(estColorIdValide('')).toBe(false)
  })
})

describe('couleurGooglePar', () => {
  it('retrouve la fiche complète', () => {
    expect(couleurGooglePar('7')?.nomGoogle).toBe('Peacock')
    expect(couleurGooglePar('7')?.libelleFr).toBe('Paon')
  })

  it('renvoie undefined pour un id invalide', () => {
    expect(couleurGooglePar('99')).toBeUndefined()
  })
})
