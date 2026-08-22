import { describe, it, expect } from 'vitest'
import { dateFr, dateFrCourte, dateFrSansJour, periodeFr } from '@/lib/dates-fr'

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
})
