// ============================================================
// GUARDVETO — Frontière de confiance : numéros du modèle → règles réelles
// ============================================================
// Quand Filou propose de supprimer « R3 », ce numéro vient d'un modèle de
// langage. C'est la seule sortie d'IA du produit qui devient un identifiant de
// ligne à effacer. Ces tests fixent ce qui doit arriver à un numéro faux :
// il est JETÉ, jamais rapproché de la règle la plus proche.
// ============================================================

import { describe, it, expect } from 'vitest'
import { reglesVisees } from '@/lib/regles/libelle'

const CANDIDATES = [
  { id: 'aaa', actif: true },
  { id: 'bbb', actif: false },
  { id: 'ccc', actif: true },
]
const LIBELLES = ['Manon jamais le mercredi', 'Antoine 3 jours d’écart', 'Jean pas le week-end']

describe('reglesVisees — traduction des numéros de l’assistant', () => {
  it('résout les numéros valides en règles, avec leur libellé et leur état', () => {
    expect(reglesVisees(CANDIDATES, LIBELLES, [1, 3])).toEqual([
      { id: 'aaa', libelle: 'Manon jamais le mercredi', actif: true },
      { id: 'ccc', libelle: 'Jean pas le week-end', actif: true },
    ])
  })

  it('conserve l’ordre dans lequel l’assistant a cité les règles', () => {
    expect(reglesVisees(CANDIDATES, LIBELLES, [3, 1]).map((r) => r.id)).toEqual(['ccc', 'aaa'])
  })

  it('jette un numéro hors bornes plutôt que de le rapprocher', () => {
    expect(reglesVisees(CANDIDATES, LIBELLES, [4, 99, 0, -2])).toEqual([])
  })

  it('ne garde que les numéros valides quand la réponse en mélange', () => {
    expect(reglesVisees(CANDIDATES, LIBELLES, [2, 42]).map((r) => r.id)).toEqual(['bbb'])
  })

  it('dédoublonne : une règle citée deux fois n’est traitée qu’une fois', () => {
    expect(reglesVisees(CANDIDATES, LIBELLES, [2, 2, 2]).map((r) => r.id)).toEqual(['bbb'])
  })

  it('refuse ce qui n’est pas un entier — texte, décimal, null', () => {
    expect(reglesVisees(CANDIDATES, LIBELLES, ['1', 1.5, null, undefined, NaN])).toEqual([])
  })

  it('remonte l’état réel de la règle, pas celui qu’annonce l’assistant', () => {
    expect(reglesVisees(CANDIDATES, LIBELLES, [2])[0].actif).toBe(false)
  })

  it('sans aucune règle au cabinet, ne peut rien viser', () => {
    expect(reglesVisees([], [], [1, 2])).toEqual([])
  })
})
