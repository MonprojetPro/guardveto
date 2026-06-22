// ============================================================
// GUARDVETO — P1-B : routage DUR / MOU des règles configurées
// ============================================================
// Prouve le cœur du lot P1-B : l'étage (config.force) d'une règle configurée
// décide si elle BLOQUE (dur, étage ≤ 2) ou PÉNALISE sans bloquer (mou, ≥ 3).
// Les règles legacy sans force restent dures (défaut). Les règles
// structurelles ne sont pas concernées (toujours dures).
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid, penaliteContraintesConfig } from '@/engine/rules/hard-constraints'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { SlotGarde, PlanningPartiel, VetEngineNormalise, ContrainteEngine } from '@/engine/types'

const planningVide: PlanningPartiel = { attributions: [] }
// 2026-03-11 = mercredi, hors vacances scolaires.
const slotMercredi: SlotGarde = { date: '2026-03-11', type: 'semaine_soir', saison: 'hiver' }

function vetAvecReposMercredi(force: number | undefined): VetEngineNormalise {
  const config: Record<string, unknown> = { brique: 'interdire_creneau', jour: 'mercredi' }
  if (force !== undefined) config.force = force
  return normaliserContraintesVets([{
    id: 'v1', nom: 'Test', prenom: 'Testeur', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'c1', type: 'jour_repos_fixe', actif: true, config } as ContrainteEngine],
  }])[0]
}

describe('P1-B — routage dur/mou des règles configurées', () => {
  it('étage 2 (jamais) → BLOQUE en dur', () => {
    const vet = vetAvecReposMercredi(2)
    const r = isValid(slotMercredi, vet, 'premier', [vet], planningVide)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/R1/)
    expect(penaliteContraintesConfig(slotMercredi, vet, 'premier', planningVide)).toBe(0)
  })

  it('force absente (legacy) → BLOQUE en dur (défaut sûr)', () => {
    const vet = vetAvecReposMercredi(undefined)
    expect(isValid(slotMercredi, vet, 'premier', [vet], planningVide).valid).toBe(false)
  })

  it('étage 4 (evitee) → NE bloque PAS, mais pénalise', () => {
    const vet = vetAvecReposMercredi(4)
    const r = isValid(slotMercredi, vet, 'premier', [vet], planningVide)
    expect(r.valid).toBe(true) // mou : autorisé si pas le choix
    expect(penaliteContraintesConfig(slotMercredi, vet, 'premier', planningVide)).toBeGreaterThan(0)
  })

  it('étage 3 (sauf_crise) pénalise plus fort qu\'étage 5 (si_possible)', () => {
    const pen3 = penaliteContraintesConfig(slotMercredi, vetAvecReposMercredi(3), 'premier', planningVide)
    const pen5 = penaliteContraintesConfig(slotMercredi, vetAvecReposMercredi(5), 'premier', planningVide)
    expect(pen3).toBeGreaterThan(pen5)
    expect(pen5).toBeGreaterThan(0)
  })

  it('un jour SANS repos → ni blocage ni pénalité, quel que soit l\'étage', () => {
    const vet = vetAvecReposMercredi(4)
    const slotJeudi: SlotGarde = { date: '2026-03-12', type: 'semaine_soir', saison: 'hiver' }
    expect(isValid(slotJeudi, vet, 'premier', [vet], planningVide).valid).toBe(true)
    expect(penaliteContraintesConfig(slotJeudi, vet, 'premier', planningVide)).toBe(0)
  })
})
