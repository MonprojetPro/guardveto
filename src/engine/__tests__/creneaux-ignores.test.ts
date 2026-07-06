// ============================================================
// GUARDVETO — Tests : détection des créneaux ignorés (backlog n°4)
// ============================================================
// Depuis P3b, tout créneau actif non-férié à code non-null est PLANIFIÉ
// (y compris sur-mesure, y compris plusieurs le même jour). Ne restent
// ignorés que : code null (jamais codifié) et créneau sans aucun jour.
// `detecterCreneauxIgnores` reste le MIROIR du filtre de `stepsForDay`.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  detecterCreneauxIgnores,
  type CreneauModele,
} from '@/engine/creneau-modele'

// ── Fabrique de créneau (défauts = seed) ──────────────────

function creneau(partiel: Partial<CreneauModele> & { id: string }): CreneauModele {
  return {
    code: null,
    nom: partiel.id,
    joursSemaine: [],
    surFeries: false,
    heureDebut: '18:30',
    heureFin: '08:30',
    offsetJoursFin: 1,
    nbPlaces: 2,
    roles: ['premier', 'second'],
    actif: true,
    ordre: 1,
    ...partiel,
  }
}

/** Le catalogue par défaut, identique au seed SQL (P1). */
function catalogueDefaut(): CreneauModele[] {
  return [
    creneau({ id: 'ss', code: 'semaine_soir', nom: 'Soir de semaine (lun-jeu)', joursSemaine: [1, 2, 3, 4], ordre: 1 }),
    creneau({ id: 'vs', code: 'vendredi_soir', nom: 'Soir du vendredi', joursSemaine: [5], ordre: 2 }),
    creneau({ id: 'we', code: 'weekend', nom: 'Week-end (sam+dim)', joursSemaine: [6], offsetJoursFin: 2, ordre: 3 }),
    creneau({ id: 'fe', code: 'ferie', nom: 'Jour férié', joursSemaine: [], surFeries: true, ordre: 4 }),
  ]
}

// ── Tests ─────────────────────────────────────────────────

describe('detecterCreneauxIgnores (contrat P3b)', () => {
  it('catalogue par défaut → AUCUN avertissement (zéro bruit cabinets actuels)', () => {
    expect(detecterCreneauxIgnores(catalogueDefaut())).toEqual([])
  })

  it('catalogue vide → aucun avertissement', () => {
    expect(detecterCreneauxIgnores([])).toEqual([])
  })

  it('créneau sur-mesure AVEC code → planifié, donc AUCUN avertissement', () => {
    const cat = [
      ...catalogueDefaut(),
      creneau({ id: 'gj', code: 'garde_jour', nom: 'Garde de jour', joursSemaine: [1, 2], ordre: 5 }),
    ]
    expect(detecterCreneauxIgnores(cat)).toEqual([])
  })

  it('deux créneaux le même jour → plus aucun masquage (tous planifiés)', () => {
    const cat = [
      ...catalogueDefaut(),
      creneau({ id: 'gj', code: 'garde_jour', nom: 'Garde de jour', joursSemaine: [1, 2, 3, 4], ordre: 0 }),
    ]
    expect(detecterCreneauxIgnores(cat)).toEqual([])
  })

  it('créneau sans code machine (code null) → sans_code avec ses jours', () => {
    const cat = [
      ...catalogueDefaut(),
      creneau({ id: 'x', code: null, nom: 'Vieux créneau', joursSemaine: [1, 2] }),
    ]
    const ignores = detecterCreneauxIgnores(cat)
    expect(ignores).toHaveLength(1)
    expect(ignores[0]).toMatchObject({ id: 'x', nom: 'Vieux créneau', raison: 'sans_code' })
    expect(ignores[0].jours.sort()).toEqual([1, 2])
  })

  it('créneau codifié mais sans aucun jour coché → aucun_jour', () => {
    const cat = [creneau({ id: 'v', code: 'garde_vide', nom: 'Garde vide', joursSemaine: [] })]
    const ignores = detecterCreneauxIgnores(cat)
    expect(ignores).toHaveLength(1)
    expect(ignores[0]).toMatchObject({ id: 'v', raison: 'aucun_jour', jours: [] })
  })

  it('créneau inactif → jamais signalé (il est désactivé, pas ignoré)', () => {
    const cat = [
      ...catalogueDefaut(),
      creneau({ id: 'x', code: null, nom: 'Vieux créneau', joursSemaine: [1], actif: false }),
    ]
    expect(detecterCreneauxIgnores(cat)).toEqual([])
  })

  it('le créneau ferie du seed ne déclenche jamais rien (géré à part, par design)', () => {
    const cat = [creneau({ id: 'fe', code: 'ferie', nom: 'Jour férié', surFeries: true })]
    expect(detecterCreneauxIgnores(cat)).toEqual([])
  })
})
