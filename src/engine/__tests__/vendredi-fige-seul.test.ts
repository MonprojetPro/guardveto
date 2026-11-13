// ============================================================
// B-189 — CADENASSER LE VENDREDI SEUL
// ============================================================
// MiKL, le 05/11 : « il clique, ça verrouille, point » — un cadenas posé sur le
// vendredi d'un week-end ne fixe QUE le vendredi. Et pour le moteur : « il faut
// qu'il raisonne normalement, sauf que certains choix seront mis en place en
// amont ».
//
// Le vendredi est déjà un créneau à part pour le moteur (`vendredi_soir`), lié
// au week-end par ses règles (même équipe, rôles inversés). Le cadenas du
// vendredi lui arrive donc comme une place figée ordinaire : il compose le
// week-end AUTOUR, avec ses règles habituelles.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, remplirAuMieux, type SolverInput } from '../solver'
import { vetPourRole } from '../attribution'
import type { PlanningPartiel, VetEngine } from '../types'

const VENDREDI = '2025-11-07'
const SAMEDI = '2025-11-08'

function vet(id: string, prenom: string): VetEngine {
  return { id, nom: prenom, prenom, statut: 'associe', dernier_recours: false, contraintes: [], conges: [] }
}

const EQUIPE = () => [
  vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol'),
  vet('v4', 'David'), vet('v5', 'Eve'),
]

function input(placesFigees: SolverInput['placesFigees']): SolverInput {
  return {
    dateDebut: '2025-11-03', dateFin: '2025-11-28', saison: 'hiver',
    vets: EQUIPE(), reportEquite: {}, lnsTimeoutMs: 2000, placesFigees,
  }
}

function placeDe(planning: PlanningPartiel, date: string, type: string, role: string): string | null {
  const attr = planning.attributions.find((a) => a.date === date && a.type === type)
  return attr ? vetPourRole(attr, role) : null
}

describe('B-189 — un vendredi cadenassé seul', () => {
  it('garde la personne du vendredi, et compose le week-end autour avec les règles habituelles', () => {
    const r = genererPlanningPur(input([{ date: VENDREDI, type: 'vendredi_soir', role: 'premier', vetId: 'v3' }]))
    expect(r.success).toBe(true)
    if (!r.success) return

    expect(placeDe(r.planning, VENDREDI, 'vendredi_soir', 'premier')).toBe('v3')
    // Règles du cabinet par défaut : même équipe le week-end, rôles inversés.
    expect(placeDe(r.planning, SAMEDI, 'weekend', 'second')).toBe('v3')
    expect(placeDe(r.planning, SAMEDI, 'weekend', 'premier'))
      .toBe(placeDe(r.planning, VENDREDI, 'vendredi_soir', 'second'))
  })

  it('tient aussi les deux places du vendredi', () => {
    const r = genererPlanningPur(input([
      { date: VENDREDI, type: 'vendredi_soir', role: 'premier', vetId: 'v3' },
      { date: VENDREDI, type: 'vendredi_soir', role: 'second', vetId: 'v5' },
    ]))
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(placeDe(r.planning, VENDREDI, 'vendredi_soir', 'premier')).toBe('v3')
    expect(placeDe(r.planning, VENDREDI, 'vendredi_soir', 'second')).toBe('v5')
    expect(placeDe(r.planning, SAMEDI, 'weekend', 'premier')).toBe('v5')
    expect(placeDe(r.planning, SAMEDI, 'weekend', 'second')).toBe('v3')
  })

  it('le remplissage de secours le tient aussi', () => {
    const r = remplirAuMieux(input([{ date: VENDREDI, type: 'vendredi_soir', role: 'second', vetId: 'v2' }]))
    expect(placeDe(r.planning, VENDREDI, 'vendredi_soir', 'second')).toBe('v2')
    expect(placeDe(r.planning, SAMEDI, 'weekend', 'premier')).toBe('v2')
  })
})
