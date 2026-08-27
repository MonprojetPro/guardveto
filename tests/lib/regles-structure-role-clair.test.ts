// ============================================================
// GUARDVETO — `roleClair` : filet de NON-RÉGRESSION (B-081)
// ============================================================
// Écrit AVANT de toucher à `roleClair`, et pas après : c'est tout son intérêt.
// Il fige le comportement que l'écran « Règles & structure » affiche
// aujourd'hui, pour que la déduplication de la table des rôles ne puisse pas le
// changer sans qu'on le voie.
//
// ⚠️ CE FICHIER DOIT PASSER À L'IDENTIQUE AVANT ET APRÈS. Si un cas bascule,
// ce n'est pas le test qu'il faut corriger : c'est que la déduplication a
// changé ce qu'un écran affiche — exactement le « petit nettoyage » qui coûte
// une journée de débogage trois semaines plus tard.
//
// Les quatre derniers cas sont les points où `roleClair` et `roleCourt`
// DIVERGENT volontairement. `roleCourt` normalise (casse, accents, espaces) et
// se replie sur la place ; `roleClair` ne fait ni l'un ni l'autre. Les deux ont
// raison chez eux : un titre d'agenda doit toujours porter un rôle, une phrase
// de règles doit rendre le libellé du cabinet tel qu'il l'a écrit.
// ============================================================

import { describe, it, expect } from 'vitest'
import { roleClair } from '@/data/v2/reglesStructure'

describe('roleClair — comportement figé (ne doit jamais bouger)', () => {
  it('les noms canoniques s’abrègent', () => {
    expect(roleClair('premier')).toBe('1er')
    expect(roleClair('second')).toBe('2nd')
    expect(roleClair('troisieme')).toBe('3e')
    expect(roleClair('quatrieme')).toBe('4e')
    expect(roleClair('cinquieme')).toBe('5e')
  })

  it('un libellé nommé par le cabinet passe intact', () => {
    expect(roleClair('titulaire')).toBe('titulaire')
    expect(roleClair('renfort')).toBe('renfort')
  })

  // ── Les quatre divergences volontaires avec `roleCourt` ────

  it('la CASSE n’est pas normalisée — « Premier » reste « Premier »', () => {
    expect(roleClair('Premier')).toBe('Premier')
    expect(roleClair('SECOND')).toBe('SECOND')
  })

  it('les ACCENTS ne sont pas normalisés — « Troisième » reste tel quel', () => {
    expect(roleClair('Troisième')).toBe('Troisième')
    expect(roleClair('troisième')).toBe('troisième')
  })

  it('les ESPACES ne sont pas rognés', () => {
    expect(roleClair(' premier ')).toBe(' premier ')
  })

  it('une chaîne vide reste vide — pas de repli sur un numéro de place', () => {
    // `roleClair` n'a pas d'index de place : elle ne PEUT pas se replier, et
    // `placesClair` filtre déjà les listes vides en amont.
    expect(roleClair('')).toBe('')
  })
})
