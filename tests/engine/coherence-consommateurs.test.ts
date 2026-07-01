// ============================================================
// GUARDVETO — PARADE 3 : cohérence INTER-CONSOMMATEURS (anti-cécité params)
// ============================================================
// Garde-fou structurel contre le bug récurrent « cécité params » : plusieurs
// morceaux de code lisent les MÊMES règles, mais seuls certains « déplient » le
// tiroir config.params → ils ne sont plus d'accord, en silence.
//   • Incident F4-002 (2026-06-19) : générateur ET validateur aveugles ensemble.
//   • Incident Fanny (2026-06-21) : la réparation de crise proposait un véto que
//     le validateur rejetait ensuite (la crise ne dépliait pas params).
//
// CE TEST passe une règle rangée SOUS `params` (format V2 réel en base) à TOUS
// les consommateurs et exige qu'ils soient D'ACCORD. Si un futur consommateur
// régresse (oublie de normaliser), ce test casse AVANT la prod.
//
// Règle pivot : Fanny a un repos DUR le mercredi, rangé sous config.params.jour
// (et NON à la racine). Le mercredi de test : 2026-01-07.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { premierId, secondId } from '@/engine/attribution'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { proposerReparation } from '@/engine/crise/reparer'
import type { VetEngine, PlanningPartiel } from '@/engine/types'

const MERCREDI = '2026-01-07' // mercredi
const LUNDI = '2026-01-05'

// Fanny : repos mercredi DUR (force 2), rangé SOUS params (format brique V2).
// C'est la forme qui « disparaissait » pour les lecteurs non normalisés.
const FANNY: VetEngine = {
  id: 'fanny', prenom: 'Fanny', nom: 'Martin',
  statut: 'associe', dernier_recours: false, conges: [],
  contraintes: [
    {
      id: 'f1', type: 'jour_repos_fixe', actif: true,
      config: { brique: 'interdire_creneau', axes: {}, force: 2, params: { jour: 'mercredi' } },
    },
  ],
}

// Quelques vétos sans contrainte, librement assignables le mercredi.
const AUTRES: VetEngine[] = Array.from({ length: 5 }, (_, i) => ({
  id: `v${i + 1}`, prenom: `V${i + 1}`, nom: 'Test',
  statut: i < 2 ? 'associe' : 'salarie', dernier_recours: false,
  contraintes: [], conges: [],
}))

const TOUS = [FANNY, ...AUTRES]

describe('Cohérence inter-consommateurs — règle rangée sous params (Fanny repos mercredi)', () => {
  // ── 1. RÉPARATION DE CRISE (le bug Fanny) ──────────────────────────────────
  it('proposerReparation ne propose JAMAIS Fanny pour une garde le mercredi', () => {
    const res = proposerReparation({
      creneau: { date: MERCREDI, type: 'semaine_soir', role: 'premier', saison: 'hiver', besoinSecond: false },
      absentId: 'v1', // c'est v1 qui s'absente → on cherche un remplaçant
      vets: TOUS,
      planningComplet: [
        { date: MERCREDI, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v1' }, { role: 'second', vetId: null }] },
      ],
    })
    // Fanny est en repos DUR le mercredi → exclue des candidats…
    expect(res.candidats.every((c) => c.vetId !== 'fanny')).toBe(true)
    // …mais d'autres remplaçants existent (le test n'est pas vide par accident).
    expect(res.candidats.length).toBeGreaterThan(0)
    expect(res.meilleur).not.toBe('fanny')
  })

  // ── 2. VALIDATEUR INDÉPENDANT ──────────────────────────────────────────────
  it('validerPlanning signale Fanny si elle est de garde le mercredi (R1)', () => {
    const planning: PlanningPartiel = {
      attributions: [
        { date: MERCREDI, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'fanny' }, { role: 'second', vetId: null }] },
      ],
    }
    const violations = validerPlanning(planning, {
      dateDebut: MERCREDI, dateFin: MERCREDI, saison: 'hiver',
      vets: TOUS, nbVetosSemaineSoir: 1,
    })
    expect(violations.some((v) => v.regle === 'R1' && v.vetId === 'fanny')).toBe(true)
  })

  // ── 3. GÉNÉRATEUR ──────────────────────────────────────────────────────────
  it('le générateur n’assigne jamais Fanny le mercredi (et le validateur le confirme)', () => {
    const input: SolverInput = {
      dateDebut: LUNDI, dateFin: '2026-01-11', saison: 'hiver',
      vets: TOUS, bonusMalus: {}, nbVetosSemaineSoir: 1,
    }
    const res = genererPlanningPur(input)
    expect(res.success).toBe(true)
    if (!res.success) return

    // Le générateur ne pose pas Fanny le mercredi…
    const mercrediAttr = res.planning.attributions.find(
      (a) => a.date === MERCREDI && a.type === 'semaine_soir',
    )
    if (mercrediAttr) {
      expect(premierId(mercrediAttr)).not.toBe('fanny')
      expect(secondId(mercrediAttr)).not.toBe('fanny')
    }

    // …et le validateur INDÉPENDANT ne trouve aucune violation R1 sur ce planning
    // (générateur ↔ validateur d'accord : c'est exactement la cohérence visée).
    const violations = validerPlanning(res.planning, {
      dateDebut: LUNDI, dateFin: '2026-01-11', saison: 'hiver',
      vets: TOUS, nbVetosSemaineSoir: 1,
    })
    expect(violations.filter((v) => v.regle === 'R1' && v.vetId === 'fanny')).toHaveLength(0)
  })
})
