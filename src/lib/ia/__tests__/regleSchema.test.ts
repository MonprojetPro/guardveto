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
  propositionVersComposition,
  propositionVersRoleInterdit,
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
    partenaire: null, n: null, fenetre: null, creneaux: null,
    ecart_min_jours: null, n_semaines: null,
    mode_composition: null, tag: null, role_interdit: null,
    jours: null, sens: null,
    type_avant: null, type_apres: null, n_jours: null, repos_jours: null,
    ancre: null, sens_cadence: null,
    dimension_equite: null, importance_equite: null,
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

  it('au_plus_n + creneaux (n°19) → filtre transmis, dédupliqué (« max 2 WE par mois »)', () => {
    const r = propositionVersPayload(
      prop({
        brique_id: 'au_plus_n', veterinaire: 'Victor', n: 2,
        fenetre: 'glissante_30_jours', creneaux: ['weekend', 'weekend'],
      }),
      VETS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.n).toBe(2)
      expect(r.payload.fenetre).toBe('glissante_30_jours')
      expect(r.payload.creneaux).toEqual(['weekend']) // dédupliqué
    }
  })

  it('au_plus_n sans creneaux (null ou vide) → pas de filtre dans le payload (historique)', () => {
    for (const creneaux of [null, [] as string[], ['  ']]) {
      const r = propositionVersPayload(
        prop({ brique_id: 'au_plus_n', veterinaire: 'Victor', n: 2, fenetre: 'semaine_civile', creneaux }),
        VETS,
      )
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.payload.creneaux).toBeUndefined()
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

  it('espacement_weekend → n_semaines + force « préférence » par défaut', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'espacement_weekend', veterinaire: 'Manon', n_semaines: 3 }),
      VETS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.n_semaines).toBe(3)
      expect(r.payload.force).toBe('si_possible') // préférence par défaut (décision MiKL)
    }
  })

  it('espacement_weekend « 1 sur 1 » → rejeté (aucune contrainte)', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'espacement_weekend', veterinaire: 'Manon', n_semaines: 1 }),
      VETS,
    )
    expect(r.ok).toBe(false)
  })

  it('cadencement_weekend « pompier 1 sur 3 interdit » → payload complet, force jamais par défaut (#20)', () => {
    const r = propositionVersPayload(
      prop({
        brique_id: 'cadencement_weekend', veterinaire: 'Victor',
        n_semaines: 3, ancre: '2026-09-05', sens_cadence: 'interdit',
      }),
      VETS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.owner_id).toBe('id-victor')
      expect(r.payload.n_semaines).toBe(3)
      expect(r.payload.ancre).toBe('2026-09-05')
      expect(r.payload.sens).toBe('interdit')
      expect(r.payload.force).toBe('jamais') // interdit = ferme par défaut
    }
  })

  it('cadencement_weekend sans ancre valide → rejeté', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'cadencement_weekend', veterinaire: 'Victor', n_semaines: 3, ancre: 'bidon', sens_cadence: 'interdit' }),
      VETS,
    )
    expect(r.ok).toBe(false)
  })

  it('cadencement_weekend sans sens précisé → rejeté', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'cadencement_weekend', veterinaire: 'Victor', n_semaines: 3, ancre: '2026-09-05' }),
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

  it('au_plus_n + creneaux : l’aperçu rend le filtre en français (n°19)', () => {
    const phrase = apercuProposition(
      prop({ brique_id: 'au_plus_n', veterinaire: 'Victor', n: 2, fenetre: 'glissante_30_jours', creneaux: ['weekend'] }),
    )
    expect(phrase).toContain('week-end')
    expect(phrase).toContain('2')
  })

  it('duo : affiche le prénom du partenaire (pas un id)', () => {
    const phrase = apercuProposition(
      prop({ brique_id: 'duo_interdit', veterinaire: 'Manon', partenaire: 'Antoine' }),
    )
    expect(phrase).toContain('Manon')
    expect(phrase).toContain('Antoine')
  })
})

describe('propositionVersComposition (règle GLOBALE d’équipe — n°6)', () => {
  const TAGS = ['junior', 'senior']

  it('convertit une proposition complète (tag normalisé, créneaux dédupliqués)', () => {
    const r = propositionVersComposition(
      prop({ brique_id: 'composition_equipe', mode_composition: 'au_moins_un', tag: ' Senior ', creneaux: ['weekend', 'weekend'], force: 'jamais' }),
      TAGS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.mode).toBe('au_moins_un')
      expect(r.payload.tag).toBe('senior')
      expect(r.payload.creneaux).toEqual(['weekend'])
      expect(r.payload.force).toBe('jamais')
    }
  })

  it('force par défaut = jamais (exigence de sécurité) quand l’IA n’en propose pas', () => {
    const r = propositionVersComposition(
      prop({ brique_id: 'composition_equipe', mode_composition: 'pas_seuls', tag: 'junior' }),
      TAGS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.force).toBe('jamais')
  })

  it('refuse un tag que PERSONNE ne porte (anti-coquille-vide)', () => {
    const r = propositionVersComposition(
      prop({ brique_id: 'composition_equipe', mode_composition: 'au_moins_un', tag: 'chirurgien' }),
      TAGS,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('chirurgien')
  })

  it('refuse mode ou tag manquant', () => {
    expect(propositionVersComposition(
      prop({ brique_id: 'composition_equipe', tag: 'junior' }), TAGS,
    ).ok).toBe(false)
    expect(propositionVersComposition(
      prop({ brique_id: 'composition_equipe', mode_composition: 'pas_seuls' }), TAGS,
    ).ok).toBe(false)
  })

  it('propositionVersPayload REFUSE la composition (routage dédié, jamais de payload véto)', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'composition_equipe', mode_composition: 'pas_seuls', tag: 'junior', veterinaire: 'Manon' }),
      VETS,
    )
    expect(r.ok).toBe(false)
  })

  it('aperçu : phrase française SANS sujet vétérinaire', () => {
    const phrase = apercuProposition(
      prop({ brique_id: 'composition_equipe', mode_composition: 'pas_seuls', tag: 'junior' }),
    )
    expect(phrase).toContain('junior')
    expect(phrase).toContain('jamais seuls')
  })
})

describe('propositionVersRoleInterdit (règle GLOBALE — n°22)', () => {
  const TAGS = ['junior', 'senior']
  const ROLES = ['premier', 'second']

  it('convertit « un junior jamais 1er » (tag normalisé)', () => {
    const r = propositionVersRoleInterdit(
      prop({ brique_id: 'role_interdit_tag', tag: ' Junior ', role_interdit: 'premier', force: 'jamais' }),
      TAGS, ROLES,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.tag).toBe('junior')
      expect(r.payload.role).toBe('premier')
      expect(r.payload.force).toBe('jamais')
    }
  })

  it('refuse un tag non porté ou un rôle hors catalogue', () => {
    expect(propositionVersRoleInterdit(
      prop({ brique_id: 'role_interdit_tag', tag: 'chirurgien', role_interdit: 'premier' }), TAGS, ROLES,
    ).ok).toBe(false)
    expect(propositionVersRoleInterdit(
      prop({ brique_id: 'role_interdit_tag', tag: 'junior', role_interdit: 'chef' }), TAGS, ROLES,
    ).ok).toBe(false)
  })

  it('aperçu : phrase française sans sujet vétérinaire, rôle lisible', () => {
    const phrase = apercuProposition(
      prop({ brique_id: 'role_interdit_tag', tag: 'junior', role_interdit: 'premier' }),
    )
    expect(phrase).toContain('junior')
    expect(phrase).toContain('1er')
  })
})

describe('desiderata (n°7) — conversion par-véto, toujours souple', () => {
  it('preferer_creneau : jours + force souple par défaut', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'preferer_creneau', veterinaire: 'Manon', jours: ['mardi'] }),
      VETS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.jours).toEqual(['mardi'])
      expect(r.payload.force).toBe('si_possible')
    }
  })

  it('preferer_creneau sans jour NI créneau → rejeté', () => {
    expect(propositionVersPayload(
      prop({ brique_id: 'preferer_creneau', veterinaire: 'Manon' }), VETS,
    ).ok).toBe(false)
  })

  it('preferer_avec : partenaire résolu, soi-même rejeté', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'preferer_avec', veterinaire: 'Manon', partenaire: 'Antoine' }),
      VETS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.avec_veterinaire_id).toBe('id-antoine')

    expect(propositionVersPayload(
      prop({ brique_id: 'preferer_avec', veterinaire: 'Manon', partenaire: 'Manon' }), VETS,
    ).ok).toBe(false)
  })

  it('volume_gardes : sens obligatoire ; force « jamais » rétrogradée en souple', () => {
    const r = propositionVersPayload(
      prop({ brique_id: 'volume_gardes', veterinaire: 'Victor', sens: 'plus', force: 'jamais' }),
      VETS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.sens).toBe('plus')
      expect(r.payload.force).toBe('sauf_crise') // jamais → rétrogradé
    }
    expect(propositionVersPayload(
      prop({ brique_id: 'volume_gardes', veterinaire: 'Victor' }), VETS,
    ).ok).toBe(false)
  })

  it('aperçu : phrases françaises avec sujet', () => {
    expect(apercuProposition(
      prop({ brique_id: 'preferer_creneau', veterinaire: 'Manon', jours: ['mardi'] }),
    )).toContain('mardi')
    expect(apercuProposition(
      prop({ brique_id: 'volume_gardes', veterinaire: 'Victor', sens: 'plus' }),
    )).toContain('PLUS')
  })
})
