// ============================================================
// GUARDVETO — Le jumeau orthographique d'une étiquette
// ============================================================
// « séniors » écrit là où l'équipe dit « senior » : le geste réussit, la fiche
// affiche la nouvelle étiquette, l'admin voit que ça a marché — et les règles
// portant sur « senior » cessent d'atteindre cette personne, sans un mot.
//
// Ces tests fixent la frontière : on signale la RESSEMBLANCE, on ne bloque
// jamais une étiquette réellement nouvelle.
// ============================================================

import { describe, it, expect } from 'vitest'
import { clefEtiquette, distanceEdition, etiquettesProches } from '@/lib/equipe/etiquettes'

const EN_USAGE = ['junior', 'senior', 'mi-temps']

describe('etiquettesProches — signale le jumeau, laisse passer la nouveauté', () => {
  it('signale l’accent en trop : « séniors » quand « senior » existe', () => {
    expect(etiquettesProches(['séniors'], EN_USAGE)).toEqual([
      { demandee: 'séniors', proches: ['senior'] },
    ])
  })

  it('signale l’accent seul : « sénior » quand « senior » existe', () => {
    expect(etiquettesProches(['sénior'], EN_USAGE)[0].proches).toEqual(['senior'])
  })

  it('signale le pluriel : « juniors » quand « junior » existe', () => {
    expect(etiquettesProches(['juniors'], EN_USAGE)[0].proches).toEqual(['junior'])
  })

  it('signale l’espace mis à la place du tiret : « mi temps »', () => {
    expect(etiquettesProches(['mi temps'], EN_USAGE)[0].proches).toEqual(['mi-temps'])
  })

  it('ne dit RIEN d’une étiquette déjà en usage — c’est le cas normal', () => {
    expect(etiquettesProches(['senior', 'junior'], EN_USAGE)).toEqual([])
  })

  it('ne dit rien de la casse ni des espaces en bordure', () => {
    expect(etiquettesProches(['  SENIOR '], EN_USAGE)).toEqual([])
  })

  it('laisse passer une étiquette franchement nouvelle : créer est légitime', () => {
    expect(etiquettesProches(['astreinte', 'chirurgie'], EN_USAGE)).toEqual([])
  })

  it('ne confond pas deux étiquettes réellement différentes : junior ≠ senior', () => {
    expect(etiquettesProches(['junior'], ['senior'])).toEqual([])
  })

  it('sans vocabulaire au cabinet, la première étiquette ne ressemble à rien', () => {
    expect(etiquettesProches(['senior'], [])).toEqual([])
  })

  it('dédoublonne la demande et ignore le vide', () => {
    expect(etiquettesProches(['séniors', 'séniors', '', '   '], EN_USAGE)).toHaveLength(1)
  })

  it('remonte toutes les voisines quand il y en a plusieurs', () => {
    expect(etiquettesProches(['seniorr'], ['senior', 'seniors'])[0].proches).toEqual([
      'senior',
      'seniors',
    ])
  })
})

describe('clefEtiquette — la forme sur laquelle on compare', () => {
  it('retire les accents, la casse et les espaces de bordure', () => {
    expect(clefEtiquette('  Sénior ')).toBe('senior')
  })

  it('garde les tirets et les espaces internes — deux écritures restent distinctes', () => {
    expect(clefEtiquette('Mi-Temps')).toBe('mi-temps')
    expect(clefEtiquette('mi temps')).toBe('mi temps')
  })
})

describe('distanceEdition — plafonnée, pour ne pas inventer des ressemblances', () => {
  it('rend 0 pour deux mots identiques', () => {
    expect(distanceEdition('senior', 'senior')).toBe(0)
  })

  it('rend 1 pour une lettre en plus, en moins ou changée', () => {
    expect(distanceEdition('senior', 'seniors')).toBe(1)
    expect(distanceEdition('seniors', 'senior')).toBe(1)
    expect(distanceEdition('senior', 'senlor')).toBe(1)
  })

  it('plafonne au-delà : junior et senior ne sont pas des jumeaux', () => {
    expect(distanceEdition('junior', 'senior')).toBe(2)
  })

  it('coupe court quand les longueurs sont trop éloignées', () => {
    expect(distanceEdition('senior', 'chirurgie viscerale')).toBe(2)
  })
})
