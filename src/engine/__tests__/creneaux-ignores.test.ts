// ============================================================
// GUARDVETO — Tests : détection des créneaux ignorés (backlog n°4, tranche 1)
// ============================================================
// `detecterCreneauxIgnores` est le MIROIR de la sélection de `stepsForDay`
// (solver.ts) : elle doit signaler exactement ce que le moteur ignore en
// silence, et RIEN sur le catalogue par défaut (zéro bruit cabinets actuels).
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

describe('detecterCreneauxIgnores', () => {
  it('catalogue par défaut → AUCUN avertissement (zéro bruit cabinets actuels)', () => {
    expect(detecterCreneauxIgnores(catalogueDefaut())).toEqual([])
  })

  it('catalogue vide → aucun avertissement', () => {
    expect(detecterCreneauxIgnores([])).toEqual([])
  })

  it('créneau sur-mesure (code null) → type_inconnu avec ses jours', () => {
    const cat = [
      ...catalogueDefaut(),
      creneau({ id: 'gj', code: null, nom: 'Garde de jour', joursSemaine: [1, 2], ordre: 5 }),
    ]
    const ignores = detecterCreneauxIgnores(cat)
    expect(ignores).toHaveLength(1)
    expect(ignores[0]).toMatchObject({ id: 'gj', nom: 'Garde de jour', raison: 'type_inconnu' })
    expect(ignores[0].jours.sort()).toEqual([1, 2])
  })

  it('créneau au code inconnu du moteur → type_inconnu', () => {
    const cat = [
      creneau({ id: 'sam', code: 'samedi_seul', nom: 'Samedi seul', joursSemaine: [6] }),
    ]
    const ignores = detecterCreneauxIgnores(cat)
    expect(ignores).toHaveLength(1)
    expect(ignores[0]).toMatchObject({ id: 'sam', raison: 'type_inconnu', jours: [6] })
  })

  it('deux créneaux planifiables le même jour → le second est jour_masque', () => {
    // Le cabinet ajoute une 2e garde le lundi : stepsForDay ne retient que la 1re.
    const cat = [
      ...catalogueDefaut(),
      creneau({ id: 'ss2', code: 'semaine_soir', nom: 'Soir de semaine bis', joursSemaine: [1], ordre: 5 }),
    ]
    const ignores = detecterCreneauxIgnores(cat)
    expect(ignores).toHaveLength(1)
    expect(ignores[0]).toMatchObject({ id: 'ss2', raison: 'jour_masque', jours: [1] })
  })

  it('créneau sur-mesure passé DEVANT un créneau connu → les deux sont signalés', () => {
    // Cas catastrophe silencieuse : « Garde de jour » en tête de catalogue sur
    // lun-jeu → elle n'est pas planifiable ET elle masque semaine_soir. Sans
    // avertissement, le planning sort SANS AUCUN soir de semaine.
    const gardeJour = creneau({ id: 'gj', code: null, nom: 'Garde de jour', joursSemaine: [1, 2, 3, 4], ordre: 0 })
    const cat = [gardeJour, ...catalogueDefaut()]
    const ignores = detecterCreneauxIgnores(cat)
    expect(ignores.map((i) => i.id).sort()).toEqual(['gj', 'ss'])
    expect(ignores.find((i) => i.id === 'gj')?.raison).toBe('type_inconnu')
    const ss = ignores.find((i) => i.id === 'ss')
    expect(ss?.raison).toBe('jour_masque')
    expect(ss?.jours.sort()).toEqual([1, 2, 3, 4])
  })

  it('créneau inactif → jamais signalé (il est désactivé, pas ignoré)', () => {
    const cat = [
      ...catalogueDefaut(),
      creneau({ id: 'gj', code: null, nom: 'Garde de jour', joursSemaine: [1], actif: false }),
    ]
    expect(detecterCreneauxIgnores(cat)).toEqual([])
  })

  it('créneau sur-mesure sans aucun jour → signalé quand même (jours vide)', () => {
    const cat = [creneau({ id: 'x', code: null, nom: 'Astreinte', joursSemaine: [] })]
    const ignores = detecterCreneauxIgnores(cat)
    expect(ignores).toHaveLength(1)
    expect(ignores[0]).toMatchObject({ id: 'x', raison: 'type_inconnu', jours: [] })
  })

  it('le créneau ferie du seed ne déclenche jamais rien (géré à part, par design)', () => {
    const cat = [creneau({ id: 'fe', code: 'ferie', nom: 'Jour férié', surFeries: true })]
    expect(detecterCreneauxIgnores(cat)).toEqual([])
  })
})
