import { describe, it, expect } from 'vitest'
import { estJourFerie, estFeteFinAnnee, estSemaineImpaire, estEnEte } from '@/engine/utils'

// ── estJourFerie — fériés fixes ──────────────────────────

describe('estJourFerie — fériés fixes', () => {
  it('01-01 Jour de l\'An', () => expect(estJourFerie('2026-01-01')).toBe(true))
  it('05-01 Fête du Travail', () => expect(estJourFerie('2026-05-01')).toBe(true))
  it('05-08 Victoire 1945', () => expect(estJourFerie('2026-05-08')).toBe(true))
  it('07-14 Fête Nationale', () => expect(estJourFerie('2026-07-14')).toBe(true))
  it('08-15 Assomption', () => expect(estJourFerie('2026-08-15')).toBe(true))
  it('11-01 Toussaint', () => expect(estJourFerie('2026-11-01')).toBe(true))
  it('11-11 Armistice', () => expect(estJourFerie('2026-11-11')).toBe(true))
  it('12-25 Noël', () => expect(estJourFerie('2026-12-25')).toBe(true))

  it('jour ordinaire n\'est pas férié', () => expect(estJourFerie('2026-03-15')).toBe(false))
  it('24 déc n\'est pas férié officiel', () => expect(estJourFerie('2026-12-24')).toBe(false))
  it('31 déc n\'est pas férié officiel', () => expect(estJourFerie('2026-12-31')).toBe(false))
})

// ── estJourFerie — fériés mobiles 2026 ──────────────────

describe('estJourFerie — fériés mobiles 2026', () => {
  // Pâques 2026 : dimanche 5 avril (pas férié en France)
  // Lundi de Pâques : 6 avril 2026
  it('Lundi de Pâques 2026 (06 avril)', () => expect(estJourFerie('2026-04-06')).toBe(true))

  // Pâques + 39 jours = Jeudi de l'Ascension
  // 5 avril + 39 = 14 mai 2026
  it('Ascension 2026 (14 mai)', () => expect(estJourFerie('2026-05-14')).toBe(true))

  // Pâques + 50 jours = Lundi de Pentecôte
  // 5 avril + 50 = 25 mai 2026
  it('Lundi de Pentecôte 2026 (25 mai)', () => expect(estJourFerie('2026-05-25')).toBe(true))

  it('Dimanche de Pâques lui-même n\'est pas férié en France', () => {
    expect(estJourFerie('2026-04-05')).toBe(false)
  })

  it('lendemain de l\'Ascension n\'est pas férié', () => {
    expect(estJourFerie('2026-05-15')).toBe(false)
  })
})

// ── estJourFerie — fériés mobiles 2027 ──────────────────

describe('estJourFerie — fériés mobiles 2027', () => {
  // Pâques 2027 : 28 mars
  it('Lundi de Pâques 2027 (29 mars)', () => expect(estJourFerie('2027-03-29')).toBe(true))
  // Ascension : 28 mars + 39 = 6 mai
  it('Ascension 2027 (6 mai)', () => expect(estJourFerie('2027-05-06')).toBe(true))
  // Pentecôte : 28 mars + 50 = 17 mai
  it('Lundi de Pentecôte 2027 (17 mai)', () => expect(estJourFerie('2027-05-17')).toBe(true))
})

// ── estFeteFinAnnee ──────────────────────────────────────

describe('estFeteFinAnnee', () => {
  it('24 décembre (réveillon Noël)', () => expect(estFeteFinAnnee('2026-12-24')).toBe(true))
  it('25 décembre (Noël)', () => expect(estFeteFinAnnee('2026-12-25')).toBe(true))
  it('31 décembre (réveillon Jour de l\'An)', () => expect(estFeteFinAnnee('2026-12-31')).toBe(true))
  it('1er janvier (Jour de l\'An)', () => expect(estFeteFinAnnee('2027-01-01')).toBe(true))

  it('23 décembre n\'est pas une fête de fin d\'année', () => expect(estFeteFinAnnee('2026-12-23')).toBe(false))
  it('26 décembre n\'est pas une fête de fin d\'année', () => expect(estFeteFinAnnee('2026-12-26')).toBe(false))
  it('30 décembre n\'est pas une fête de fin d\'année', () => expect(estFeteFinAnnee('2026-12-30')).toBe(false))
  it('2 janvier n\'est pas une fête de fin d\'année', () => expect(estFeteFinAnnee('2027-01-02')).toBe(false))

  it('fonctionne quelle que soit l\'année', () => {
    expect(estFeteFinAnnee('2025-12-24')).toBe(true)
    expect(estFeteFinAnnee('2025-12-31')).toBe(true)
    expect(estFeteFinAnnee('2028-01-01')).toBe(true)
  })
})

// ── Vérifications saison été 2026 ────────────────────────

describe('estEnEte — saison 2026', () => {
  // Premier lundi de mai 2026 = 4 mai
  it('4 mai 2026 = début saison été', () => expect(estEnEte('2026-05-04')).toBe(true))
  it('3 mai 2026 = encore hiver', () => expect(estEnEte('2026-05-03')).toBe(false))
  it('mi-juillet = été', () => expect(estEnEte('2026-07-15')).toBe(true))
  // Dernier dimanche d'août 2026 = 30 août
  it('30 août 2026 = dernier jour été', () => expect(estEnEte('2026-08-30')).toBe(true))
  it('31 août 2026 = début hiver', () => expect(estEnEte('2026-08-31')).toBe(false))
})
