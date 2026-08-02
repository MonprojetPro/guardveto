import { describe, it, expect } from 'vitest'
import { intituleViolation, grouperViolations } from '@/lib/regles/libelleViolation'

describe('intituleViolation', () => {
  it('traduit les codes du validateur en français', () => {
    expect(intituleViolation('ROLE_TAG')).toBe('Rôle interdit par une étiquette')
    expect(intituleViolation('COMPOSITION')).toBe('Composition de l’équipe de garde')
    expect(intituleViolation('R1')).toBe('Jour de repos fixe')
  })

  it('ne laisse JAMAIS passer un code brut, même inconnu', () => {
    const inconnu = intituleViolation('R42_NOUVEAU_CODE')
    expect(inconnu).toBe('Règle non respectée')
    expect(inconnu).not.toContain('R42')
    expect(inconnu).not.toContain('_')
  })
})

describe('grouperViolations', () => {
  const violations = [
    { regle: 'ROLE_TAG', date: '2026-06-22', detail: 'Victor…' },
    { regle: 'COMPOSITION', date: '2026-06-26', detail: 'aucun vétéran…' },
    { regle: 'ROLE_TAG', date: '2026-06-23', detail: 'Fanny…' },
    { regle: 'ROLE_TAG', date: '2026-06-24', detail: 'Jean…' },
  ]

  it('réunit les violations d’une même cause', () => {
    const causes = grouperViolations(violations)
    expect(causes).toHaveLength(2)
    expect(causes.map((c) => c.code)).toEqual(['ROLE_TAG', 'COMPOSITION'])
  })

  it('met la cause la plus nombreuse en tête', () => {
    const causes = grouperViolations(violations)
    expect(causes[0].items).toHaveLength(3)
    expect(causes[1].items).toHaveLength(1)
  })

  it('conserve l’ordre d’arrivée à l’intérieur d’une cause', () => {
    const dates = grouperViolations(violations)[0].items.map((v) => v.date)
    expect(dates).toEqual(['2026-06-22', '2026-06-23', '2026-06-24'])
  })

  it('porte l’intitulé lisible, pas le code', () => {
    expect(grouperViolations(violations)[0].intitule).toBe('Rôle interdit par une étiquette')
  })

  it('ne perd aucune violation', () => {
    const total = grouperViolations(violations).reduce((n, c) => n + c.items.length, 0)
    expect(total).toBe(violations.length)
  })

  it('accepte une liste vide', () => {
    expect(grouperViolations([])).toEqual([])
  })
})
