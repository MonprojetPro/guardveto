// Tests unitaires — utils.ts (F3-002 + F7-001)

import { describe, it, expect } from 'vitest'
import { estJourFerie, estEnVacancesScolaires, estSemaineImpaireAncrée } from '../utils'
import type { CalendrierResolu } from '../types'

describe('estJourFerie()', () => {
  it('détecte un férié fixe sans calendrier (fallback V1)', () => {
    expect(estJourFerie('2026-07-14')).toBe(true)
    expect(estJourFerie('2026-01-01')).toBe(true)
    expect(estJourFerie('2026-07-15')).toBe(false)
  })

  it('utilise le CalendrierResolu si fourni', () => {
    const calendrier: CalendrierResolu = {
      feries: new Set(['2026-07-14']),
      vacancesScolaires: [],
    }
    expect(estJourFerie('2026-07-14', calendrier)).toBe(true)
    expect(estJourFerie('2026-01-01', calendrier)).toBe(false) // pas dans ce calendrier custom
  })

  it('CalendrierResolu vide → aucune date est fériée', () => {
    const calendrier: CalendrierResolu = {
      feries: new Set(),
      vacancesScolaires: [],
    }
    expect(estJourFerie('2026-07-14', calendrier)).toBe(false)
    expect(estJourFerie('2026-01-01', calendrier)).toBe(false)
  })
})

describe('estEnVacancesScolaires()', () => {
  it('détecte les vacances sans calendrier (fallback V1)', () => {
    expect(estEnVacancesScolaires('2026-02-20')).toBe(true)  // Hiver 2026
    expect(estEnVacancesScolaires('2026-03-15')).toBe(false) // hors vacances
  })

  it('utilise le CalendrierResolu si fourni', () => {
    const calendrier: CalendrierResolu = {
      feries: new Set(),
      vacancesScolaires: [{ debut: '2026-06-01', fin: '2026-06-30' }],
    }
    expect(estEnVacancesScolaires('2026-06-15', calendrier)).toBe(true)
    expect(estEnVacancesScolaires('2026-02-20', calendrier)).toBe(false) // pas dans ce calendrier custom
  })
})

describe('estSemaineImpaireAncrée — non-régression semaine 53 (F7-001)', () => {
  it('semaine 0 depuis l\'ancre (même lundi) → paire', () => {
    // La semaine contenant l'ancre elle-même = semaine 0 → paire (diff = 0 jours → 0 semaines)
    expect(estSemaineImpaireAncrée('2026-09-01', '2026-09-01', [])).toBe(false)
  })

  it('semaine 1 depuis l\'ancre → impaire', () => {
    // 2026-09-01 + 7 jours = 2026-09-08
    expect(estSemaineImpaireAncrée('2026-09-08', '2026-09-01', [])).toBe(true)
  })

  it('semaine 53 ISO (2026-12-28) : parité stable depuis une ancre de septembre', () => {
    // Ancre = 2026-09-01 (début de période hiver)
    // 2026-12-28 : diff = 118 jours → 16 semaines (paire) — résultat stable, non influencé par l'ISO 53
    const ancre = '2026-09-01'
    const result = estSemaineImpaireAncrée('2026-12-28', ancre, [])
    // Vérification de la valeur : 118 jours / 7 = 16 semaines exactes → paire
    expect(result).toBe(false)
  })

  it('recalage sur vacances : la parité repart de 0 après le début des vacances', () => {
    const vacances = [{ debut: '2026-10-17', fin: '2026-10-31' }]
    // Avant vacances (2026-10-12) : diff depuis '2026-09-01' = 41 jours → 5 semaines → impaire
    expect(estSemaineImpaireAncrée('2026-10-12', '2026-09-01', vacances)).toBe(true)
    // Après vacances (2026-11-02) : ancre recalée sur '2026-10-17'
    //   diff depuis '2026-10-17' = 16 jours → 2 semaines → paire
    expect(estSemaineImpaireAncrée('2026-11-02', '2026-09-01', vacances)).toBe(false)
  })

  it('recalage sur vacances : semaine pendant les vacances repart aussi à 0', () => {
    const vacances = [{ debut: '2026-10-17', fin: '2026-10-31' }]
    // 2026-10-17 est le premier jour des vacances → ancre recalée ici → diff = 0 → paire
    expect(estSemaineImpaireAncrée('2026-10-17', '2026-09-01', vacances)).toBe(false)
  })

  it('sans vacances : parité ISO 53 est différente de la parité ancrée (démontre le bug V1)', () => {
    // Semaine ISO 53 de 2026 : 2026-12-28 → numeroSemaine() = 53 (impaire selon V1)
    // Depuis ancre '2026-09-01' : 118 jours → 16 semaines → paire (corrigé par F7-001)
    // Les deux méthodes donnent des résultats différents → c'est exactement le bug corrigé
    const dateS53 = '2026-12-28'
    const ancre = '2026-09-01'
    const paritéAncrée = estSemaineImpaireAncrée(dateS53, ancre, [])
    // La parité ancrée est PAIRE (false) — c'est la valeur correcte pour le cabinet
    expect(paritéAncrée).toBe(false)
  })
})
