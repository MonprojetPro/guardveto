// ============================================================
// GUARDVETO — P3a-2 : preuve que N PLACES devient réel
// ============================================================
// Le verrou historique « exactement 2 rôles (premier, second) » est levé :
// le nombre de places d'un créneau vient désormais du CATALOGUE (nbPlaces/roles),
// lu INDÉPENDAMMENT par le moteur (stepsForDay) et par le validateur (slotsAttendus).
//
// Test décisif : un catalogue avec un créneau à 3 PLACES doit produire un planning
// à 3 vétos DISTINCTS, jugé VALIDE par le validateur indépendant. C'est la
// démonstration que le rail générique fonctionne au-delà du défaut à 2 rôles.
//
// (L'équivalence du DÉFAUT à 2 places — comportement inchangé — est prouvée par
// le reste du banc : solver.test / moteur-fiabilite / p0/p2b-catalogue-equivalence.)
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { validerPlanning, type ValidationInput } from '@/engine/validation/validerPlanning'
import type { VetEngine } from '@/engine/types'
import type { CreneauModele } from '@/engine/creneau-modele'
import { vetsAttribues } from '@/engine/attribution'

// ── Période : une semaine contenant le samedi 2026-01-10 ──
// dateDebut = lundi (contrat SolverInput) ; dateFin inclut le week-end.
const DATE_DEBUT = '2026-01-05' // lundi
const DATE_FIN = '2026-01-11' // dimanche
const SAMEDI = '2026-01-10'

// ── Catalogue : UN SEUL créneau week-end, mais à 3 PLACES ──
// Les autres jours n'ont aucun créneau → aucun slot (isole le cas N=3).
const creneauWE3: CreneauModele = {
  id: 'cr-we-3',
  code: 'weekend',
  nom: 'Week-end à 3 places',
  joursSemaine: [6], // samedi
  surFeries: false,
  heureDebut: '08:30',
  heureFin: '08:30',
  offsetJoursFin: 2,
  nbPlaces: 3,
  roles: ['premier', 'second', 'troisieme'],
  actif: true,
  ordre: 1,
}
const CATALOGUE_3_PLACES = [creneauWE3]

// ── 5 vétos simples (aucune contrainte, aucun congé) ──
const vets: VetEngine[] = Array.from({ length: 5 }, (_, i) => ({
  id: `v${i + 1}`,
  nom: `Nom${i + 1}`,
  prenom: `Prenom${i + 1}`,
  statut: 'associe',
  dernier_recours: false,
  contraintes: [],
  conges: [],
}))

const solverInput: SolverInput = {
  dateDebut: DATE_DEBUT,
  dateFin: DATE_FIN,
  saison: 'hiver',
  vets,
  bonusMalus: {},
  creneaux: CATALOGUE_3_PLACES,
}

const validationInput: ValidationInput = {
  dateDebut: DATE_DEBUT,
  dateFin: DATE_FIN,
  saison: 'hiver',
  vets,
  creneaux: CATALOGUE_3_PLACES,
}

describe('P3a-2 — un catalogue à 3 places génère un planning à 3 vétos valide', () => {
  const result = genererPlanningPur(solverInput)

  it('le solveur réussit', () => {
    expect(result.success).toBe(true)
  })

  it('le week-end porte 3 placements, tous pourvus', () => {
    if (!result.success) return
    const we = result.planning.attributions.find(
      (a) => a.date === SAMEDI && a.type === 'weekend',
    )
    expect(we).toBeDefined()
    expect(we!.placements).toHaveLength(3)
    expect(we!.placements.every((p) => p.vetId !== null)).toBe(true)
  })

  it('les 3 rôles du catalogue sont présents (premier, second, troisieme)', () => {
    if (!result.success) return
    const we = result.planning.attributions.find((a) => a.date === SAMEDI)!
    const roles = we.placements.map((p) => p.role).sort()
    expect(roles).toEqual(['premier', 'second', 'troisieme'])
  })

  it('les 3 vétos placés sont DISTINCTS', () => {
    if (!result.success) return
    const we = result.planning.attributions.find((a) => a.date === SAMEDI)!
    const assignes = vetsAttribues(we)
    expect(assignes).toHaveLength(3)
    expect(new Set(assignes).size).toBe(3)
  })

  it('le validateur INDÉPENDANT ne trouve AUCUNE violation', () => {
    if (!result.success) return
    const violations = validerPlanning(result.planning, validationInput)
    expect(violations).toEqual([])
  })
})

// ── Contre-preuve : SANS catalogue (legacy), le même week-end reste à 2 places ──
describe('P3a-2 — sans catalogue, le défaut reste 2 places (non-régression)', () => {
  const legacyInput: SolverInput = { ...solverInput, creneaux: undefined }
  const result = genererPlanningPur(legacyInput)

  it('le week-end porte exactement 2 placements', () => {
    expect(result.success).toBe(true)
    if (!result.success) return
    const we = result.planning.attributions.find((a) => a.date === SAMEDI)!
    expect(we.placements).toHaveLength(2)
    expect(vetsAttribues(we)).toHaveLength(2)
  })
})
