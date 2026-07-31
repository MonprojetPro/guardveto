// ============================================================
// Les règles qui s'affichent sur la fiche d'un véto
// ============================================================
// Le filtre a l'air trivial et ne l'est pas : un duo interdit est stocké en
// DEUX lignes miroir, et une règle du cabinet n'a pas de propriétaire du tout.
// Ces trois cas se sont déjà mal passés ailleurs — d'où ces tests.
// ============================================================

import { describe, it, expect } from 'vitest'
import { reglesDuVeto } from '@/lib/regles/libelle'

const ANNE = 'aaaaaaaa-0000-0000-0000-000000000001'
const MANON = 'bbbbbbbb-0000-0000-0000-000000000002'

/** Une règle telle qu'elle sort de `regles_cabinet`. */
function regle(id: string, brique_id: string, params_json: unknown) {
  return { id, brique_id, params_json }
}

const REPOS_ANNE = regle('r1', 'interdire_creneau', {
  qui: { type: 'individu', refs: [ANNE] },
  params: { jour: 'mercredi', periode: 'apres_midi' },
})

const EQUITE_CABINET = regle('r2', 'equilibrer', {
  // Une règle de cabinet : aucun `qui`.
  params: { dimension: 'weekends', importance: 'normale' },
})

// Le duo, dans ses deux sens — c'est ainsi que le moteur le veut.
const DUO_ANNE_MANON = regle('r3', 'duo_interdit', {
  qui: { type: 'individu', refs: [ANNE] },
  params: { avec_veterinaire_id: MANON },
})
const DUO_MANON_ANNE = regle('r4', 'duo_interdit', {
  qui: { type: 'individu', refs: [MANON] },
  params: { avec_veterinaire_id: ANNE },
})

describe('reglesDuVeto', () => {
  it('garde les règles dont le véto est propriétaire', () => {
    const res = reglesDuVeto([REPOS_ANNE], ANNE)
    expect(res.map((r) => r.id)).toEqual(['r1'])
  })

  it('écarte les règles du cabinet (sans propriétaire)', () => {
    // Elles vivent sur l'écran Règles, pas sur une fiche : les faire apparaître
    // ici laisserait croire qu'on peut les retirer pour une seule personne.
    const res = reglesDuVeto([REPOS_ANNE, EQUITE_CABINET], ANNE)
    expect(res.map((r) => r.id)).toEqual(['r1'])
  })

  it("écarte les règles d'un autre véto", () => {
    expect(reglesDuVeto([REPOS_ANNE], MANON)).toEqual([])
  })

  it('ne montre un duo QU\'UNE fois, alors que la base en stocke deux sens', () => {
    const res = reglesDuVeto([DUO_ANNE_MANON, DUO_MANON_ANNE], ANNE)
    expect(res).toHaveLength(1)
  })

  it('montre le duo sur les DEUX fiches — il contraint les deux', () => {
    expect(reglesDuVeto([DUO_ANNE_MANON, DUO_MANON_ANNE], MANON)).toHaveLength(1)
  })

  it('tourne le duo du point de vue de la fiche ouverte', () => {
    // Sur la fiche de Manon, c'est la ligne dont Manon est le sujet qui doit
    // survivre — sinon on lit « Anne ne peut pas être seule avec Manon » sur la
    // fiche de Manon, ce qui est vrai mais raconté à l'envers. Ici la ligne
    // d'Anne arrive EN PREMIER dans le tableau : sans le tri, c'est elle qui
    // serait gardée.
    const res = reglesDuVeto([DUO_ANNE_MANON, DUO_MANON_ANNE], MANON)
    expect(res[0].id).toBe('r4')
  })

  it('trouve le duo même quand le véto n\'en est que le partenaire', () => {
    // Seul le sens Anne→Manon existe : la fiche de Manon doit quand même
    // l'afficher, la contrainte s'applique bien à elle.
    const res = reglesDuVeto([DUO_ANNE_MANON], MANON)
    expect(res.map((r) => r.id)).toEqual(['r3'])
  })

  it('supporte un params_json vide ou malformé sans planter', () => {
    const bancal = regle('r9', 'interdire_creneau', null)
    expect(reglesDuVeto([bancal, REPOS_ANNE], ANNE).map((r) => r.id)).toEqual(['r1'])
  })
})
