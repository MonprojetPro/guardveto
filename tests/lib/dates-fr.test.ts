import { describe, it, expect } from 'vitest'
import { dateFr, dateFrCourte, dateFrSansJour, periodeFr, horodatageFr } from '@/lib/dates-fr'

describe('dates-fr — aucune date ISO ne doit atteindre un écran', () => {
  it('écrit une date en toutes lettres', () => {
    expect(dateFr('2026-10-03')).toBe('samedi 3 octobre 2026')
  })

  it('écrit la forme courte pour les énumérations', () => {
    expect(dateFrCourte('2026-10-03')).toBe('sam. 3 oct.')
  })

  it('écrit la forme sans jour de semaine', () => {
    expect(dateFrSansJour('2026-10-03')).toBe('3 octobre 2026')
  })

  // Le piège qui a motivé `T12:00:00Z` : minuit UTC bascule à la veille dans
  // les fuseaux à l'ouest. Un 1er du mois est le cas le plus exposé.
  it('ne décale pas la date d’un jour', () => {
    expect(dateFr('2026-11-01')).toBe('dimanche 1 novembre 2026')
    expect(dateFr('2026-01-01')).toBe('jeudi 1 janvier 2026')
  })

  it('accepte un horodatage complet', () => {
    expect(dateFrSansJour('2026-10-03T18:30:00+02:00')).toBe('3 octobre 2026')
  })

  describe('periodeFr', () => {
    // « en congé du 3 octobre au 3 octobre » se lisait comme un bug d'affichage.
    it('dit « le X » quand début et fin sont le même jour', () => {
      expect(periodeFr('2026-10-03', '2026-10-03')).toBe('le 3 octobre 2026')
    })

    it('dit « du X au Y » sur un intervalle', () => {
      expect(periodeFr('2026-10-03', '2026-10-07')).toBe(
        'du 3 octobre 2026 au 7 octobre 2026',
      )
    })

    it('se contente du début quand la fin manque', () => {
      expect(periodeFr('2026-10-03', '')).toBe('le 3 octobre 2026')
    })
  })

  // On dégrade vers « moins riche », jamais vers « invisible » : un fragment
  // technique lisible signale le défaut, un vide le masque.
  it('rend une valeur illisible telle quelle plutôt que de l’effacer', () => {
    expect(dateFr('pas-une-date')).toBe('pas-une-date')
    expect(dateFr('')).toBe('')
  })

  // ── horodatageFr : un INSTANT, pas un jour (B-066) ──────────
  // Les autres fonctions de ce module décrivent des jours de garde ou de congé,
  // où l'heure n'existe pas. Un horodatage répond à « quand cette demande
  // est-elle arrivée » — et deux demandes du même jour ne se départagent que
  // par l'heure.
  describe('horodatageFr', () => {
    const MAINTENANT = new Date('2026-08-27T10:00:00Z')

    it('donne le jour ET l’heure', () => {
      // 12:32 UTC = 14:32 à Paris en août (UTC+2).
      expect(horodatageFr('2026-08-12T12:32:00Z', MAINTENANT)).toBe('12 août à 14:32')
    })

    it('tait l’année quand c’est l’année en cours, et la dit sinon', () => {
      // « 12 août à 14:32 » se lit d'un coup d'œil onze mois sur douze ; mais
      // omettre l'année sur une demande de l'an dernier la ferait passer pour
      // récente — exactement le genre de silence qui trompe.
      expect(horodatageFr('2026-08-12T12:32:00Z', MAINTENANT)).not.toContain('2026')
      expect(horodatageFr('2025-08-12T12:32:00Z', MAINTENANT)).toContain('2025')
    })

    it('affiche l’heure de PARIS, pas celle d’UTC', () => {
      // ⚠️ Le piège réel : une décision prise à 00:30 à Paris est à 22:30 UTC
      // la VEILLE. Sans fuseau explicite, elle se serait affichée au mauvais
      // jour pour qui consulte depuis un serveur en UTC.
      expect(horodatageFr('2026-08-11T22:30:00Z', MAINTENANT)).toBe('12 août à 00:30')
    })

    it('tient compte de l’heure d’hiver', () => {
      // Janvier : Paris est à UTC+1, pas +2. Un décalage figé se serait vu ici.
      expect(horodatageFr('2026-01-15T12:00:00Z', MAINTENANT)).toContain('13:00')
    })

    it('rend une valeur illisible telle quelle, et le vide reste vide', () => {
      expect(horodatageFr('pas-un-instant', MAINTENANT)).toBe('pas-un-instant')
      expect(horodatageFr('', MAINTENANT)).toBe('')
    })
  })
})
