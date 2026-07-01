// ============================================================
// GUARDVETO — P4 slice 1 (+1.5) : l'AVANTAGE FINANCIER devient réglable
// ============================================================
// R11b (« équilibrer qui a le rôle à avantage financier le week-end ») n'est
// plus câblé en dur sur 'premier' :
//   • le SCORER (slice 1) applique le malus sur le rôle `roleAvantageFinancier`.
//   • le COMPTEUR (slice 1.5, compterParVet) compte ce MÊME rôle configuré.
// Défaut 'premier' → byte-identique à l'historique (363 passed inchangés).
// null → aucun rôle avantagé (l'IA a appris qu'être 1er ne change rien).
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  genererPlanningPur,
  scorerCandidatLNS,
  type SolverInput,
  type SolverStep,
} from '@/engine/solver'
import { compterParVet } from '@/engine/rules/optimization'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { DEFAULT_EQUITY_WEIGHTS } from '@/engine/equity-weights'
import type { VetEngine, PlanningPartiel } from '@/engine/types'

// ── Vétos simples ──
const vets: VetEngine[] = ['x', 'y', 'z'].map((id) => ({
  id,
  nom: id.toUpperCase(),
  prenom: id,
  statut: 'associe',
  dernier_recours: false,
  contraintes: [],
  conges: [],
}))

// ── Fixture : X a été 1er d'un WE (2026-01-10) ET 2nd d'un autre (2026-01-17) ──
// → compteur('premier').X = 1 ET compteur('second').X = 1 : permet de prouver
//   que le malus suit BIEN le rôle configuré (le compteur aussi — slice 1.5).
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
    {
      date: '2026-01-17', // samedi
      type: 'weekend',
      placements: [
        { role: 'premier', vetId: 'z' },
        { role: 'second', vetId: 'x' },
      ],
    },
  ],
}

// ── Slice 1.5 : le COMPTEUR suit le rôle configuré ──
describe('P4 slice 1.5 — compterParVet suit le rôle à avantage configuré', () => {
  const cptPremier = compterParVet(planning, vets, 'premier')
  const cptSecond = compterParVet(planning, vets, 'second')
  const cptNull = compterParVet(planning, vets, null)
  const get = (cpt: ReturnType<typeof compterParVet>, id: string) =>
    cpt.find((c) => c.vetId === id)!.weekendPremier

  it('rôle="premier" : compte X=1 (1er en W1), Z=1 (1er en W2), Y=0', () => {
    expect(get(cptPremier, 'x')).toBe(1)
    expect(get(cptPremier, 'z')).toBe(1)
    expect(get(cptPremier, 'y')).toBe(0)
  })

  it('rôle="second" : compte Y=1 (2nd en W1), X=1 (2nd en W2), Z=0', () => {
    expect(get(cptSecond, 'y')).toBe(1)
    expect(get(cptSecond, 'x')).toBe(1)
    expect(get(cptSecond, 'z')).toBe(0)
  })

  it('null : aucun rôle avantagé → compteur nul pour tous', () => {
    expect(cptNull.every((c) => c.weekendPremier === 0)).toBe(true)
  })

  it('défaut (param omis) == "premier"', () => {
    const omis = compterParVet(planning, vets)
    expect(omis.map((c) => c.weekendPremier)).toEqual(cptPremier.map((c) => c.weekendPremier))
  })
})

// ── Slice 1 : le SCORER applique le malus sur le rôle configuré ──
const stepVenPremier: SolverStep = {
  date: '2026-01-23', // vendredi
  type: 'vendredi_soir',
  saison: 'hiver',
  role: 'premier',
  besoinSecond: true,
}
const W = DEFAULT_EQUITY_WEIGHTS.WE_PREMIER_ROLE // 25

describe('P4 slice 1 — le scorer applique le malus sur le rôle configuré', () => {
  // X a compteur('premier')=1 ET compteur('second')=1 → les deux crans agissent.
  const scoreNeutre = scorerCandidatLNS(
    stepVenPremier, vets[0], planning, vets, DEFAULT_EQUITY_WEIGHTS, undefined, null,
  )

  it('avantage="premier" : X (déjà 1er) déprioritisé pour rester 1er (−W)', () => {
    const score = scorerCandidatLNS(
      stepVenPremier, vets[0], planning, vets, DEFAULT_EQUITY_WEIGHTS, undefined, 'premier',
    )
    expect(score).toBe(scoreNeutre - W)
  })

  it('avantage="second" : X (déjà 2nd) déprioritisé pour un step 1er (+W)', () => {
    const score = scorerCandidatLNS(
      stepVenPremier, vets[0], planning, vets, DEFAULT_EQUITY_WEIGHTS, undefined, 'second',
    )
    expect(score).toBe(scoreNeutre + W)
  })

  it('null : aucun équilibrage du rôle (malus = 0)', () => {
    const scorePremier = scorerCandidatLNS(
      stepVenPremier, vets[0], planning, vets, DEFAULT_EQUITY_WEIGHTS, undefined, 'premier',
    )
    expect(scoreNeutre - scorePremier).toBe(W)
  })

  it('défaut (param omis) == "premier" explicite', () => {
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
describe('P4 — roleAvantageFinancier=null traverse le moteur (end-to-end)', () => {
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
