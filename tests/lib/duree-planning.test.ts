import { describe, it, expect } from 'vitest'
import { estLundi, dureeProposee, finApres } from '@/lib/planning/duree'

describe('estLundi', () => {
  it('reconnaît un lundi', () => {
    expect(estLundi('2027-01-04')).toBe(true) // lundi
  })

  it('refuse les six autres jours', () => {
    expect(estLundi('2027-01-03')).toBe(false) // dimanche
    expect(estLundi('2027-01-05')).toBe(false) // mardi
  })

  it('refuse ce qui n’est pas une date ISO', () => {
    expect(estLundi('')).toBe(false)
    expect(estLundi('04/01/2027')).toBe(false)
  })
})

describe('dureeProposee', () => {
  it('propose 17 semaines de mai à août', () => {
    expect(dureeProposee('2027-05-03')).toBe(17)
    expect(dureeProposee('2027-08-30')).toBe(17)
  })

  it('propose 12 semaines le reste de l’année', () => {
    expect(dureeProposee('2027-01-04')).toBe(12)
    expect(dureeProposee('2027-04-26')).toBe(12)
    expect(dureeProposee('2027-09-06')).toBe(12)
  })

  it('retombe sur 12 sans date exploitable', () => {
    expect(dureeProposee('')).toBe(12)
  })
})

describe('finApres', () => {
  it('termine un dimanche, pas le lundi suivant', () => {
    // 12 semaines à partir du lundi 4 janvier 2027 → dimanche 28 mars 2027.
    expect(finApres('2027-01-04', 12)).toBe('2027-03-28')
    expect(estLundi('2027-01-04')).toBe(true)
    expect(new Date('2027-03-28T12:00:00Z').getUTCDay()).toBe(0) // dimanche
  })

  it('couvre 7 jours pour une semaine', () => {
    expect(finApres('2027-01-04', 1)).toBe('2027-01-10')
  })

  it('gère les 17 semaines d’été et le passage de mois', () => {
    expect(finApres('2027-05-03', 17)).toBe('2027-08-29')
  })

  it('franchit une année bissextile sans décaler', () => {
    // 2028 est bissextile : février compte 29 jours.
    expect(finApres('2028-02-07', 4)).toBe('2028-03-05')
  })

  it('deux plannings consécutifs ne se chevauchent pas', () => {
    const fin = finApres('2027-01-04', 12)!
    const suivant = new Date(`${fin}T12:00:00Z`)
    suivant.setUTCDate(suivant.getUTCDate() + 1)
    expect(suivant.toISOString().slice(0, 10)).toBe('2027-03-29')
    expect(estLundi('2027-03-29')).toBe(true)
  })

  it('refuse une durée nulle, négative ou une date illisible', () => {
    expect(finApres('2027-01-04', 0)).toBeNull()
    expect(finApres('2027-01-04', -3)).toBeNull()
    expect(finApres('', 12)).toBeNull()
  })
})
