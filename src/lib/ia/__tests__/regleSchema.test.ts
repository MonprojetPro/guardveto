// ============================================================
// GUARDVETO — Assistant IA : conversion proposition → payload (slice 1)
// ============================================================
// Fige la frontière IA→règle : une proposition (termes humains) devient un
// UpsertReglePayload (ids) exploitable par le upsertRegle existant, OU est
// rejetée proprement (véto/brique manquants). L'IA elle-même n'est PAS testée
// ici (appel réseau) — seulement la couche pure déterministe.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  propositionVersPayload,
  apercuProposition,
  type PropositionRegle,
  type VetoResolu,
} from '../regleSchema'

const VETS: VetoResolu[] = [
  { id: 'id-manon', prenom: 'Manon' },
  { id: 'id-antoine', prenom: 'Antoine' },
  { id: 'id-victor', prenom: 'Victor' },
]

/** Construit une proposition complète (tous les champs à null) + overrides. */
function prop(over: Partial<PropositionRegle>): PropositionRegle {
  return {
    comprehension: '', faisable: true, message: '',
    veterinaire: null, brique_id: null, force: null,
    jour: null, exception_vacances_scolaires: null,
    si_garde_we: null, sinon: null, semaines: null, periodes: null,
    partenaire: null, n: null, fenetre: null, ecart_min_jours: null,
    ...over,
  }
}

describe('propositionVersPayload', () => {
  it('interdire_creneau → payload owner résolu + jour', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'interdire_creneau', veterinaire: 'Manon', force: 'evitee', jour: 'mercredi' }),
      VETS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.owner_id).toBe('id-manon')
      expect(r.payload.jour).toBe('mercredi')
      expect(r.payload.force).toBe('evitee')
    }
  })

  it('duo_interdit → résout owner ET partenaire', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'duo_interdit', veterinaire: 'Manon', partenaire: 'Antoine', force: 'jamais' }),
      VETS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.owner_id).toBe('id-manon')
      expect(r.payload.avec_veterinaire_id).toBe('id-antoine')
    }
  })

  it('au_plus_n → n + fenetre', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'au_plus_n', veterinaire: 'Victor', n: 2, fenetre: 'semaine_civile' }),
      VETS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.n).toBe(2)
      expect(r.payload.fenetre).toBe('semaine_civile')
    }
  })

  it('prénom insensible à la casse', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'espacement_min', veterinaire: 'manon', ecart_min_jours: 3 }),
      VETS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.owner_id).toBe('id-manon')
  })

  it('non faisable → rejeté avec raison', () => {
    const r = propositionVersPayload(
      prop({ faisable: false, message: 'Demande trop vague.' }),
      VETS,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('vague')
  })

  it('véto inconnu → rejeté', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'interdire_creneau', veterinaire: 'Inconnu', jour: 'lundi' }),
      VETS,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('introuvable')
  })

  it('duo avec partenaire inconnu → rejeté', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'duo_interdit', veterinaire: 'Manon', partenaire: 'Fantome' }),
      VETS,
    )
    expect(r.ok).toBe(false)
  })

  it('prénom en double dans le cabinet → ambigu, rejeté sans choisir au hasard', () => {
    const vetsDup: VetoResolu[] = [
      { id: 'id-manon-1', prenom: 'Manon' },
      { id: 'id-manon-2', prenom: 'Manon' },
    ]
    const r = propositionVersPayload(
      prop({ brique_id: 'interdire_creneau', veterinaire: 'Manon', jour: 'lundi' }),
      vetsDup,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('Plusieurs')
  })

  it('duo d’un véto avec lui-même → rejeté', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'duo_interdit', veterinaire: 'Manon', partenaire: 'Manon' }),
      VETS,
    )
    expect(r.ok).toBe(false)
  })

  it('au_plus_n hors borne haute (> 14) → rejeté', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'au_plus_n', veterinaire: 'Victor', n: 50, fenetre: 'semaine_civile' }),
      VETS,
    )
    expect(r.ok).toBe(false)
  })

  it('au_plus_n sans effet (n ≥ taille de fenêtre) → rejeté', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'au_plus_n', veterinaire: 'Victor', n: 7, fenetre: 'semaine_civile' }),
      VETS,
    )
    expect(r.ok).toBe(false)
  })

  it('espacement_min hors borne → rejeté', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'espacement_min', veterinaire: 'Victor', ecart_min_jours: 99 }),
      VETS,
    )
    expect(r.ok).toBe(false)
  })
})

describe('apercuProposition', () => {
  it('rend une phrase française avec le sujet', () => {
    const phrase = apercuProposition(
      prop({ brique_id: 'interdire_creneau', veterinaire: 'Manon', jour: 'mercredi' }),
    )
    expect(phrase).toContain('Manon')
    expect(phrase).toContain('mercredi')
  })

  it('duo : affiche le prénom du partenaire (pas un id)', () => {
    const phrase = apercuProposition(
      prop({ brique_id: 'duo_interdit', veterinaire: 'Manon', partenaire: 'Antoine' }),
    )
    expect(phrase).toContain('Manon')
    expect(phrase).toContain('Antoine')
  })
})
