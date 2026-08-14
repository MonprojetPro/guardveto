// ============================================================
// Les règles qui pèsent sur un véto À TRAVERS UNE ÉTIQUETTE
// ============================================================
// LE TROU QUE CE TEST FERME — audit du 2026-08-14
//
// La fiche d'un vétérinaire n'affichait que les règles dont il est nommément
// le sujet (`qui.refs` contient son identifiant). Les règles par étiquette —
// « les seniors ne sont jamais 1er de garde » — ont `qui = null` et rangent
// leur cible dans `params.tag` : elles étaient donc INVISIBLES sur la fiche,
// alors qu'elles contraignent la personne à chaque génération.
//
// On pouvait ouvrir une fiche, n'y voir aucune contrainte, et en conclure que
// le cabinet n'avait rien réglé pour ce vétérinaire.
// ============================================================

import { describe, expect, it } from 'vitest'
import { reglesDuVeto, reglesParEtiquetteDuVeto } from '@/lib/regles/libelle'

const regle = (id: string, brique_id: string, params: Record<string, unknown>) => ({
  id,
  brique_id,
  force: 'jamais',
  actif: true,
  params_json: { qui: null, quand: null, params },
})

const COMPO_SENIOR = regle('compo', 'composition_equipe', {
  tag: 'senior',
  mode: 'au_moins_un',
})
const ROLE_TOUTES = regle('role', 'role_interdit_tag', { tag: 'toutes', role: 'premier' })
/** Une cohorte d'équité : elle porte un tag, mais n'interdit rien. */
const EQUITE_SENIOR = regle('equite', 'equilibrer', { tag: 'senior', dimension: 'nuits' })

const TOUTES = [COMPO_SENIOR, ROLE_TOUTES, EQUITE_SENIOR]

describe('reglesParEtiquetteDuVeto', () => {
  it('remonte les règles des étiquettes que la personne porte', () => {
    const ids = reglesParEtiquetteDuVeto(TOUTES, ['senior', 'toutes']).map((r) => r.id)
    expect(ids).toContain('compo')
    expect(ids).toContain('role')
  })

  it('ne remonte pas celles d’une étiquette qu’elle ne porte pas', () => {
    expect(reglesParEtiquetteDuVeto(TOUTES, ['toutes']).map((r) => r.id)).not.toContain('compo')
  })

  it('ignore la casse — « Senior » et « senior » sont la même étiquette', () => {
    expect(reglesParEtiquetteDuVeto(TOUTES, ['SENIOR']).map((r) => r.id)).toContain('compo')
    expect(reglesParEtiquetteDuVeto(TOUTES, ['  Senior ']).map((r) => r.id)).toContain('compo')
  })

  it('EXCLUT l’équité : une cohorte répartit la charge, elle n’interdit rien', () => {
    expect(reglesParEtiquetteDuVeto(TOUTES, ['senior']).map((r) => r.id)).not.toContain('equite')
  })

  it('rend une liste vide plutôt que de tomber sur une fiche sans étiquette', () => {
    expect(reglesParEtiquetteDuVeto(TOUTES, null)).toEqual([])
    expect(reglesParEtiquetteDuVeto(TOUTES, [])).toEqual([])
    expect(reglesParEtiquetteDuVeto(TOUTES, ['  ', ''])).toEqual([])
  })

  it('reste DISJOINTE de reglesDuVeto : aucune règle comptée deux fois', () => {
    const vetoId = '00000000-0000-0000-0000-000000000007'
    const nominatives = reglesDuVeto(TOUTES, vetoId).map((r) => r.id)
    const parTag = reglesParEtiquetteDuVeto(TOUTES, ['senior', 'toutes']).map((r) => r.id)
    expect(nominatives.filter((id) => parTag.includes(id))).toEqual([])
  })
})
