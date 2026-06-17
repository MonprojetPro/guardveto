// Tests gate CI — genererPlanningPur (F6-001)
// Jeu minimal : 3 vétos (dont 1 dernier recours), 4 semaines en hiver

import { describe, it, expect } from 'vitest'
import { genererPlanningPur } from '../solver'
import { scorerPlanning, comparerScores } from '../score-lexicographique'
import type { SolverInput } from '../solver'
import type { VetEngine } from '../types'

// ── Fixtures minimalistes ────────────────────────────────

/**
 * 3 vétos pour 4 semaines hiver (2025-11-03 lundi → 2025-11-28 vendredi).
 * La période commence un lundi et finit un vendredi (28 jours).
 */
const DATE_DEBUT = '2025-11-03' // lundi
const DATE_FIN = '2025-11-28'   // vendredi (4 semaines)

function makeVets(overrides?: Partial<VetEngine>[]): VetEngine[] {
  const base: VetEngine[] = [
    {
      id: 'vet-1',
      nom: 'Dupont',
      prenom: 'Alice',
      statut: 'associe',
      dernier_recours: false,
      contraintes: [],
      conges: [],
    },
    {
      id: 'vet-2',
      nom: 'Martin',
      prenom: 'Bob',
      statut: 'associe',
      dernier_recours: false,
      contraintes: [],
      conges: [],
    },
    {
      id: 'vet-3',
      nom: 'Durand',
      prenom: 'Carol',
      statut: 'salarie',
      dernier_recours: true,  // dernier recours
      contraintes: [],
      conges: [],
    },
  ]
  if (overrides) {
    return base.map((v, i) => ({ ...v, ...(overrides[i] ?? {}) }))
  }
  return base
}

function makeInput(vets: VetEngine[], lnsTimeoutMs = 2000): SolverInput {
  return {
    dateDebut: DATE_DEBUT,
    dateFin: DATE_FIN,
    saison: 'hiver',
    vets,
    bonusMalus: {},
    lnsTimeoutMs, // timeout court pour les tests
  }
}

// ── Tests gate CI ────────────────────────────────────────

describe('genererPlanningPur — gate CI', () => {
  it('génère un planning complet sans exception sur 3 vétos × 4 semaines', () => {
    const result = genererPlanningPur(makeInput(makeVets()))

    expect(result.success).toBe(true)
    if (!result.success) return

    // Le planning doit avoir des attributions
    expect(result.planning.attributions.length).toBeGreaterThan(0)

    // Chaque attribution doit avoir au moins un véto
    for (const a of result.planning.attributions) {
      expect(a.premier_id).not.toBeNull()
      // second_id peut être null en été mais pas en hiver
      expect(a.second_id).not.toBeNull()
    }

    expect(result.dureeMs).toBeGreaterThan(0)
  })

  it('est déterministe : deux runs avec le même input donnent le même planning', () => {
    const input = makeInput(makeVets())
    const result1 = genererPlanningPur(input)
    const result2 = genererPlanningPur(input)

    expect(result1.success).toBe(true)
    expect(result2.success).toBe(true)
    if (!result1.success || !result2.success) return

    // Même nombre d'attributions
    expect(result1.planning.attributions.length).toBe(result2.planning.attributions.length)

    // Même contenu (ordre indépendant — on trie avant de comparer)
    const sort = (a: typeof result1.planning.attributions) =>
      [...a].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.type < y.type ? -1 : 1))

    const a1 = sort(result1.planning.attributions)
    const a2 = sort(result2.planning.attributions)

    expect(a1).toEqual(a2)
  })

  it('ne planifie jamais un vétérinaire ayant un congé ce jour-là', () => {
    // vet-1 est en congé toute la période
    const vets = makeVets([
      {
        conges: [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' }],
      },
    ])
    const result = genererPlanningPur(makeInput(vets))

    expect(result.success).toBe(true)
    if (!result.success) return

    // vet-1 ne doit apparaître dans aucune attribution
    for (const a of result.planning.attributions) {
      expect(a.premier_id).not.toBe('vet-1')
      expect(a.second_id).not.toBe('vet-1')
    }
  })

  it('le score LNS est inférieur ou égal au score seed seul (LNS améliore ou maintient)', () => {
    const vets = makeVets()

    // Seed seul (timeout LNS = 0 ms, on ne peut pas désactiver LNS directement
    // mais un timeout 0 force l'arrêt immédiat après le seed)
    const seedResult = genererPlanningPur({ ...makeInput(vets), lnsTimeoutMs: 0 })
    // Résultat avec LNS activé
    const lnsResult = genererPlanningPur(makeInput(vets))

    expect(seedResult.success).toBe(true)
    expect(lnsResult.success).toBe(true)
    if (!seedResult.success || !lnsResult.success) return

    const scoreSeed = scorerPlanning(seedResult.planning, vets, 'hiver')
    const scoreLns = scorerPlanning(lnsResult.planning, vets, 'hiver')

    // LNS doit être meilleur ou égal au seed (jamais pire)
    // comparerScores < 0 → lns meilleur ; === 0 → égal ; > 0 → seed meilleur (impossible)
    expect(comparerScores(scoreLns, scoreSeed)).toBeLessThanOrEqual(0)
  })
})
