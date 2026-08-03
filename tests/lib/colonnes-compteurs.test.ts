import { describe, it, expect } from 'vitest'
import {
  normaliserColonnes, COLONNES, ORDRE_CATALOGUE, COLONNES_DEFAUT, MAX_COLONNES,
} from '@/lib/planning/colonnesCompteurs'

describe('le catalogue de colonnes', () => {
  it('décrit chaque colonne annoncée dans l’ordre', () => {
    for (const cle of ORDRE_CATALOGUE) {
      expect(COLONNES[cle]).toBeDefined()
      expect(COLONNES[cle].entete.length).toBeGreaterThan(0)
      expect(COLONNES[cle].description.length).toBeGreaterThan(0)
    }
    // L'ordre couvre tout le catalogue : une colonne définie mais absente de
    // l'ordre serait invisible dans le menu de réglage.
    expect(ORDRE_CATALOGUE.length).toBe(Object.keys(COLONNES).length)
  })

  it('propose un défaut qui tient dans la largeur', () => {
    expect(COLONNES_DEFAUT.length).toBeLessThanOrEqual(MAX_COLONNES)
    expect(COLONNES_DEFAUT.length).toBeGreaterThan(0)
  })

  it('garde « écart » dans le défaut — c’est la colonne qui dit si c’est juste', () => {
    expect(COLONNES_DEFAUT).toContain('ecart')
  })
})

describe('normaliserColonnes', () => {
  it('conserve un choix valide', () => {
    expect(normaliserColonnes(['we', 'nuits'])).toEqual(['we', 'nuits'])
  })

  it('impose l’ordre du catalogue, quel que soit l’ordre reçu', () => {
    // Sinon l'en-tête et les cellules pourraient se désaligner d'un rendu à
    // l'autre selon l'ordre de cochage.
    expect(normaliserColonnes(['total', 'we', 'ecart'])).toEqual(['we', 'ecart', 'total'])
  })

  it('écarte les clés inconnues sans tout jeter', () => {
    expect(normaliserColonnes(['we', 'chose', 'nuits'])).toEqual(['we', 'nuits'])
  })

  it('supprime les doublons', () => {
    expect(normaliserColonnes(['we', 'we', 'we'])).toEqual(['we'])
  })

  it('applique le plafond de largeur', () => {
    const tout = normaliserColonnes([...ORDRE_CATALOGUE])
    expect(tout.length).toBe(MAX_COLONNES)
  })

  it('retombe sur le défaut plutôt que de rendre un encart vide', () => {
    // Un encart sans aucune colonne donnerait l'impression d'un écran cassé.
    expect(normaliserColonnes([])).toEqual(COLONNES_DEFAUT)
    expect(normaliserColonnes(['inconnue'])).toEqual(COLONNES_DEFAUT)
    expect(normaliserColonnes(null)).toEqual(COLONNES_DEFAUT)
    expect(normaliserColonnes(undefined)).toEqual(COLONNES_DEFAUT)
    expect(normaliserColonnes('we')).toEqual(COLONNES_DEFAUT)
    expect(normaliserColonnes({ we: true })).toEqual(COLONNES_DEFAUT)
  })

  it('est idempotente — repasser une valeur déjà propre ne la change pas', () => {
    const une = normaliserColonnes(['total', 'we', 'ecart', 'feries', 'nuits'])
    expect(normaliserColonnes(une)).toEqual(une)
  })
})
