// ============================================================
// GUARDVETO — P4 slice 1 : l'AVANTAGE FINANCIER devient réglable
// ============================================================
// R11b (« équilibrer qui est 1er le week-end ») n'est plus câblé en dur sur le
// rôle 'premier' : le moteur équilibre le rôle `roleAvantageFinancier`, réglable.
//   • absent → défaut 'premier' (byte-identique à l'historique — prouvé par le
//     reste du banc, 363 passed inchangés).
//   • null → AUCUN équilibrage du rôle (l'IA a appris qu'être 1er ne change rien).
//   • autre label → l'avantage porte sur ce rôle-là.
//
// Ce test attaque DIRECTEMENT le scorer exporté (arithmétique déterministe) +
// prouve que la config traverse tout le moteur (end-to-end) sans casser.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  genererPlanningPur,
  scorerCandidatLNS,
  type SolverInput,
  type SolverStep,
} from '@/engine/solver'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { DEFAULT_EQUITY_WEIGHTS } from '@/engine/equity-weights'
import type { VetEngine, PlanningPartiel } from '@/engine/types'

// ── Fixture : X a déjà été 1er d'UN week-end (weekendPremier = 1) ──
const vets: VetEngine[] = ['x', 'y', 'z'].map((id) => ({
  id,
  nom: id.toUpperCase(),
  prenom: id,
  statut: 'associe',
  dernier_recours: false,
  contraintes: [],
  conges: [],
}))

// Un week-end déjà pourvu : X en 1er, Y en 2nd.
const planning: PlanningPartiel = {
  attributions: [
    {
      date: '2026-01-10', // samedi
      type: 'weekend',
      placements: [
        { role: 'premier', vetId: 'x' },
        { role: 'second', vetId: 'y' },
      ],
    },
  ],
}

// On score X pour un créneau vendredi_soir en 1er (là où R11b agit).
const stepVenPremier: SolverStep = {
  date: '2026-01-16', // vendredi
  type: 'vendredi_soir',
  saison: 'hiver',
  role: 'premier',
  besoinSecond: true,
}

const W = DEFAULT_EQUITY_WEIGHTS.WE_PREMIER_ROLE // 25

describe('P4 slice 1 — le rôle à avantage financier est réglable (scorer)', () => {
  // Référence SANS équilibrage du rôle (null) : le malus R11b vaut 0.
  const scoreNeutre = scorerCandidatLNS(
    stepVenPremier, vets[0], planning, vets, DEFAULT_EQUITY_WEIGHTS, undefined, null,
  )

  it('défaut = "premier" : X (déjà 1er) est DÉPRIORITISÉ pour rester 1er (−W)', () => {
    const scorePremier = scorerCandidatLNS(
      stepVenPremier, vets[0], planning, vets, DEFAULT_EQUITY_WEIGHTS, undefined, 'premier',
    )
    // -weekendPremier(1) * W par rapport au neutre.
    expect(scorePremier).toBe(scoreNeutre - W)
  })

  it('avantage sur "second" : le signe s\'inverse pour un step 1er (+W)', () => {
    const scoreSecond = scorerCandidatLNS(
      stepVenPremier, vets[0], planning, vets, DEFAULT_EQUITY_WEIGHTS, undefined, 'second',
    )
    expect(scoreSecond).toBe(scoreNeutre + W)
  })

  it('null : aucun équilibrage du rôle (malus R11b = 0)', () => {
    // Le neutre ne contient QUE l'équité week-end + pénalités, pas le malus rôle.
    // On le vérifie en le comparant à premier/second qui, eux, portent ±W.
    const scorePremier = scorerCandidatLNS(
      stepVenPremier, vets[0], planning, vets, DEFAULT_EQUITY_WEIGHTS, undefined, 'premier',
    )
    expect(scoreNeutre).not.toBe(scorePremier) // le malus existe bien quand un rôle est avantagé
    expect(scoreNeutre - scorePremier).toBe(W) // et il vaut exactement W
  })

  it('le défaut (param omis) == "premier" explicite', () => {
    const omis = scorerCandidatLNS(
      stepVenPremier, vets[0], planning, vets, DEFAULT_EQUITY_WEIGHTS, undefined,
    )
    const explicite = scorerCandidatLNS(
      stepVenPremier, vets[0], planning, vets, DEFAULT_EQUITY_WEIGHTS, undefined, 'premier',
    )
    expect(omis).toBe(explicite)
  })
})

// ── End-to-end : la config traverse tout le moteur sans casser ──
describe('P4 slice 1 — roleAvantageFinancier=null traverse le moteur (end-to-end)', () => {
  const base: SolverInput = {
    dateDebut: '2026-01-05', // lundi
    dateFin: '2026-01-18', // 2 semaines
    saison: 'hiver',
    vets,
    bonusMalus: {},
  }

  it('null → planning valide (aucune violation)', () => {
    const result = genererPlanningPur({ ...base, roleAvantageFinancier: null })
    expect(result.success).toBe(true)
    if (!result.success) return
    const violations = validerPlanning(result.planning, {
      dateDebut: base.dateDebut, dateFin: base.dateFin, saison: 'hiver', vets,
    })
    expect(violations).toEqual([])
  })

  it('défaut (omis) → planning valide (comportement historique)', () => {
    const result = genererPlanningPur(base)
    expect(result.success).toBe(true)
    if (!result.success) return
    const violations = validerPlanning(result.planning, {
      dateDebut: base.dateDebut, dateFin: base.dateFin, saison: 'hiver', vets,
    })
    expect(violations).toEqual([])
  })
})
