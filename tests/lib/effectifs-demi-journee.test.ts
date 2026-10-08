// ============================================================
// Les effectifs par demi-journee (B-153 lot 1)
// ============================================================
// La ligne « Presents » du bas de case deplieee, dans le design « Planning
// Cabinet V2 », annonce deux chiffres : le matin et l'apres-midi.
//
// Ce que ces tests protegent — chacun correspond a un defaut DEJA PAYE sur ce
// projet, pas a une precaution theorique :
//
//  ① DES PERSONNES, PAS DES LIGNES. Compter les presences afficherait « 8 »
//     pour 5 personnes presentes matin et apres-midi. C'est le defaut que
//     `JourneeAffichee.personnes` documente deja.
//  ② LA COUPURE SUIT LE RAIL, pas 12h en dur — B-144 a etabli qu'une tranche
//     peut couvrir autre chose que ce que son nom annonce.
//  ③ AUCUN MINIMUM. Le prototype en montre (« mat. 2/3 » en rouge) ; la donnee
//     n'existe pas au schema et MiKL l'a ecartee le 06/10.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  effectifsDemiJournee,
  type LigneVetoJour,
} from '../../src/lib/planning/grilleSemaines'

/** Une ligne de personne, avec ses presences deja posees sur le rail. */
function ligne(
  vetId: string,
  positions: { gauche: number; largeur: number }[],
): LigneVetoJour {
  return {
    vetId,
    journee: positions.map((position, i) => ({
      presence: {
        id: `${vetId}-${i}`,
        vetId,
        prenom: vetId,
        couleur: null,
        tranche: 'Tranche',
        heures: '',
        debut: null,
        fin: null,
        ordre: i,
        deLaTrame: false,
        anomalie: null,
      },
      position,
    })),
    nuit: null,
    absence: null,
    vide: positions.length === 0,
  }
}

describe('effectifsDemiJournee', () => {
  it('compte une personne dans chaque demi-journee qu’elle couvre', () => {
    // Journee complete : 0 % → 100 %.
    expect(effectifsDemiJournee([ligne('a', [{ gauche: 0, largeur: 100 }])])).toEqual({
      matin: 1,
      apresMidi: 1,
    })
  })

  it('🔴 ne compte JAMAIS deux fois la meme personne dans la meme colonne', () => {
    // Deux tranches le matin (8h–10h puis 10h–12h) : UNE personne le matin.
    // Compter les lignes donnerait 2, soit un effectif superieur a la realite —
    // le defaut exact que `JourneeAffichee.personnes` documente.
    const l = ligne('a', [
      { gauche: 0, largeur: 20 },
      { gauche: 20, largeur: 20 },
    ])
    expect(effectifsDemiJournee([l])).toEqual({ matin: 1, apresMidi: 0 })
  })

  it('sepapare matin et apres-midi a la MI-RAIL, pas a une heure en dur', () => {
    const matinSeul = ligne('a', [{ gauche: 0, largeur: 49 }])
    const apremSeul = ligne('b', [{ gauche: 51, largeur: 49 }])
    expect(effectifsDemiJournee([matinSeul, apremSeul])).toEqual({
      matin: 1,
      apresMidi: 1,
    })
  })

  it('ne fait pas deborder une tranche qui finit PILE a la mi-journee', () => {
    // 8h–13h sur un rail 8h–18h : la barre finit a 50 %. Elle ne doit pas
    // compter dans l'apres-midi — sinon tout cabinet en demi-journees
    // afficherait un effectif d'apres-midi faux, tous les jours.
    expect(effectifsDemiJournee([ligne('a', [{ gauche: 0, largeur: 50 }])])).toEqual({
      matin: 1,
      apresMidi: 0,
    })
  })

  it('ne fait pas deborder une tranche qui commence PILE a la mi-journee', () => {
    expect(effectifsDemiJournee([ligne('a', [{ gauche: 50, largeur: 50 }])])).toEqual({
      matin: 0,
      apresMidi: 1,
    })
  })

  it('ignore les presences sans position — rien a dessiner, rien a compter', () => {
    const l: LigneVetoJour = { ...ligne('a', [{ gauche: 0, largeur: 100 }]) }
    l.journee[0].position = null
    expect(effectifsDemiJournee([l])).toEqual({ matin: 0, apresMidi: 0 })
  })

  it('rend zero sur une journee vide, et ne leve pas', () => {
    expect(effectifsDemiJournee([])).toEqual({ matin: 0, apresMidi: 0 })
    expect(effectifsDemiJournee([ligne('a', [])])).toEqual({ matin: 0, apresMidi: 0 })
  })

  it('additionne des personnes DISTINCTES', () => {
    const l = [
      ligne('a', [{ gauche: 0, largeur: 100 }]),
      ligne('b', [{ gauche: 0, largeur: 40 }]),
      ligne('c', [{ gauche: 60, largeur: 40 }]),
    ]
    expect(effectifsDemiJournee(l)).toEqual({ matin: 2, apresMidi: 2 })
  })
})
