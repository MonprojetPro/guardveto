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
  // NOTE (correctif parité intra-semaine 2026-06) : date, ancre et recalages
  // sont désormais ramenés au LUNDI de leur semaine. La parité est donc STABLE
  // sur toute une semaine calendaire (cf. describe dédié plus bas). Les valeurs
  // ci-dessous sont calculées entre LUNDIS de semaines.

  it('semaine 0 depuis l\'ancre (même semaine) → paire', () => {
    // La semaine contenant l'ancre elle-même = semaine 0 → paire
    expect(estSemaineImpaireAncrée('2026-09-01', '2026-09-01', [])).toBe(false)
  })

  it('semaine 1 depuis l\'ancre → impaire', () => {
    // lundi semaine ancre = 2026-08-31 ; lundi de 2026-09-08 = 2026-09-07 → +1 semaine → impaire
    expect(estSemaineImpaireAncrée('2026-09-08', '2026-09-01', [])).toBe(true)
  })

  it('semaine 53 ISO (2026-12-28) : parité stable depuis une ancre de septembre', () => {
    // Ancre lundi = 2026-08-31 ; 2026-12-28 est un lundi → diff = 119 jours = 17 semaines → impaire.
    // L'important : la valeur ne dépend PAS du numéro ISO 53 — elle reste stable.
    const ancre = '2026-09-01'
    const result = estSemaineImpaireAncrée('2026-12-28', ancre, [])
    expect(result).toBe(true)
  })

  it('recalage sur vacances : la parité repart de 0 après le début des vacances', () => {
    const vacances = [{ debut: '2026-10-17', fin: '2026-10-31' }]
    // Avant vacances (2026-10-12, lundi) : diff depuis lundi 2026-08-31 = 42 jours → 6 semaines → paire
    expect(estSemaineImpaireAncrée('2026-10-12', '2026-09-01', vacances)).toBe(false)
    // Après vacances (2026-11-02, lundi) : ancre recalée sur lundi de 2026-10-17 = 2026-10-12
    //   diff = 21 jours → 3 semaines → impaire
    expect(estSemaineImpaireAncrée('2026-11-02', '2026-09-01', vacances)).toBe(true)
  })

  it('recalage sur vacances : semaine pendant les vacances repart aussi à 0', () => {
    const vacances = [{ debut: '2026-10-17', fin: '2026-10-31' }]
    // 2026-10-17 (samedi) est dans la semaine de vacances → ancre recalée sur son lundi
    //   (2026-10-12) → diff = 0 → paire
    expect(estSemaineImpaireAncrée('2026-10-17', '2026-09-01', vacances)).toBe(false)
  })

  it('sans vacances : parité ISO 53 est différente de la parité ISO globale (démontre le bug V1)', () => {
    // Semaine ISO 53 de 2026 : 2026-12-28 → numeroSemaine() = 53 (impaire selon V1).
    // La parité ancrée reste stable et indépendante de l'ISO 53.
    const dateS53 = '2026-12-28'
    const ancre = '2026-09-01'
    const paritéAncrée = estSemaineImpaireAncrée(dateS53, ancre, [])
    expect(paritéAncrée).toBe(true)
  })
})

describe('estSemaineImpaireAncrée — parité STABLE sur toute la semaine (correctif intra-semaine)', () => {
  // Bug observé (été 2026) : Anne-Sophie avait des gardes en semaines ISO 28/29/31/32,
  // mélange incohérent dû à une ancre (2026-09-01, un MARDI) utilisée brute → certains
  // jours d'une même semaine basculaient de parité. Désormais : tous les jours d'une
  // même semaine calendaire ont la MÊME parité.
  const ancre = '2026-09-01' // mardi — c'est ce décalage qui causait le bug

  it('lundi → dimanche d\'une même semaine ont tous la même parité', () => {
    // Semaine du lundi 2026-09-07 (lun..dim)
    const jours = [
      '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
      '2026-09-11', '2026-09-12', '2026-09-13',
    ]
    const parités = jours.map((d) => estSemaineImpaireAncrée(d, ancre, []))
    // Toutes identiques
    expect(new Set(parités).size).toBe(1)
  })

  it('la semaine de l\'ancre (mardi 2026-09-01) : lundi ET samedi sont PAIRS ensemble', () => {
    // Avant le correctif : lundi 2026-08-31 = IMPAIRE, mardi 2026-09-01 = PAIRE (incohérent).
    const lundi = estSemaineImpaireAncrée('2026-08-31', ancre, [])
    const samedi = estSemaineImpaireAncrée('2026-09-05', ancre, [])
    expect(lundi).toBe(samedi)
    expect(lundi).toBe(false) // semaine 0 → paire
  })
})
