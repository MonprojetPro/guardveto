// ============================================================
// GUARDVETO — RG4 : conversion proposition IA → payload de liaison (pur)
// ============================================================
// La conversion est la frontière entre les termes HUMAINS de l'IA (noms de
// créneaux) et le payload serveur (ids). On prouve : résolution des noms
// (insensible casse), rejets propres (non faisable, genre manquant, créneau
// introuvable, auto-lien), et la garde métier « même équipe + même jour »
// (incompatible R22). Aucun appel API ici.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  propositionVersRelationPayload,
  apercuRelation,
  type PropositionRelation,
  type CreneauResoluIA,
} from '../relationSchema'

const CRENEAUX: CreneauResoluIA[] = [
  { id: 'c-ven', nom: 'Soir du vendredi', joursSemaine: [5] },
  { id: 'c-we', nom: 'Week-end (sam+dim)', joursSemaine: [6] },
  { id: 'c-matin', nom: 'Garde du matin', joursSemaine: [2] },
  { id: 'c-soir', nom: 'Garde du soir', joursSemaine: [2] },
]

function prop(over: Partial<PropositionRelation>): PropositionRelation {
  return {
    comprehension: 'ok',
    faisable: true,
    message: '',
    profil: null,
    premier_creneau: 'Soir du vendredi',
    second_creneau: 'Week-end (sam+dim)',
    genre: 'meme_binome',
    ...over,
  }
}

describe('propositionVersRelationPayload', () => {
  it('résout les noms (insensible à la casse) → payload avec ids', () => {
    const r = propositionVersRelationPayload(
      prop({ premier_creneau: 'soir du VENDREDI' }), CRENEAUX, 'profil-1',
    )
    expect(r).toEqual({
      ok: true,
      payload: { profil_id: 'profil-1', source_id: 'c-ven', cible_id: 'c-we', genre: 'meme_binome' },
    })
  })

  it('non faisable → raison = message IA', () => {
    const r = propositionVersRelationPayload(
      prop({ faisable: false, message: 'Demande ambiguë.' }), CRENEAUX, 'p',
    )
    expect(r).toEqual({ ok: false, raison: 'Demande ambiguë.' })
  })

  it('genre manquant → demande la règle', () => {
    const r = propositionVersRelationPayload(prop({ genre: null }), CRENEAUX, 'p')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('même équipe')
  })

  it('créneau introuvable → message clair avec le nom cité', () => {
    const r = propositionVersRelationPayload(
      prop({ second_creneau: 'Garde de nuit' }), CRENEAUX, 'p',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('Garde de nuit')
  })

  it('auto-lien (deux fois le même créneau) → refusé', () => {
    const r = propositionVersRelationPayload(
      prop({ second_creneau: 'Soir du vendredi' }), CRENEAUX, 'p',
    )
    expect(r.ok).toBe(false)
  })

  it('garde R22 : même équipe entre deux créneaux du MÊME jour → refusé avec explication', () => {
    const r = propositionVersRelationPayload(
      prop({ premier_creneau: 'Garde du matin', second_creneau: 'Garde du soir' }), CRENEAUX, 'p',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('même jour')
  })

  it('rôles différents entre deux créneaux du même jour → ACCEPTÉ (compatible R22)', () => {
    const r = propositionVersRelationPayload(
      prop({ premier_creneau: 'Garde du matin', second_creneau: 'Garde du soir', genre: 'inversion_role' }),
      CRENEAUX, 'p',
    )
    expect(r.ok).toBe(true)
  })
})

describe('apercuRelation', () => {
  it('rend une phrase claire, avec le profil si non-défaut', () => {
    expect(apercuRelation(prop({}))).toBe(
      'Lier « Soir du vendredi » → « Week-end (sam+dim) » : même équipe.',
    )
    expect(apercuRelation(prop({ genre: 'inversion_role' }), 'Été')).toBe(
      'Lier « Soir du vendredi » → « Week-end (sam+dim) » : rôles différents (profil « Été »).',
    )
  })

  it("créneau manquant → '' (pas de bouton Créer)", () => {
    expect(apercuRelation(prop({ premier_creneau: null }))).toBe('')
  })
})
