import { describe, it, expect } from 'vitest'
import {
  COULEUR_DEFAUT,
  encreLisible,
  hexValide,
  hexVersRgb,
  hexVersTsv,
  luminanceRelative,
  normaliserHex,
  pastilleTropPale,
  rapportContraste,
  rgbVersHex,
  rgbVersTsv,
  stylePastille,
  stylePastilleVar,
  stylePoint,
  stylePointVar,
  tsvVersHex,
  tsvVersRgb,
} from '@/lib/couleurs'

// ============================================================
// Ce qui est vérifié ici, c'est la promesse faite à Anne-Sophie : elle colle un
// code venu de Google Agenda, et ça marche — quelle que soit la façon dont elle
// l'a copié. Et quelle que soit la teinte, le texte posé dessus se lit.
// ============================================================

describe('normaliserHex — ce qu\'un humain colle réellement', () => {
  it('accepte la forme canonique', () => {
    expect(normaliserHex('#CF9E64')).toBe('#CF9E64')
  })

  it('accepte les minuscules et rend des majuscules', () => {
    expect(normaliserHex('#cf9e64')).toBe('#CF9E64')
  })

  it('accepte l\'absence de dièse — Google Agenda le donne parfois sans', () => {
    expect(normaliserHex('cf9e64')).toBe('#CF9E64')
  })

  it('accepte les espaces autour, que le presse-papiers traîne souvent', () => {
    expect(normaliserHex('  #CF9E64 \n')).toBe('#CF9E64')
  })

  it('développe la forme courte à trois chiffres comme le fait le CSS', () => {
    expect(normaliserHex('#abc')).toBe('#AABBCC')
    expect(normaliserHex('f00')).toBe('#FF0000')
  })

  it('refuse ce qui n\'est pas une couleur, sans en inventer une', () => {
    for (const mauvais of ['', '   ', '#12345', '#GGGGGG', 'rouge', '#1234567', '##ABCDEF']) {
      expect(normaliserHex(mauvais)).toBeNull()
    }
  })

  it('refuse null et undefined sans exploser', () => {
    expect(normaliserHex(null)).toBeNull()
    expect(normaliserHex(undefined)).toBeNull()
  })

  it('hexValide dit la même chose, en booléen', () => {
    expect(hexValide('#CF9E64')).toBe(true)
    expect(hexValide('abc')).toBe(true)
    expect(hexValide('pas une couleur')).toBe(false)
  })
})

describe('conversions RVB / TSV — un aller-retour ne doit rien perdre', () => {
  it('lit les canaux d\'un hexadécimal', () => {
    expect(hexVersRgb('#FF8000')).toEqual({ r: 255, g: 128, b: 0 })
  })

  it('réécrit un hexadécimal, en majuscules et sur deux chiffres', () => {
    expect(rgbVersHex({ r: 0, g: 5, b: 255 })).toBe('#0005FF')
  })

  it('borne les canaux hors plage plutôt que de produire un hex bancal', () => {
    expect(rgbVersHex({ r: -20, g: 300, b: 128 })).toBe('#00FF80')
  })

  it('trouve la teinte des couleurs cardinales', () => {
    expect(hexVersTsv('#FF0000').t).toBeCloseTo(0, 1)
    expect(hexVersTsv('#00FF00').t).toBeCloseTo(120, 1)
    expect(hexVersTsv('#0000FF').t).toBeCloseTo(240, 1)
  })

  it('donne saturation nulle aux gris, quelle que soit leur clarté', () => {
    expect(rgbVersTsv({ r: 128, g: 128, b: 128 }).s).toBe(0)
    expect(rgbVersTsv({ r: 0, g: 0, b: 0 }).s).toBe(0)
  })

  it('revient à la couleur de départ après un aller-retour', () => {
    for (const hex of ['#C0392B', '#0B7D6C', '#3B4FC4', '#FFF3B0', '#123456', '#FFFFFF', '#000000']) {
      expect(tsvVersHex(hexVersTsv(hex))).toBe(hex)
    }
  })

  it('recompose le blanc et le noir depuis leurs coordonnées TSV', () => {
    expect(tsvVersRgb({ t: 0, s: 0, v: 1 })).toEqual({ r: 255, g: 255, b: 255 })
    expect(tsvVersRgb({ t: 200, s: 1, v: 0 })).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('tourne autour de la roue sans se perdre aux bornes', () => {
    expect(tsvVersHex({ t: 360, s: 1, v: 1 })).toBe('#FF0000')
    expect(tsvVersHex({ t: -60, s: 1, v: 1 })).toBe('#FF00FF')
  })
})

describe('luminance et contraste — la mesure, pas l\'impression', () => {
  it('place le noir à 0 et le blanc à 1', () => {
    expect(luminanceRelative('#000000')).toBeCloseTo(0, 5)
    expect(luminanceRelative('#FFFFFF')).toBeCloseTo(1, 5)
  })

  it('pèse le vert bien plus que le bleu, comme le fait l\'œil', () => {
    expect(luminanceRelative('#00FF00')).toBeGreaterThan(luminanceRelative('#0000FF'))
  })

  it('donne 21 entre noir et blanc, et 1 entre une couleur et elle-même', () => {
    expect(rapportContraste('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
    expect(rapportContraste('#C0392B', '#C0392B')).toBeCloseTo(1, 5)
  })

  it('est symétrique — l\'ordre des deux couleurs ne change rien', () => {
    expect(rapportContraste('#C0392B', '#FFFFFF')).toBeCloseTo(
      rapportContraste('#FFFFFF', '#C0392B'),
      5,
    )
  })
})

describe('encreLisible — le cœur du chantier', () => {
  it('écrit en blanc sur les teintes sombres', () => {
    for (const sombre of ['#000000', '#1A1A1A', '#2C6BA8', '#C0392B', '#0B7D6C']) {
      expect(encreLisible(sombre)).toBe('#FFFFFF')
    }
  })

  it('écrit en sombre sur les teintes claires — les trois qu\'Anne-Sophie a demandées', () => {
    // Jaune clair (Fanny), orange clair (Victor), rose clair (Anne-Sophie).
    for (const clair of ['#FFF3B0', '#FFD8A8', '#F8C8D8', '#FFFFFF']) {
      expect(encreLisible(clair)).toBe('#1F2937')
    }
  })

  it('ne passe au sombre QUE là où le blanc ne tient plus, sur toute la roue', () => {
    for (let t = 0; t < 360; t += 15) {
      for (const v of [0.15, 0.45, 0.75, 1]) {
        const hex = tsvVersHex({ t, s: 0.8, v })
        const blancTient = rapportContraste(hex, '#FFFFFF') >= 3
        expect(encreLisible(hex), `sur ${hex}`).toBe(blancTient ? '#FFFFFF' : '#1F2937')
      }
    }
  })

  it('atteint partout le seuil des grands caractères (3:1), initiales comprises', () => {
    for (let t = 0; t < 360; t += 10) {
      for (const v of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
        for (const s of [0, 0.5, 1]) {
          const hex = tsvVersHex({ t, s, v })
          expect(rapportContraste(hex, encreLisible(hex))).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  /**
   * LE GARDE-FOU DE NON-RÉGRESSION.
   *
   * Ces quatorze teintes sont en base sur des fiches réelles, et elles
   * portaient toutes du texte blanc avant ce chantier. Si l'une d'elles se met
   * à réclamer une encre sombre, ce n'est pas une amélioration : c'est une
   * fiche existante qui change d'aspect sans que personne l'ait demandé.
   *
   * Une première version d'`encreLisible` prenait « le meilleur contraste des
   * deux » et faisait basculer l'ambre pour trois pour cent de gain. C'est ce
   * test qui l'a attrapée.
   */
  it('ne change RIEN aux quatorze teintes déjà en base — elles gardent le blanc', () => {
    const terrier = [
      '#C0392B', '#C7530F', '#B5761A', '#8A7A1E', '#5E7D1B', '#2F7D3F', '#0B7D6C',
      '#2E7A8C', '#2C6BA8', '#3B4FC4', '#6B4FBE', '#8E3FA8', '#B93A72', '#8A5A3C',
    ]
    for (const hex of terrier) {
      expect(encreLisible(hex), `${hex} devrait rester en blanc`).toBe('#FFFFFF')
    }
  })

  it('garde aussi le blanc sur le gris par défaut de la base', () => {
    expect(encreLisible(COULEUR_DEFAUT)).toBe('#FFFFFF')
  })

  it('retombe sur la couleur par défaut plutôt que de planter sur une saisie folle', () => {
    expect(encreLisible('pas une couleur')).toBe(encreLisible(COULEUR_DEFAUT))
    expect(encreLisible(null)).toBe(encreLisible(COULEUR_DEFAUT))
    expect(encreLisible(undefined)).toBe(encreLisible(COULEUR_DEFAUT))
  })
})

describe('stylePastille — fond et encre d\'un seul geste', () => {
  it('normalise le fond et pose l\'encre en variable pour le CSS', () => {
    expect(stylePastille('fff3b0')).toEqual({
      background: '#FFF3B0',
      color: '#1F2937',
      '--encre': '#1F2937',
    })
  })

  it('replie sur le gris par défaut quand la base contient n\'importe quoi', () => {
    expect(stylePastille(null).background).toBe(COULEUR_DEFAUT)
  })
})

describe('stylePoint — les pastilles muettes qui se perdraient sur le crème', () => {
  it('laisse nu un point assez foncé pour se voir', () => {
    expect(stylePoint('#C0392B')).toEqual({ background: '#C0392B', boxShadow: 'none' })
    expect(pastilleTropPale('#C0392B')).toBe(false)
  })

  it('pose un liseré sur un point presque blanc', () => {
    expect(pastilleTropPale('#FFFDF8')).toBe(true)
    expect(stylePoint('#FFFDF8').boxShadow).not.toBe('none')
  })

  it('laisse nues les trois teintes claires d\'Anne-Sophie — elles se voient encore', () => {
    // Mesuré : 1,46 / 1,70 / 1,76 de contraste avec le crème. C'est peu, mais
    // un point de 9 px reste perceptible ; le liseré est réservé aux teintes
    // franchement quasi blanches.
    for (const clair of ['#F2D06B', '#F5B884', '#F2AEC4']) {
      expect(pastilleTropPale(clair)).toBe(false)
    }
  })

  it('cerne les teintes quasi blanches, celles qui font un trou dans la page', () => {
    for (const presqueBlanc of ['#FFF3B0', '#FFFDF8', '#FFFFFF']) {
      expect(pastilleTropPale(presqueBlanc)).toBe(true)
    }
  })

  /**
   * Les deux cas s'affirment sur l'OBJET ENTIER plutôt qu'en allant chercher
   * `['--lisere']` dedans. Depuis `StyleAvecVariables`, l'indexation serait
   * typée et passerait — mais comparer l'objet complet vérifie plus de choses :
   * la valeur exacte du liseré, ET le fait qu'il n'y ait rien d'autre dedans.
   */
  it('sert la même décision par variables CSS', () => {
    expect(stylePointVar('#C0392B')).toEqual({ '--c': '#C0392B', '--lisere': 'none' })
    expect(stylePointVar('#FFFDF8')).toEqual({
      '--c': '#FFFDF8',
      '--lisere': 'inset 0 0 0 1px rgba(0,0,0,.28)',
    })
  })

  it('stylePastilleVar donne le fond et son encre, sans le fond en dur', () => {
    expect(stylePastilleVar('fff3b0')).toEqual({ '--c': '#FFF3B0', '--encre': '#1F2937' })
  })
})
