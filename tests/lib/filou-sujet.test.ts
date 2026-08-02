// ============================================================
// Le sujet transporté jusqu'à Filou
// ============================================================
// Cliquer « En parler avec moi » depuis un avertissement du gardien et arriver
// sur un « bonjour » générique, c'est perdre en route la seule chose qui
// comptait. Le sujet voyage donc dans le fragment d'URL, à côté de l'origine.
//
// Ce que ce test garde, ce sont les cas tordus : un message du moteur contient
// des guillemets français, des apostrophes courbes, des « & » et des accents —
// tout ce qui casse un fragment mal encodé.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  lienAccueilAvecSujet, lienAccueilDepuis, lireOrigine, lireSujet, portUneOrigine,
} from '@/lib/v2/filou-origine'

describe('aller-retour du sujet', () => {
  it.each([
    'Un réglage d’équité vise l’étiquette « senior », mais personne ne la porte.',
    'TOUS les vétérinaires actifs portent l’étiquette « toutes » : personne & rien.',
    'Créneau du 24/12 : aucune combinaison possible (100 % des vétos écartés)',
  ])('survit à l’encodage : %s', (sujet) => {
    const lien = lienAccueilAvecSujet('regles', sujet)
    const hash = lien.slice(lien.indexOf('#'))
    expect(lireSujet(hash)).toBe(sujet)
  })

  it('l’origine reste lisible à côté du sujet', () => {
    const lien = lienAccueilAvecSujet('regles', 'un souci quelconque')
    const hash = lien.slice(lien.indexOf('#'))
    expect(lireOrigine(hash)).toBe('regles')
    expect(portUneOrigine(hash)).toBe(true)
  })

  it('un sujet vide retombe sur le lien simple', () => {
    expect(lienAccueilAvecSujet('regles', '   ')).toBe(lienAccueilDepuis('regles'))
  })

  it('un très long message est tronqué, pas rejeté', () => {
    const long = 'a'.repeat(900)
    const lien = lienAccueilAvecSujet('regles', long)
    const lu = lireSujet(lien.slice(lien.indexOf('#')))
    expect(lu).not.toBeNull()
    expect(lu!.length).toBeLessThanOrEqual(400)
  })
})

describe('lireSujet — robustesse', () => {
  it('rend null quand le fragment n’en porte pas', () => {
    expect(lireSujet('#filou=regles')).toBeNull()
    expect(lireSujet('')).toBeNull()
  })

  it('rend null sur un fragment mal encodé plutôt que de planter', () => {
    // `%E0%A4%A` est une séquence tronquée : `decodeURIComponent` lève.
    expect(lireSujet('#filou=regles&sujet=%E0%A4%A')).toBeNull()
  })
})
