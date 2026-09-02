// ============================================================
// B-107 — Le résumé COMPTE, il n'interprète pas
// ============================================================
// La refonte de l'écran de fin de génération ajoute deux calculs : le bilan
// d'un mouvement (« Antoine −1 · Fanny +1 ») et le regroupement des constats
// par personne. Les deux s'affichent à l'admin comme des faits.
//
// Le risque est donc exactement celui que ce projet combat depuis le début :
// une phrase fausse présentée avec l'aplomb d'une phrase juste. D'où ces
// tests, qui portent sur les cas où un résumé pourrait MENTIR :
//
//   • quelqu'un qui sort d'une place et en reprend une autre (B-098 : Filou
//     annonçait « allège Victor » sur un mouvement où Victor restait de garde) ;
//   • un geste au format inattendu, qui rendrait le total faux sans le dire ;
//   • deux prénoms dont l'un est contenu dans l'autre (Anne / Anne-Sophie).
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  effetSurLesPersonnes,
  resumerEffet,
  prenomCite,
  grouperParPersonne,
} from '@/lib/relecture/resume'

/** Les gestes réels du rapport du 02/09, copiés tels quels. */
const GESTES_REELS = [
  'vendredi 6 novembre 2026 · Soir du vendredi · second : Fanny à la place de Antoine',
  'samedi 7 novembre 2026 · Week-end (sam+dim) · premier : Fanny à la place de Antoine',
  'lundi 2 novembre 2026 · Soir de semaine (lun-jeu) · premier : Fanny à la place de Victor',
  'mercredi 4 novembre 2026 · Soir de semaine (lun-jeu) · premier : Manon à la place de Victor',
  'jeudi 5 novembre 2026 · Soir de semaine (lun-jeu) · premier : Victor à la place de Manon',
  'jeudi 5 novembre 2026 · Soir de semaine (lun-jeu) · second : Antoine à la place de Fanny',
]

describe('B-107 — le bilan d’un mouvement', () => {
  it('compte le NET, jamais les mouvements bruts', () => {
    const { allege, charge } = effetSurLesPersonnes(GESTES_REELS)

    // Antoine sort de 2 places et en reprend 1 : net −1, et surtout pas −2.
    expect(allege.get('Antoine')).toBe(1)
    // Fanny prend 3 places et en rend 1 : net +2.
    expect(charge.get('Fanny')).toBe(2)
    // Victor sort de 2 et reprend 1 : net −1.
    expect(allege.get('Victor')).toBe(1)
    // Manon prend 1 et rend 1 : elle n'apparaît NULLE PART.
    expect(allege.has('Manon')).toBe(false)
    expect(charge.has('Manon')).toBe(false)
  })

  it('💣 ne dit jamais qu’il allège quelqu’un qui reste de garde autant (B-098)', () => {
    // Le défaut exact du 02/09 : une inversion de rôle sur le même soir, que
    // Filou annonçait comme « allège le lundi de Victor » alors que Victor
    // restait de garde. Un net nul ne doit produire AUCUNE mention.
    const inversion = [
      'lundi 9 novembre 2026 · Soir de semaine · premier : Jean à la place de Victor',
      'lundi 9 novembre 2026 · Soir de semaine · second : Victor à la place de Jean',
    ]
    expect(resumerEffet(inversion)).toBeNull()
  })

  it('se tait plutôt que de compter faux quand un geste est illisible', () => {
    // Un format inattendu rendrait le total silencieusement partiel. On préfère
    // « 6 changements » (vrai) à « Antoine −1 » (peut-être faux).
    const abime = [...GESTES_REELS, 'mardi 10 novembre 2026 · format inconnu']
    expect(resumerEffet(abime)).toBeNull()
    expect(effetSurLesPersonnes(abime).complet).toBe(false)
  })

  it('rend une ligne lisible sur le cas réel', () => {
    const resume = resumerEffet(GESTES_REELS)
    expect(resume).toContain('Antoine −1')
    expect(resume).toContain('Fanny +2')
    expect(resume).not.toContain('Manon')
  })

  it('ne rend rien sur une liste vide — il n’y a rien à résumer', () => {
    expect(resumerEffet([])).toBeNull()
  })
})

describe('B-107 — regrouper les constats par personne', () => {
  const EQUIPE = ['Antoine', 'Fanny', 'Victor', 'Manon', 'Jean', 'Anne-Sophie', 'Anne-Catherine']

  it('💣 ne confond pas deux prénoms dont l’un contient l’autre', () => {
    // Sans tri par longueur, « Anne » (s'il existait) ou une comparaison naïve
    // rangerait Anne-Sophie et Anne-Catherine ensemble. Deux personnes
    // distinctes réunies sous un même nom, c'est un rapport qui ment.
    expect(prenomCite('Anne-Sophie fait 4 week-ends', EQUIPE)).toBe('Anne-Sophie')
    expect(prenomCite('Anne-Catherine est en dernier recours', EQUIPE)).toBe('Anne-Catherine')
  })

  it('retient le prénom CITÉ EN PREMIER, qui est le sujet de la phrase', () => {
    expect(
      prenomCite('Antoine fait 27 gardes contre 17 pour Anne-Sophie', EQUIPE),
    ).toBe('Antoine')
  })

  it('range à part ce qui ne vise personne', () => {
    expect(prenomCite('2 places restent vides fin décembre', EQUIPE)).toBeNull()
  })

  it('groupe les 9 constats du 02/09 — sept parlaient de la même personne', () => {
    const constats = [
      { constat: 'Antoine fait 27 gardes contre 17 pour Anne-Sophie.' },
      { constat: 'Fanny fait 3 week-ends mais n’est première qu’une seule fois.' },
      { constat: 'Antoine enchaîne 4 week-ends à 14 jours d’écart.' },
      { constat: 'Antoine enchaîne souvent un mardi juste après un week-end.' },
      { constat: 'Antoine, déjà le plus chargé l’hiver dernier, recommence.' },
      { constat: 'Antoine cumule 40 gardes sur les deux dernières périodes.' },
      { constat: '2 places restent vides et personne ne peut les prendre.' },
    ]
    const groupes = grouperParPersonne(constats, EQUIPE)

    // Trois lignes au lieu de sept cartes : c'est tout l'objet de la refonte.
    expect(groupes).toHaveLength(3)
    expect(groupes[0].qui).toBe('Antoine')
    expect(groupes[0].points).toHaveLength(5)
    expect(groupes[1].qui).toBe('Fanny')
    expect(groupes[2].qui).toBeNull()
  })

  it('garde l’ORDRE de Filou — regrouper n’est pas rejuger', () => {
    // Filou classe ses constats par importance. Un regroupement qui les
    // réordonnerait ferait remonter un point mineur au-dessus d'un point grave.
    const constats = [
      { constat: 'Antoine est le plus chargé.' },
      { constat: 'Fanny n’est jamais première.' },
      { constat: 'Antoine ne récupère pas assez.' },
    ]
    const groupes = grouperParPersonne(constats, EQUIPE)
    expect(groupes.map((g) => g.qui)).toEqual(['Antoine', 'Fanny'])
    expect(groupes[0].points[0].constat).toBe('Antoine est le plus chargé.')
  })

  it('sans prénoms connus, ne groupe RIEN plutôt que de grouper au hasard', () => {
    // Le repli honnête : un rapport à plat est moins lisible, jamais faux.
    const constats = [{ constat: 'Antoine est le plus chargé.' }]
    const groupes = grouperParPersonne(constats, [])
    expect(groupes).toHaveLength(1)
    expect(groupes[0].qui).toBeNull()
    expect(groupes[0].points).toHaveLength(1)
  })
})
