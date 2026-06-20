// ============================================================
// GUARDVETO — Équité réglable (règles `equilibrer`) — tests bout-en-bout
// ============================================================
// L'équité est une FAMILLE DE RÈGLE (`equilibrer`) gérée comme les autres,
// mais de forme différente (elle cible un COMPTEUR, pas un véto). Couvre :
//
//   A. Préservation : poids omis ≡ poids = DEFAULT_EQUITY_WEIGHTS.
//   B. Le scoreur global thread les poids (scorerPlanning).
//   C. Le solveur (seed greedy) thread les poids → pas une coquille vide.
//   D. buildEquityWeights / extraireEquityRules (pur) : cran → poids, défauts.
//   E. Le TUYAU : loader extrait l'équité des règles `equilibrer`, et
//      resoudreContexte propage equityWeights + nbVetosSemaineSoir (anti-bombe).
//
// ⚠️ Déterminisme : le LNS est non déterministe (borné par le temps). A et C
// utilisent lnsTimeoutMs: 0 → seed greedy pur, 100 % déterministe.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import {
  scorerPlanning,
  empreinteTieBreak,
  Etage,
} from '@/engine/score-lexicographique'
import {
  DEFAULT_EQUITY_WEIGHTS,
  buildEquityWeights,
  IMPORTANCE_TO_WEIGHT,
  type EquityWeights,
} from '@/engine/equity-weights'
import { extraireEquityRules, type RegleCabinetRow } from '@/data/mapReglesCabinet'
import type { VetEngine, PlanningPartiel } from '@/engine/types'

// ── Fixtures : 7 vétos SANS contrainte (l'équité est le seul levier) ──
function vetsSimples(): VetEngine[] {
  return Array.from({ length: 7 }, (_, i) => ({
    id: `v${i + 1}`,
    prenom: `V${i + 1}`,
    nom: 'Test',
    statut: i < 4 ? 'associe' : 'salarie',
    dernier_recours: false,
    contraintes: [],
    conges: [],
  }))
}

const BASE: SolverInput = {
  dateDebut: '2026-01-05',
  dateFin: '2026-02-01',
  saison: 'hiver',
  vets: vetsSimples(),
  bonusMalus: {},
  lnsTimeoutMs: 0, // → seed greedy pur, déterministe
}

// ── A. Préservation du comportement ──────────────────────────
describe('Équité réglable — A. préservation', () => {
  it('poids omis ≡ poids = DEFAULT_EQUITY_WEIGHTS (planning identique)', () => {
    const sansPoids = genererPlanningPur(BASE)
    const avecDefaut = genererPlanningPur({ ...BASE, equityWeights: DEFAULT_EQUITY_WEIGHTS })
    expect(sansPoids.success).toBe(true)
    expect(avecDefaut.success).toBe(true)
    if (sansPoids.success && avecDefaut.success) {
      expect(empreinteTieBreak(avecDefaut.planning)).toBe(empreinteTieBreak(sansPoids.planning))
    }
  })
})

// ── B. Le scoreur global thread les poids ────────────────────
describe('Équité réglable — B. scorerPlanning thread les poids', () => {
  const planningDeseq: PlanningPartiel = {
    attributions: [
      { date: '2026-01-10', type: 'weekend', premier_id: 'v1', second_id: 'v2' },
      { date: '2026-01-17', type: 'weekend', premier_id: 'v1', second_id: 'v3' },
      { date: '2026-01-24', type: 'weekend', premier_id: 'v1', second_id: 'v4' },
    ],
  }
  const vets = vetsSimples()

  it('un poids WE_GARDE plus élevé alourdit l’étage ÉQUITÉ du même planning', () => {
    const faible: EquityWeights = { ...DEFAULT_EQUITY_WEIGHTS, WE_GARDE: 1 }
    const fort: EquityWeights = { ...DEFAULT_EQUITY_WEIGHTS, WE_GARDE: 1000 }
    const eqFaible = scorerPlanning(planningDeseq, vets, 'hiver', faible).etages[Etage.EQUITE]
    const eqFort = scorerPlanning(planningDeseq, vets, 'hiver', fort).etages[Etage.EQUITE]
    expect(eqFort).toBeGreaterThan(eqFaible)
  })

  it('mettre tous les poids à 0 annule le coût d’équité', () => {
    const zero: EquityWeights = {
      WE_GARDE: 0, WE_PREMIER_ROLE: 0, FERIES: 0,
      SEMAINE_PREMIER: 0, SEMAINE_SECOND: 0, GRANDS_WE: 0,
    }
    expect(scorerPlanning(planningDeseq, vets, 'hiver', zero).etages[Etage.EQUITE]).toBe(0)
  })
})

// ── C. Le solveur (seed greedy) thread les poids ─────────────
describe('Équité réglable — C. le solveur utilise les poids', () => {
  const extreme: EquityWeights = {
    WE_GARDE: 0, WE_PREMIER_ROLE: 0, FERIES: 0,
    SEMAINE_PREMIER: 0, SEMAINE_SECOND: 1000, GRANDS_WE: 0,
  }

  it('un profil de poids extrême change le planning produit (pas une coquille vide)', () => {
    const parDefaut = genererPlanningPur(BASE)
    const skew = genererPlanningPur({ ...BASE, equityWeights: extreme })
    expect(parDefaut.success && skew.success).toBe(true)
    if (parDefaut.success && skew.success) {
      expect(empreinteTieBreak(skew.planning)).not.toBe(empreinteTieBreak(parDefaut.planning))
    }
  })

  it('un profil personnalisé produit quand même un planning complet', () => {
    expect(genererPlanningPur({ ...BASE, equityWeights: extreme }).success).toBe(true)
  })
})

// ── D. buildEquityWeights / extraireEquityRules (pur) ────────
describe('Équité réglable — D. assemblage des poids depuis les règles', () => {
  it('buildEquityWeights([]) = tous les défauts (WE_1er → normal = 30)', () => {
    const w = buildEquityWeights([])
    expect(w.WE_GARDE).toBe(IMPORTANCE_TO_WEIGHT.essentiel) // 100
    expect(w.FERIES).toBe(IMPORTANCE_TO_WEIGHT.important) // 60
    expect(w.GRANDS_WE).toBe(IMPORTANCE_TO_WEIGHT.important) // 60
    expect(w.SEMAINE_PREMIER).toBe(IMPORTANCE_TO_WEIGHT.normal) // 30
    expect(w.WE_PREMIER_ROLE).toBe(IMPORTANCE_TO_WEIGHT.normal) // 30 (25→30 assumé)
    expect(w.SEMAINE_SECOND).toBe(IMPORTANCE_TO_WEIGHT.peu_important) // 10
  })

  it('une règle écrase le défaut de SA dimension uniquement', () => {
    const w = buildEquityWeights([{ dimension: 'weekend', importance: 'peu_important' }])
    expect(w.WE_GARDE).toBe(IMPORTANCE_TO_WEIGHT.peu_important) // 10 (réglé)
    expect(w.FERIES).toBe(IMPORTANCE_TO_WEIGHT.important) // 60 (défaut intact)
  })

  it('extraireEquityRules ne garde que les règles equilibrer actives et valides', () => {
    const rows: RegleCabinetRow[] = [
      { id: '1', cabinet_id: 'c', periode_id: null, brique_id: 'equilibrer', actif: true,
        force: 'si_possible', params_json: { params: { dimension: 'weekend', importance: 'essentiel' } } },
      { id: '2', cabinet_id: 'c', periode_id: null, brique_id: 'equilibrer', actif: false, // inactive
        force: 'si_possible', params_json: { params: { dimension: 'ferie', importance: 'important' } } },
      { id: '3', cabinet_id: 'c', periode_id: null, brique_id: 'duo_interdit', actif: true, // autre famille
        force: 'jamais', params_json: { params: { avec_veterinaire_id: 'x' } } },
      { id: '4', cabinet_id: 'c', periode_id: null, brique_id: 'equilibrer', actif: true, // dimension inconnue
        force: 'si_possible', params_json: { params: { dimension: 'bidon', importance: 'normal' } } },
    ]
    const rules = extraireEquityRules(rows)
    expect(rules).toEqual([{ dimension: 'weekend', importance: 'essentiel' }])
  })
})

// ── E. Le tuyau : loader (règles equilibrer) → resoudreContexte ──
// Mock Supabase : regles_cabinet renvoie une règle equilibrer ; le loader doit
// en extraire les poids, et resoudreContexte propager equityWeights + effectif.

function dataFor(table: string): unknown {
  switch (table) {
    case 'periodes':
      return {
        id: 'p1', saison: 'hiver', date_debut: '2026-01-05',
        date_fin: '2026-02-01', statut: 'brouillon', nb_vetos_semaine_soir: 1,
      }
    case 'cabinets':
      return { zone_scolaire: 'A', region_feries: 'metropole' }
    case 'briques_regles':
      return [{ id: 'equilibrer' }]
    case 'regles_cabinet':
      // Une règle d'équité : week-ends → peu important (poids 10).
      return [{
        id: 'r1', cabinet_id: 'cab-1', periode_id: null, brique_id: 'equilibrer',
        actif: true, force: 'si_possible',
        params_json: { qui: null, quand: null, params: { dimension: 'weekend', importance: 'peu_important' } },
      }]
    case 'veterinaires':
    case 'conges':
    case 'vacances_scolaires':
    case 'jours_feries':
    default:
      return []
  }
}

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.eq = chain
  builder.lte = chain
  builder.gte = chain
  builder.lt = chain
  builder.or = chain
  builder.order = chain
  builder.limit = chain
  builder.single = () => Promise.resolve({ data: dataFor(table), error: null })
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null }) // pas de période précédente
  builder.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
    resolve({ data: dataFor(table), error: null })
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => makeBuilder(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
  })),
}))

import { chargerInputDepuisSupabase } from '@/engine/loader'
import { resoudreContexte } from '@/data/resoudreContexte'

describe('Équité réglable — E. le tuyau porte equityWeights + effectif', () => {
  beforeEach(() => vi.clearAllMocks())

  it('le loader extrait les poids des règles equilibrer (week-ends → 10)', async () => {
    const input = await chargerInputDepuisSupabase('p1', 'cab-1')
    expect(input.equityWeights?.WE_GARDE).toBe(IMPORTANCE_TO_WEIGHT.peu_important) // 10
    expect(input.equityWeights?.FERIES).toBe(IMPORTANCE_TO_WEIGHT.important) // 60 (défaut)
    expect(input.nbVetosSemaineSoir).toBe(1)
  })

  it('resoudreContexte PROPAGE les poids ET l’effectif (anti-régression bombe)', async () => {
    const contexte = await resoudreContexte('p1', 'cab-1')
    expect(contexte.equityWeights?.WE_GARDE).toBe(IMPORTANCE_TO_WEIGHT.peu_important) // 10
    expect(contexte.nbVetosSemaineSoir).toBe(1)
  })
})
