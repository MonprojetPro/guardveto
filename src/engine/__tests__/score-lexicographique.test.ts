// Tests unitaires pour score-lexicographique.ts (F2-001)
// Gate de non-régression — doit rester vert après chaque story Fondations

import { describe, it, expect } from 'vitest'
import { comparerScores, type VecteurScore, Etage, NB_ETAGES } from '../score-lexicographique'

describe('comparerScores — étages hermétiques (bombe prod #2 tuée)', () => {
  it('un seul 🟠 (étage 3) bat N×🟡 (étage 4), quel que soit N', () => {
    const unOrange: VecteurScore = { etages: [0,0,0,1,0,0,0], contributions: [] }
    const centJaunes: VecteurScore = { etages: [0,0,0,0,100,0,0], contributions: [] }
    expect(comparerScores(unOrange, centJaunes)).toBeGreaterThan(0) // unOrange est PIRE → centJaunes préféré
    expect(comparerScores(centJaunes, unOrange)).toBeLessThan(0) // centJaunes est meilleur que unOrange
    // Reformulation : le planning avec 100 violations 🟡 est MEILLEUR que celui avec 1 violation 🟠
    expect(comparerScores(centJaunes, unOrange)).toBeLessThan(0)
  })

  it('vecteur zéro = meilleur possible', () => {
    const zero: VecteurScore = { etages: new Array(NB_ETAGES).fill(0), contributions: [] }
    const petit: VecteurScore = { etages: [0,0,0,0,0,0,1], contributions: [] }
    expect(comparerScores(zero, petit)).toBeLessThan(0)
  })

  it('égalité parfaite = 0', () => {
    const a: VecteurScore = { etages: [0,0,0,2,5,0,100], contributions: [] }
    const b: VecteurScore = { etages: [0,0,0,2,5,0,100], contributions: [] }
    expect(comparerScores(a, b)).toBe(0)
  })

  it('premier étage différent décide, même si les étages suivants sont pires', () => {
    const a: VecteurScore = { etages: [0,0,0,1,0,0,999], contributions: [] }
    const b: VecteurScore = { etages: [0,0,0,2,0,0,0], contributions: [] }
    // a a moins de violations en étage 3 → a est meilleur
    expect(comparerScores(a, b)).toBeLessThan(0)
  })
})

describe('Garantie hermétricité inter-étage (élimination bug cumul)', () => {
  it('1 violation 🟠 (étage 3) bat 100 violations 🟡 (étage 4)', () => {
    // Un seul orange dans l'étage 3
    const unOrange: VecteurScore = {
      etages: [0, 0, 0, 1, 0, 0, 0],
      contributions: []
    }
    // 100 jaunes dans l'étage 4
    const centJaunes: VecteurScore = {
      etages: [0, 0, 0, 0, 100, 0, 0],
      contributions: []
    }
    // centJaunes est MEILLEUR (comparerScores < 0 signifie "premier est meilleur")
    // Donc comparerScores(centJaunes, unOrange) < 0
    expect(comparerScores(centJaunes, unOrange)).toBeLessThan(0)
  })

  it('le cumul 🟡 ne peut jamais franchir un seuil 🟠 (1000 jaunes < 1 orange)', () => {
    const milleJaunes: VecteurScore = {
      etages: [0, 0, 0, 0, 1000, 0, 0],
      contributions: []
    }
    const unOrange: VecteurScore = {
      etages: [0, 0, 0, 1, 0, 0, 0],
      contributions: []
    }
    expect(comparerScores(milleJaunes, unOrange)).toBeLessThan(0)
  })
})
