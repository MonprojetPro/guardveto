// ============================================================
// L'empreinte d'une règle — deux règles font-elles la même chose ?
// ============================================================
// Le premier cas est RÉEL : ce sont les deux lignes trouvées en base le
// 2026-08-02, celle des données d'origine du cabinet et celle que MiKL venait
// de créer. Elles ont des JSON différents et un effet strictement identique —
// l'anti-doublon les avait laissées passer toutes les deux.
// ============================================================

import { describe, expect, it } from 'vitest'
import { empreinteRegle, paramsDeRow } from '@/lib/regles/identiteRegle'

describe('empreinteRegle — le doublon d’Anne-Catherine (cas réel)', () => {
  const enBase = {
    jour: 'mercredi',
    periode: 'apres_midi',
    description: 'Mercredi apres-midi fixe + un autre demi-journee variable',
    repos_supplementaire_variable: true,
  }
  const nouvelle = { jour: 'mercredi', exception_vacances_scolaires: false }

  it('les deux ont la même empreinte', () => {
    expect(empreinteRegle('interdire_creneau', enBase))
      .toBe(empreinteRegle('interdire_creneau', nouvelle))
  })

  it('l’ancienne comparaison littérale, elle, les distinguait', () => {
    // Le témoin de ce qu'on répare : c'est exactement ce que faisait le code.
    expect(JSON.stringify(enBase)).not.toBe(JSON.stringify(nouvelle))
  })
})

describe('empreinteRegle — ce qui compte vraiment', () => {
  it('l’exception vacances CHANGE la règle (le moteur la lit)', () => {
    expect(empreinteRegle('interdire_creneau', { jour: 'mercredi' })).not.toBe(
      empreinteRegle('interdire_creneau', {
        jour: 'mercredi', exception_vacances_scolaires: true,
      }),
    )
  })

  it('un jour différent, une règle différente', () => {
    expect(empreinteRegle('interdire_creneau', { jour: 'mardi' })).not.toBe(
      empreinteRegle('interdire_creneau', { jour: 'mercredi' }),
    )
  })

  it('une brique différente, une règle différente (mêmes params)', () => {
    expect(empreinteRegle('interdire_creneau', { jour: 'mardi' })).not.toBe(
      empreinteRegle('repos_conditionnel', { jour: 'mardi' }),
    )
  })

  it('« faux » et « absent » sont la même chose pour le moteur', () => {
    expect(empreinteRegle('au_plus_n', { n: 2, flexible: false })).toBe(
      empreinteRegle('au_plus_n', { n: 2 }),
    )
  })

  it('l’ordre des créneaux cochés ne fait pas une règle différente', () => {
    expect(empreinteRegle('au_plus_n', { n: 2, creneaux: ['weekend', 'semaine_soir'] })).toBe(
      empreinteRegle('au_plus_n', { n: 2, creneaux: ['semaine_soir', 'weekend'] }),
    )
  })

  it('la casse d’une étiquette non plus', () => {
    expect(empreinteRegle('composition_equipe', { mode: 'au_moins_un', tag: 'Senior' })).toBe(
      empreinteRegle('composition_equipe', { mode: 'au_moins_un', tag: 'senior' }),
    )
  })

  it('une liste vide vaut l’absence de ciblage', () => {
    expect(empreinteRegle('composition_equipe', { tag: 'senior', creneaux: [] })).toBe(
      empreinteRegle('composition_equipe', { tag: 'senior' }),
    )
  })
})

describe('paramsDeRow', () => {
  it('extrait les params d’une ligne regles_cabinet', () => {
    const row = { qui: { refs: ['x'] }, quand: 'mercredi', params: { jour: 'mercredi' } }
    expect(paramsDeRow(row)).toEqual({ jour: 'mercredi' })
  })

  it('ne casse pas sur une ligne mal formée', () => {
    expect(paramsDeRow(null)).toEqual({})
    expect(paramsDeRow({ params: 'pas un objet' })).toEqual({})
  })
})
