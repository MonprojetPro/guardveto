import { describe, it, expect } from 'vitest'
import {
  departementDepuisCodePostal,
  zoneEtRegionDepuisDepartement,
  zoneEtRegionDepuisCodePostal,
} from '../geo-zone'

describe('departementDepuisCodePostal', () => {
  it('extrait le département métropole (2 premiers chiffres)', () => {
    expect(departementDepuisCodePostal('03300')).toBe('03') // Cusset, Allier (pilote)
    expect(departementDepuisCodePostal('75012')).toBe('75')
    expect(departementDepuisCodePostal('69003')).toBe('69')
  })

  it('gère les espaces parasites', () => {
    expect(departementDepuisCodePostal(' 03300 ')).toBe('03')
  })

  it('gère la Corse (2A / 2B)', () => {
    expect(departementDepuisCodePostal('20000')).toBe('2A') // Ajaccio
    expect(departementDepuisCodePostal('20200')).toBe('2B') // Bastia
    expect(departementDepuisCodePostal('20090')).toBe('2A')
  })

  it('gère les DOM (3 chiffres)', () => {
    expect(departementDepuisCodePostal('97110')).toBe('971') // Guadeloupe
    expect(departementDepuisCodePostal('97400')).toBe('974') // Réunion
    expect(departementDepuisCodePostal('98713')).toBe('987') // Polynésie
  })

  it('retourne null pour un code postal invalide', () => {
    expect(departementDepuisCodePostal('')).toBeNull()
    expect(departementDepuisCodePostal('abc')).toBeNull()
    expect(departementDepuisCodePostal('123')).toBeNull()
    expect(departementDepuisCodePostal('750121')).toBeNull()
  })
})

describe('zoneEtRegionDepuisDepartement', () => {
  it('mappe le cabinet pilote (Allier 03) sur la zone A', () => {
    expect(zoneEtRegionDepuisDepartement('03')).toEqual({ zone: 'A', region: 'metropole' })
  })

  it('mappe correctement des départements des 3 zones', () => {
    expect(zoneEtRegionDepuisDepartement('69').zone).toBe('A') // Lyon
    expect(zoneEtRegionDepuisDepartement('59').zone).toBe('B') // Lille
    expect(zoneEtRegionDepuisDepartement('75').zone).toBe('C') // Paris
    expect(zoneEtRegionDepuisDepartement('44').zone).toBe('B') // Nantes
    expect(zoneEtRegionDepuisDepartement('31').zone).toBe('C') // Toulouse
    expect(zoneEtRegionDepuisDepartement('14').zone).toBe('B') // Normandie
  })

  it('détecte la région alsace-moselle', () => {
    expect(zoneEtRegionDepuisDepartement('57')).toEqual({ zone: 'B', region: 'alsace-moselle' })
    expect(zoneEtRegionDepuisDepartement('67')).toEqual({ zone: 'B', region: 'alsace-moselle' })
    expect(zoneEtRegionDepuisDepartement('68')).toEqual({ zone: 'B', region: 'alsace-moselle' })
  })

  it('détecte les régions DOM avec zone indéterminée', () => {
    expect(zoneEtRegionDepuisDepartement('971')).toEqual({ zone: null, region: 'guadeloupe' })
    expect(zoneEtRegionDepuisDepartement('974')).toEqual({ zone: null, region: 'reunion' })
  })

  it('renvoie zone null pour la Corse (pas de zone A/B/C standard)', () => {
    expect(zoneEtRegionDepuisDepartement('2A')).toEqual({ zone: null, region: 'metropole' })
    expect(zoneEtRegionDepuisDepartement('2B')).toEqual({ zone: null, region: 'metropole' })
  })

  it('renvoie zone null pour un département inconnu ou absent', () => {
    expect(zoneEtRegionDepuisDepartement(null)).toEqual({ zone: null, region: 'metropole' })
    expect(zoneEtRegionDepuisDepartement('99')).toEqual({ zone: null, region: 'metropole' })
  })

  it('couvre TOUS les départements métropole 01→95 (hors Corse) avec une zone', () => {
    for (let i = 1; i <= 95; i++) {
      if (i === 20) continue // Corse = 2A/2B, hors numérotation simple
      const dep = String(i).padStart(2, '0')
      const { zone } = zoneEtRegionDepuisDepartement(dep)
      expect(zone, `département ${dep} doit avoir une zone`).not.toBeNull()
    }
  })
})

describe('zoneEtRegionDepuisCodePostal', () => {
  it('résout de bout en bout pour le cabinet pilote', () => {
    expect(zoneEtRegionDepuisCodePostal('03300')).toEqual({
      departement: '03',
      zone: 'A',
      region: 'metropole',
    })
  })

  it('résout un cabinet alsacien', () => {
    expect(zoneEtRegionDepuisCodePostal('67000')).toEqual({
      departement: '67',
      zone: 'B',
      region: 'alsace-moselle',
    })
  })

  it('code postal invalide → tout null / metropole', () => {
    expect(zoneEtRegionDepuisCodePostal('xxxx')).toEqual({
      departement: null,
      zone: null,
      region: 'metropole',
    })
  })
})
