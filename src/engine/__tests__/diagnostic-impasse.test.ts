// Tests Lot 1 — Diagnostic d'impasse : le créneau bloquant capté est le VRAI.
//
// Stratégie : fabriquer une impasse « effectif requis > vétos disponibles ».
// On ne garde qu'UN véto réellement disponible alors que chaque créneau
// week-end / vendredi soir exige 2 vétos DISTINCTS (premier + second). Le
// second rôle du premier créneau week-end n'a donc plus aucun candidat valide
// → c'est le vrai point d'impasse, que le moteur doit pointer précisément.

import { describe, it, expect } from 'vitest'
import { genererPlanningPur } from '../solver'
import type { SolverInput } from '../solver'
import type { VetEngine } from '../types'

const DATE_DEBUT = '2025-11-03' // lundi
const DATE_FIN = '2025-11-28'   // vendredi (4 semaines hiver)
const PREMIER_VENDREDI = '2025-11-07' // 1er vendredi de la période
const PREMIER_SAMEDI = '2025-11-08'   // 1er samedi (week-end) de la période

/**
 * 2 vétos. vet-2 est en congé toute la période → un seul véto réellement
 * disponible. Les créneaux vendredi soir / week-end exigent 2 vétos distincts
 * (R19/R21) → impasse garantie dès le 2nd rôle du 1er créneau week-end.
 */
function makeInputImpasse(): SolverInput {
  const vets: VetEngine[] = [
    {
      id: 'vet-1', nom: 'Dupont', prenom: 'Alice', statut: 'associe',
      dernier_recours: false, contraintes: [], conges: [],
    },
    {
      id: 'vet-2', nom: 'Martin', prenom: 'Bob', statut: 'associe',
      dernier_recours: false, contraintes: [],
      conges: [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' }],
    },
  ]
  return {
    dateDebut: DATE_DEBUT,
    dateFin: DATE_FIN,
    saison: 'hiver',
    vets,
    bonusMalus: {},
    lnsTimeoutMs: 0,
  }
}

describe('Diagnostic d’impasse (Lot 1) — créneau bloquant fiable', () => {
  it('renvoie success:false avec un diagnostic quand l’effectif requis dépasse les vétos disponibles', () => {
    const result = genererPlanningPur(makeInputImpasse())

    expect(result.success).toBe(false)
    if (result.success) return

    // joursNonCouverts reste fourni (rétro-compat UI)
    expect(result.joursNonCouverts.length).toBeGreaterThan(0)

    // Le diagnostic Lot 1 est présent et pointe un vrai créneau
    expect(result.diagnostic).toBeDefined()
    const diag = result.diagnostic!
    expect(diag.creneauBloquant).toBeDefined()
  })

  it('pointe le BON créneau : le 2nd rôle du premier créneau week-end (1er sans candidat)', () => {
    const result = genererPlanningPur(makeInputImpasse())
    expect(result.success).toBe(false)
    if (result.success) return

    const cb = result.diagnostic!.creneauBloquant

    // C'est forcément un SECOND (le 1er rôle est servi par l'unique véto dispo),
    // sur le tout premier créneau de week-end de la période (vendredi soir ou
    // samedi — les deux exigent un duo distinct). On accepte les deux car
    // l'ordre des steps WE place le vendredi avant le samedi.
    expect(cb.role).toBe('second')
    expect(['vendredi_soir', 'weekend']).toContain(cb.type)
    expect([PREMIER_VENDREDI, PREMIER_SAMEDI]).toContain(cb.date)

    // Lot 2 : les raisons sont désormais remplies. Ici vet-2 est en congé sur
    // tout le créneau → la cause dominante est ce congé (R16).
    expect(cb.reglesEnCause.length).toBeGreaterThan(0)
    expect(result.diagnostic!.reglesEnCause.length).toBeGreaterThan(0)
    expect(result.diagnostic!.reglesEnCause.some((r) => r.code === 'R16')).toBe(true)

    // joursNonCouverts est recopié dans le diagnostic
    expect(result.diagnostic!.joursNonCouverts).toBe(result.joursNonCouverts)
  })

  it('un cas FAISABLE ne produit aucun diagnostic (success:true)', () => {
    const vets: VetEngine[] = [
      { id: 'v1', nom: 'A', prenom: 'A', statut: 'associe', dernier_recours: false, contraintes: [], conges: [] },
      { id: 'v2', nom: 'B', prenom: 'B', statut: 'associe', dernier_recours: false, contraintes: [], conges: [] },
      { id: 'v3', nom: 'C', prenom: 'C', statut: 'salarie', dernier_recours: true, contraintes: [], conges: [] },
    ]
    const input: SolverInput = {
      dateDebut: DATE_DEBUT, dateFin: DATE_FIN, saison: 'hiver',
      vets, bonusMalus: {}, lnsTimeoutMs: 0,
    }
    const result = genererPlanningPur(input)
    expect(result.success).toBe(true)
  })
})

// ============================================================
// LOT 2 / LOT 3 — Raisons fiables + suggestions par re-simulation
// ============================================================

describe('Diagnostic d’impasse (Lot 2/3) — raisons + suggestions', () => {
  // ── (a) Impasse par CONGÉ bloquant ──────────────────────────────────────
  // 3 vétos, 2 en congé toute la période → R16 (congé) écarte ces vétos sur le
  // créneau bloquant. Le congé N'EST PAS auto-assouplissable → la suggestion
  // associée est NON vérifiée (texte informatif honnête, pas de bouton).
  it('(a) impasse par congé → R16 dans les règles en cause, suggestion congé NON vérifiée', () => {
    const vets: VetEngine[] = [
      { id: 'v1', nom: 'A', prenom: 'Alice', statut: 'associe', dernier_recours: false, contraintes: [], conges: [] },
      {
        id: 'v2', nom: 'B', prenom: 'Bob', statut: 'associe', dernier_recours: false, contraintes: [],
        conges: [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' }],
      },
      {
        id: 'v3', nom: 'C', prenom: 'Chloé', statut: 'salarie', dernier_recours: false, contraintes: [],
        conges: [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' }],
      },
    ]
    const input: SolverInput = {
      dateDebut: DATE_DEBUT, dateFin: DATE_FIN, saison: 'hiver',
      vets, bonusMalus: {}, lnsTimeoutMs: 0,
    }
    const result = genererPlanningPur(input)
    expect(result.success).toBe(false)
    if (result.success) return

    const diag = result.diagnostic!
    expect(diag).toBeDefined()

    // R16 (congé) figure dans les règles en cause, porté par un véto en congé.
    const conge = diag.reglesEnCause.find((r) => r.code === 'R16')
    expect(conge).toBeDefined()
    expect(conge!.origine).toBe('conge')
    expect(conge!.vetId).toBeDefined()

    // La suggestion liée au congé existe et n'est PAS vérifiée (non auto-assouplissable).
    const suggConge = diag.suggestions.find((s) => s.regle.code === 'R16')
    expect(suggConge).toBeDefined()
    expect(suggConge!.verifiee).toBe(false)
  })

  // ── (b) Impasse par contrainte FERME → assouplissement VÉRIFIÉ ───────────
  // Période Lun→Jeu (été : 1 véto / soir, aucun WE → pas de bruit R8/R9). v1 a
  // un repos fixe DUR le lundi (R1, force 2) ; v2 est en congé le lundi. Le
  // créneau « lundi soir, 1er » n'a donc plus aucun candidat → impasse.
  // En re-simulant avec le repos fixe relâché (force 3 = mou), v1 redevient
  // assignable le lundi → planning faisable → suggestion VÉRIFIÉE.
  it('(b) impasse par contrainte FERME → suggestion VÉRIFIÉE après assouplissement simulé', () => {
    const REPOS_ID = 'repos-v1-lundi'
    const vets: VetEngine[] = [
      {
        id: 'v1', nom: 'A', prenom: 'Alice', statut: 'associe', dernier_recours: false,
        contraintes: [{
          id: REPOS_ID, type: 'jour_repos_fixe', actif: true,
          config: { brique: 'interdire_creneau', force: 2, params: { jour: 'lundi' } },
        }],
        conges: [],
      },
      {
        id: 'v2', nom: 'B', prenom: 'Bob', statut: 'associe', dernier_recours: false,
        contraintes: [],
        conges: [{ date_debut: '2025-11-03', date_fin: '2025-11-03', type: 'vacances' }],
      },
    ]
    // Lun 03/11 → Jeu 06/11 : pas de vendredi ni de week-end (impasse minimale).
    const input: SolverInput = {
      dateDebut: '2025-11-03', dateFin: '2025-11-06', saison: 'ete',
      vets, bonusMalus: {}, lnsTimeoutMs: 0,
    }
    const result = genererPlanningPur(input)
    expect(result.success).toBe(false)
    if (result.success) return

    const diag = result.diagnostic!
    expect(diag).toBeDefined()

    // Le créneau bloquant est bien le lundi soir, 1er.
    expect(diag.creneauBloquant.date).toBe('2025-11-03')
    expect(diag.creneauBloquant.role).toBe('premier')

    // R1 (repos fixe FERME) en cause, porté par une contrainte ciblable.
    const r1 = diag.reglesEnCause.find((r) => r.code === 'R1')
    expect(r1).toBeDefined()
    expect(r1!.origine).toBe('individuelle')
    expect(r1!.contrainteId).toBe(REPOS_ID)

    // Suggestion VÉRIFIÉE : la re-sim seed greedy avec la règle relâchée aboutit
    // à un planning faisable. Son texte dit « possible » (pas « optimal »).
    const suggR1 = diag.suggestions.find((s) => s.regle.code === 'R1')
    expect(suggR1).toBeDefined()
    expect(suggR1!.verifiee).toBe(true)
    expect(suggR1!.texte).toContain('possible')
    expect(suggR1!.action.type).toBe('assouplir_contrainte')
    expect(suggR1!.action.cible).toBe(REPOS_ID)

    // Le congé (R16) reste NON auto-assouplissable s'il figure dans les pistes.
    const suggR16 = diag.suggestions.find((s) => s.regle.code === 'R16')
    if (suggR16) expect(suggR16.verifiee).toBe(false)
  })
})
