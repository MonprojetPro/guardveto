// ============================================================
// GUARDVETO — Cohortes d'équité par tag (Vague 6 tranche A — #21)
// ============================================================
// Chaque règle `equilibrer` AVEC un tag = une entrée de score indépendante
// (dimension × cohorte × importance) qui S'AJOUTE aux 6 dimensions globales.
// Couvre :
//   A. Byte-identique : aucune cohorte → score/planning strictement inchangés.
//   B. Mapper : extraireEquityRules lit + normalise le tag optionnel.
//   C. buildEquityWeights : sépare globales (sans tag) et cohortes (avec tag),
//      « ignoree » (poids 0) → cohorte inerte (jamais matérialisée).
//   D. Variance cohorte : la variance ne compte QUE les porteurs du tag.
//   E. Somme multi-cohortes : deux cohortes = deux variances additionnées.
//   F. Inertie 0-1 porteur : cohorte sans porteur / à un seul porteur = coût 0.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  scorerPlanning,
  Etage,
} from '@/engine/score-lexicographique'
import {
  DEFAULT_EQUITY_WEIGHTS,
  buildEquityWeights,
  IMPORTANCE_TO_WEIGHT,
  type EquityWeights,
} from '@/engine/equity-weights'
import { extraireEquityRules, type RegleCabinetRow } from '@/data/mapReglesCabinet'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, VetEngineNormalise, PlanningPartiel } from '@/engine/types'

// ── Fixtures : 4 vétos, 2 juniors + 2 seniors (tags), aucune contrainte ──
function vetsTagues(): VetEngineNormalise[] {
  return normaliserContraintesVets([
    { id: 'j1', prenom: 'J1', nom: 'T', statut: 'associe', dernier_recours: false, tags: ['junior'], contraintes: [], conges: [] },
    { id: 'j2', prenom: 'J2', nom: 'T', statut: 'associe', dernier_recours: false, tags: ['Junior'], contraintes: [], conges: [] }, // casse différente
    { id: 's1', prenom: 'S1', nom: 'T', statut: 'associe', dernier_recours: false, tags: ['senior'], contraintes: [], conges: [] },
    { id: 's2', prenom: 'S2', nom: 'T', statut: 'associe', dernier_recours: false, tags: ['senior'], contraintes: [], conges: [] },
  ] as VetEngine[])
}

// Un planning où SEULS les juniors sont déséquilibrés (j1 fait tous les WE),
// les seniors parfaitement équilibrés (1 WE chacun via le rôle second).
const planning: PlanningPartiel = {
  attributions: [
    { date: '2026-01-10', type: 'weekend', placements: [{ role: 'premier', vetId: 'j1' }, { role: 'second', vetId: 's1' }] },
    { date: '2026-01-17', type: 'weekend', placements: [{ role: 'premier', vetId: 'j1' }, { role: 'second', vetId: 's2' }] },
  ],
}

// ── A. Byte-identique : aucune cohorte ───────────────────────
describe('Cohortes #21 — A. byte-identique sans cohorte', () => {
  it('poids SANS clé cohortes ≡ poids AVEC cohortes:[] ≡ DEFAULT (même étage EQUITE)', () => {
    const vets = vetsTagues()
    const base = scorerPlanning(planning, vets, 'hiver', DEFAULT_EQUITY_WEIGHTS).etages[Etage.EQUITE]
    const vide: EquityWeights = { ...DEFAULT_EQUITY_WEIGHTS, cohortes: [] }
    const eqVide = scorerPlanning(planning, vets, 'hiver', vide).etages[Etage.EQUITE]
    expect(eqVide).toBe(base)
  })

  it('buildEquityWeights([]) ne pose AUCUNE clé cohortes (byte-identique)', () => {
    expect('cohortes' in buildEquityWeights([])).toBe(false)
  })

  it('une règle equilibrer GLOBALE (sans tag) ne crée pas de cohorte', () => {
    const w = buildEquityWeights([{ dimension: 'weekend', importance: 'essentiel' }])
    expect(w.cohortes).toBeUndefined()
    expect(w.WE_GARDE).toBe(IMPORTANCE_TO_WEIGHT.essentiel)
  })
})

// ── B. Mapper : tag optionnel lu + normalisé ─────────────────
describe('Cohortes #21 — B. extraireEquityRules lit le tag', () => {
  it('un tag présent est normalisé (trim().toLowerCase())', () => {
    const rows: RegleCabinetRow[] = [
      { id: '1', cabinet_id: 'c', periode_id: null, brique_id: 'equilibrer', actif: true,
        force: 'si_possible', params_json: { params: { dimension: 'weekend', importance: 'important', tag: '  JUNIOR ' } } },
    ]
    expect(extraireEquityRules(rows)).toEqual([
      { dimension: 'weekend', importance: 'important', tag: 'junior' },
    ])
  })

  it('un tag vide/absent → règle globale (pas de champ tag)', () => {
    const rows: RegleCabinetRow[] = [
      { id: '1', cabinet_id: 'c', periode_id: null, brique_id: 'equilibrer', actif: true,
        force: 'si_possible', params_json: { params: { dimension: 'ferie', importance: 'normal', tag: '   ' } } },
      { id: '2', cabinet_id: 'c', periode_id: null, brique_id: 'equilibrer', actif: true,
        force: 'si_possible', params_json: { params: { dimension: 'weekend', importance: 'normal' } } },
    ]
    const rules = extraireEquityRules(rows)
    expect(rules).toEqual([
      { dimension: 'ferie', importance: 'normal' },
      { dimension: 'weekend', importance: 'normal' },
    ])
    expect('tag' in rules[0]).toBe(false)
  })
})

// ── C. buildEquityWeights : globales vs cohortes ─────────────
describe('Cohortes #21 — C. buildEquityWeights sépare globales/cohortes', () => {
  it('une règle taguée devient une cohorte, la globale reste un poids', () => {
    const w = buildEquityWeights([
      { dimension: 'weekend', importance: 'essentiel' },              // globale
      { dimension: 'weekend', importance: 'important', tag: 'junior' }, // cohorte
    ])
    expect(w.WE_GARDE).toBe(IMPORTANCE_TO_WEIGHT.essentiel) // globale intacte
    expect(w.cohortes).toEqual([
      { dimension: 'weekend', tag: 'junior', poids: IMPORTANCE_TO_WEIGHT.important },
    ])
  })

  it('une cohorte « ignoree » (poids 0) est INERTE (jamais matérialisée)', () => {
    const w = buildEquityWeights([
      { dimension: 'weekend', importance: 'ignoree', tag: 'junior' },
    ])
    expect(w.cohortes).toBeUndefined()
  })
})

// ── D. Variance cohorte : seuls les porteurs comptent ────────
describe('Cohortes #21 — D. la variance ne compte que les porteurs', () => {
  const vets = vetsTagues()

  it('cohorte junior sur weekend = coût > 0 (juniors déséquilibrés)', () => {
    // Poids globaux à 0 pour ISOLER la contribution cohorte.
    const w: EquityWeights = {
      WE_GARDE: 0, WE_PREMIER_ROLE: 0, FERIES: 0,
      SEMAINE_PREMIER: 0, SEMAINE_SECOND: 0, GRANDS_WE: 0,
      cohortes: [{ dimension: 'weekend', tag: 'junior', poids: 100 }],
    }
    const eq = scorerPlanning(planning, vets, 'hiver', w).etages[Etage.EQUITE]
    // j1 = 2 WE, j2 = 0 WE → variance([2,0]) = 1 ; × 100 × 1000 (arrondi) = 100000.
    expect(eq).toBe(100000)
  })

  it('cohorte senior sur weekend = coût 0 (seniors équilibrés : 1 WE chacun)', () => {
    const w: EquityWeights = {
      WE_GARDE: 0, WE_PREMIER_ROLE: 0, FERIES: 0,
      SEMAINE_PREMIER: 0, SEMAINE_SECOND: 0, GRANDS_WE: 0,
      cohortes: [{ dimension: 'weekend', tag: 'senior', poids: 100 }],
    }
    expect(scorerPlanning(planning, vets, 'hiver', w).etages[Etage.EQUITE]).toBe(0)
  })
})

// ── E. Somme multi-cohortes ──────────────────────────────────
describe('Cohortes #21 — E. deux cohortes = deux variances additionnées', () => {
  it('junior (coût) + senior (0) = la somme du junior seul', () => {
    const vets = vetsTagues()
    const commun = { WE_GARDE: 0, WE_PREMIER_ROLE: 0, FERIES: 0, SEMAINE_PREMIER: 0, SEMAINE_SECOND: 0, GRANDS_WE: 0 }
    const jSeul: EquityWeights = { ...commun, cohortes: [{ dimension: 'weekend', tag: 'junior', poids: 100 }] }
    const deux: EquityWeights = {
      ...commun,
      cohortes: [
        { dimension: 'weekend', tag: 'junior', poids: 100 },
        { dimension: 'weekend', tag: 'senior', poids: 100 },
      ],
    }
    const eqJ = scorerPlanning(planning, vets, 'hiver', jSeul).etages[Etage.EQUITE]
    const eqDeux = scorerPlanning(planning, vets, 'hiver', deux).etages[Etage.EQUITE]
    expect(eqDeux).toBe(eqJ) // senior contribue 0
    expect(eqDeux).toBeGreaterThan(0)
  })
})

// ── F. Inertie 0 / 1 porteur ─────────────────────────────────
describe('Cohortes #21 — F. cohorte sans porteur / à 1 porteur = inerte', () => {
  const vets = vetsTagues()
  const commun = { WE_GARDE: 0, WE_PREMIER_ROLE: 0, FERIES: 0, SEMAINE_PREMIER: 0, SEMAINE_SECOND: 0, GRANDS_WE: 0 }

  it('tag qu’aucun véto ne porte → coût 0 (jamais de crash)', () => {
    const w: EquityWeights = { ...commun, cohortes: [{ dimension: 'weekend', tag: 'fantome', poids: 100 }] }
    expect(scorerPlanning(planning, vets, 'hiver', w).etages[Etage.EQUITE]).toBe(0)
  })

  it('tag porté par UN SEUL véto → variance 0 → coût 0', () => {
    const solo = normaliserContraintesVets([
      { id: 'j1', prenom: 'J1', nom: 'T', statut: 'associe', dernier_recours: false, tags: ['solo'], contraintes: [], conges: [] },
      { id: 'j2', prenom: 'J2', nom: 'T', statut: 'associe', dernier_recours: false, tags: [], contraintes: [], conges: [] },
      { id: 's1', prenom: 'S1', nom: 'T', statut: 'associe', dernier_recours: false, tags: [], contraintes: [], conges: [] },
      { id: 's2', prenom: 'S2', nom: 'T', statut: 'associe', dernier_recours: false, tags: [], contraintes: [], conges: [] },
    ] as VetEngine[])
    const w: EquityWeights = { ...commun, cohortes: [{ dimension: 'weekend', tag: 'solo', poids: 100 }] }
    expect(scorerPlanning(planning, solo, 'hiver', w).etages[Etage.EQUITE]).toBe(0)
  })
})
