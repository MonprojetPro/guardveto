// ============================================================
// B-053 — aucun code machine sous les yeux de l'utilisateur
// ============================================================
// Trois écrans nettoyaient le préfixe des messages de règle, chacun avec sa
// copie limitée à `/^R\d+ : /`. Les refus réellement rencontrés en production
// ne s'écrivent pas tous comme ça : `ESPACEMENT : `, `FREQ_WE : `, `R3/R5 : `
// passaient donc à l'écran tels quels.
//
// Les codes de ce test viennent d'une mesure réelle (génération Hiver P1 du
// 26/08), pas d'une liste imaginée.
// ============================================================

import { describe, it, expect } from 'vitest'
import { sansCodeTechnique } from '@/lib/regles/sansCodeTechnique'

describe('sansCodeTechnique', () => {
  it('retire les préfixes réellement produits par le moteur', () => {
    const cas: [string, string][] = [
      ['R16 : Manon est en congé du 14 septembre 2026 au 27 septembre 2026',
        'Manon est en congé du 14 septembre 2026 au 27 septembre 2026'],
      ['R3/R5 : Antoine est en repos le jeudi', 'Antoine est en repos le jeudi'],
      ['ESPACEMENT : Fanny doit espacer ses gardes d’au moins 2 jour(s)',
        'Fanny doit espacer ses gardes d’au moins 2 jour(s)'],
      ['FREQ_WE : Antoine ne doit pas faire plus d’un week-end toutes les 2 semaines',
        'Antoine ne doit pas faire plus d’un week-end toutes les 2 semaines'],
      ['R21 : Jean occupe déjà une place de ce créneau',
        'Jean occupe déjà une place de ce créneau'],
    ]
    for (const [brut, attendu] of cas) {
      expect(sansCodeTechnique(brut)).toBe(attendu)
    }
  })

  it('laisse intact un message qui n’a pas de code', () => {
    expect(sansCodeTechnique('Fanny ne fait pas de garde la nuit du mercredi'))
      .toBe('Fanny ne fait pas de garde la nuit du mercredi')
  })

  it('ne mange pas une phrase qui contient un deux-points plus loin', () => {
    expect(sansCodeTechnique('Anne-Sophie est indisponible : semaine impaire'))
      .toBe('Anne-Sophie est indisponible : semaine impaire')
  })

  it('encaisse le vide sans rien inventer', () => {
    expect(sansCodeTechnique(undefined)).toBe('')
    expect(sansCodeTechnique(null)).toBe('')
    expect(sansCodeTechnique('   ')).toBe('')
  })
})
