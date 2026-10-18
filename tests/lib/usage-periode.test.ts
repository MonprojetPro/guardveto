import { describe, it, expect } from 'vitest'
import { usagesSeChevauchent } from '@/lib/planning/usage-periode'

describe('usagesSeChevauchent (B-162)', () => {
  it('deux periodes de gardes se chevauchent', () => {
    expect(usagesSeChevauchent('gardes', 'gardes')).toBe(true)
  })

  it('deux periodes de journees se chevauchent', () => {
    expect(usagesSeChevauchent('journees', 'journees')).toBe(true)
  })

  it('gardes et journees ne se chevauchent PAS — c\'est le but de la colonne', () => {
    expect(usagesSeChevauchent('gardes', 'journees')).toBe(false)
    expect(usagesSeChevauchent('journees', 'gardes')).toBe(false)
  })

  it('les-deux chevauche tout, quel que soit l\'ordre des arguments', () => {
    expect(usagesSeChevauchent('les-deux', 'gardes')).toBe(true)
    expect(usagesSeChevauchent('gardes', 'les-deux')).toBe(true)
    expect(usagesSeChevauchent('les-deux', 'journees')).toBe(true)
    expect(usagesSeChevauchent('journees', 'les-deux')).toBe(true)
    expect(usagesSeChevauchent('les-deux', 'les-deux')).toBe(true)
  })
})
