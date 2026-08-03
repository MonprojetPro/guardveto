import { describe, it, expect } from 'vitest'
import { lienVersRegles, ancresDeFocus, libelleRenvoiRegles } from '@/lib/regles/focusRegles'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('lienVersRegles', () => {
  it('cible une règle unique', () => {
    expect(lienVersRegles([A])).toBe(`/regles?focus=${A}`)
  })

  it('cible plusieurs règles d’un coup', () => {
    // La virgule est le séparateur : elle ne doit pas être ré-encodée en %2C,
    // sinon l'écran reçoit une seule ancre géante qui ne correspond à rien.
    expect(lienVersRegles([A, B])).toBe(`/regles?focus=${A}%2C${B}`)
  })

  it('retombe sur l’écran nu quand aucune règle n’est connue', () => {
    expect(lienVersRegles([])).toBe('/regles')
    expect(lienVersRegles(['', '  '])).toBe('/regles')
  })

  it('respecte une base différente', () => {
    expect(lienVersRegles([A], '/equipe')).toBe(`/equipe?focus=${A}`)
    expect(lienVersRegles([], '/equipe')).toBe('/equipe')
  })
})

describe('ancresDeFocus', () => {
  it('relit ce que lienVersRegles a écrit', () => {
    const url = new URL(`https://x.test${lienVersRegles([A, B])}`)
    expect(ancresDeFocus(url.searchParams.get('focus'))).toEqual([A, B])
  })

  it('accepte une ancre seule (le format historique)', () => {
    expect(ancresDeFocus('serie_max')).toEqual(['serie_max'])
  })

  it('ne produit JAMAIS d’ancre vide', () => {
    // Une ancre vide construirait un sélecteur CSS invalide côté écran.
    expect(ancresDeFocus(',,')).toEqual([])
    expect(ancresDeFocus(`${A}, ,${B}`)).toEqual([A, B])
    expect(ancresDeFocus('')).toEqual([])
    expect(ancresDeFocus(null)).toEqual([])
    expect(ancresDeFocus(undefined)).toEqual([])
  })

  it('tolère les espaces autour des ancres', () => {
    expect(ancresDeFocus(`  ${A} ,  ${B}  `)).toEqual([A, B])
  })
})

describe('libelleRenvoiRegles', () => {
  it('annonce combien de règles seront éclairées', () => {
    expect(libelleRenvoiRegles(1)).toBe('Voir la règle en cause')
    expect(libelleRenvoiRegles(6)).toBe('Voir les 6 règles en cause')
  })

  it('garde le libellé du renvoi générique quand rien n’est ciblé', () => {
    expect(libelleRenvoiRegles(0, 'Relever les plafonds')).toBe('Relever les plafonds')
    expect(libelleRenvoiRegles(0)).toBe('Ouvrir les règles')
  })
})
