// ============================================================
// GUARDVETO — Assistant IA : conversion proposition → profil (P5 slice 5)
// ============================================================
// Fige la frontière IA→profil : une proposition (termes humains) devient un
// CreerProfilCompletPayload exploitable, OU est rejetée proprement (nom manquant,
// source introuvable, horaire hors périmètre/incohérent). L'IA elle-même n'est
// PAS testée ici (appel réseau) — seulement la couche pure déterministe.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  propositionVersProfilPayload,
  apercuProfil,
  type PropositionProfil,
  type ProfilResolu,
} from '../profilSchema'

const PROFILS: ProfilResolu[] = [
  { id: 'id-defaut', nom: 'Standard', est_defaut: true },
  { id: 'id-hiver', nom: 'Hiver', est_defaut: false },
]

/** Construit une proposition complète (tout à null) + overrides. */
function prop(over: Partial<PropositionProfil>): PropositionProfil {
  return {
    comprehension: '', faisable: true, message: '',
    nom: null, source_profil: null, saison_suggeree: null,
    nb_vetos_semaine_soir: null, horaires: null,
    ...over,
  }
}

describe('propositionVersProfilPayload', () => {
  it('profil minimal (nom seul) → source défaut (null)', () => {
    const r = propositionVersProfilPayload(prop({ nom: 'Été' }), PROFILS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.nom).toBe('Été')
      expect(r.payload.source_profil_id).toBeNull()
      expect(r.payload.horaires).toEqual([])
    }
  })

  it('source nommée (insensible casse) → id résolu', () => {
    const r = propositionVersProfilPayload(prop({ nom: 'Été', source_profil: 'hiver' }), PROFILS)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.source_profil_id).toBe('id-hiver')
  })

  it('« par défaut » comme source → id null (profil défaut)', () => {
    const r = propositionVersProfilPayload(prop({ nom: 'Été', source_profil: 'par défaut' }), PROFILS)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.source_profil_id).toBeNull()
  })

  it('saison + effectif portés dans le payload', () => {
    const r = propositionVersProfilPayload(
      prop({ nom: 'Été', saison_suggeree: 'ete', nb_vetos_semaine_soir: 2 }),
      PROFILS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.saison_suggeree).toBe('ete')
      expect(r.payload.nb_vetos_semaine_soir).toBe(2)
    }
  })

  it('horaire valide → override normalisé', () => {
    const r = propositionVersProfilPayload(
      prop({
        nom: 'Été',
        horaires: [{ code: 'semaine_soir', heure_debut: '19:00', heure_fin: '08:30', offset_jours_fin: 1 }],
      }),
      PROFILS,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.payload.horaires).toHaveLength(1)
      expect(r.payload.horaires[0]).toEqual({
        code: 'semaine_soir', heure_debut: '19:00', heure_fin: '08:30', offset_jours_fin: 1,
      })
    }
  })

  it('non faisable → rejeté avec raison', () => {
    const r = propositionVersProfilPayload(prop({ faisable: false, message: 'Demande trop vague.' }), PROFILS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('vague')
  })

  it('nom manquant → rejeté', () => {
    const r = propositionVersProfilPayload(prop({ nom: '   ' }), PROFILS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('nom')
  })

  it('source introuvable → rejeté', () => {
    const r = propositionVersProfilPayload(prop({ nom: 'Été', source_profil: 'Fantôme' }), PROFILS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('introuvable')
  })

  it('source ambiguë (deux profils homonymes) → rejeté sans deviner', () => {
    const dup: ProfilResolu[] = [
      { id: 'a', nom: 'Été', est_defaut: false },
      { id: 'b', nom: 'Été', est_defaut: false },
    ]
    const r = propositionVersProfilPayload(prop({ nom: 'Nouveau', source_profil: 'Été' }), dup)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('Plusieurs')
  })

  // L'effectif du soir en semaine accepte 1 à 4 depuis la migration
  // 20260801090000 (avant : 1 ou 2, ce qui rabotait silencieusement les
  // créneaux déclarant 3 ou 4 places). La borne haute reste gâtée.
  it('effectif de 3 → accepté (le catalogue va jusqu’à 4 places)', () => {
    const r = propositionVersProfilPayload(prop({ nom: 'Été', nb_vetos_semaine_soir: 3 }), PROFILS)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.payload.nb_vetos_semaine_soir).toBe(3)
  })

  it('effectif hors 1..4 → rejeté', () => {
    for (const n of [0, 5, 12]) {
      const r = propositionVersProfilPayload(prop({ nom: 'Été', nb_vetos_semaine_soir: n }), PROFILS)
      expect(r.ok).toBe(false)
    }
  })

  it('horaire au mauvais format → rejeté', () => {
    const r = propositionVersProfilPayload(
      prop({ nom: 'Été', horaires: [{ code: 'weekend', heure_debut: '25:00', heure_fin: '08:00', offset_jours_fin: 2 }] }),
      PROFILS,
    )
    expect(r.ok).toBe(false)
  })

  it('horaire incohérent (fin ≤ début le jour même) → rejeté', () => {
    const r = propositionVersProfilPayload(
      prop({ nom: 'Été', horaires: [{ code: 'ferie', heure_debut: '20:00', heure_fin: '18:00', offset_jours_fin: 0 }] }),
      PROFILS,
    )
    expect(r.ok).toBe(false)
  })

  it('deux horaires pour le même type → rejeté', () => {
    const r = propositionVersProfilPayload(
      prop({
        nom: 'Été',
        horaires: [
          { code: 'weekend', heure_debut: '18:00', heure_fin: '08:00', offset_jours_fin: 2 },
          { code: 'weekend', heure_debut: '19:00', heure_fin: '08:00', offset_jours_fin: 2 },
        ],
      }),
      PROFILS,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toContain('un seul')
  })
})

describe('apercuProfil', () => {
  it('rend une phrase avec le nom et la source', () => {
    const phrase = apercuProfil(prop({ nom: 'Été', source_profil: 'Hiver' }))
    expect(phrase).toContain('Été')
    expect(phrase).toContain('Hiver')
  })

  it('sans source → mentionne le profil par défaut', () => {
    const phrase = apercuProfil(prop({ nom: 'Été' }))
    expect(phrase).toContain('par défaut')
  })

  it('décrit les horaires ajustés en clair', () => {
    const phrase = apercuProfil(
      prop({ nom: 'Été', horaires: [{ code: 'semaine_soir', heure_debut: '19:00', heure_fin: '08:30', offset_jours_fin: 1 }] }),
    )
    expect(phrase).toContain('19:00')
    expect(phrase).toContain('08:30')
    expect(phrase).toContain('lendemain')
  })

  it('nom manquant → chaîne vide', () => {
    expect(apercuProfil(prop({ nom: null }))).toBe('')
  })
})
