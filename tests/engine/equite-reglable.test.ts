// ============================================================
// GUARDVETO — Équité réglable (curseurs) — tests bout-en-bout
// ============================================================
// Couvre les 4 maillons de la feature « poids d'équité configurables » :
//
//   A. Préservation : poids omis ≡ poids = DEFAULT_EQUITY_WEIGHTS
//      (aucun changement de planning tant qu'on ne touche pas aux curseurs).
//   B. Le scoreur global thread les poids (scorerPlanning).
//   C. Le solveur (seed greedy) thread les poids : un poids extrême change
//      réellement les décisions → la feature n'est PAS une coquille vide.
//   D. Le TUYAU (loader → resoudreContexte) porte equityWeights ET
//      nbVetosSemaineSoir jusqu'au solveur — garde anti-régression de la
//      « bombe » : resoudreContexte reconstruit l'objet à la main et
//      détruisait l'effectif (jamais transmis). Cf. ContexteSimulation.
//
// ⚠️ Déterminisme : le LNS est non déterministe (borné par le temps). Les
// tests A et C utilisent donc lnsTimeoutMs: 0 → le solveur retourne le SEED
// greedy pur (sans LNS), qui est 100 % déterministe.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import {
  scorerPlanning,
  empreinteTieBreak,
  Etage,
} from '@/engine/score-lexicographique'
import { DEFAULT_EQUITY_WEIGHTS, type EquityWeights } from '@/engine/equity-weights'
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

// Période courte (4 semaines, hiver) — lundi 2026-01-05 → dimanche 2026-02-01.
const BASE: SolverInput = {
  dateDebut: '2026-01-05',
  dateFin: '2026-02-01',
  saison: 'hiver',
  vets: vetsSimples(),
  bonusMalus: {},
  lnsTimeoutMs: 0, // → seed greedy pur, déterministe (pas de LNS)
}

// ── A. Préservation du comportement ──────────────────────────
describe('Équité réglable — A. préservation', () => {
  it('poids omis ≡ poids = DEFAULT_EQUITY_WEIGHTS (planning identique)', () => {
    const sansPoids = genererPlanningPur(BASE)
    const avecDefaut = genererPlanningPur({ ...BASE, equityWeights: DEFAULT_EQUITY_WEIGHTS })

    expect(sansPoids.success).toBe(true)
    expect(avecDefaut.success).toBe(true)
    if (sansPoids.success && avecDefaut.success) {
      expect(empreinteTieBreak(avecDefaut.planning)).toBe(
        empreinteTieBreak(sansPoids.planning),
      )
    }
  })
})

// ── B. Le scoreur global thread les poids ────────────────────
describe('Équité réglable — B. scorerPlanning thread les poids', () => {
  // Planning volontairement DÉSÉQUILIBRÉ en week-ends : v1 cumule les WE.
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

    // Même planning, même déséquilibre WE : un poids plus fort = coût plus élevé.
    expect(eqFort).toBeGreaterThan(eqFaible)
  })

  it('mettre un poids à 0 retire sa dimension du coût d’équité', () => {
    // Déséquilibre UNIQUEMENT sur les WE → si WE_GARDE=0 et que c'est la seule
    // dimension déséquilibrée, le coût d'équité doit tomber à 0.
    const sansWE: EquityWeights = {
      WE_GARDE: 0, WE_PREMIER_ROLE: 0, FERIES: 0,
      SEMAINE_PREMIER: 0, SEMAINE_SECOND: 0, GRANDS_WE: 0,
    }
    const eq = scorerPlanning(planningDeseq, vets, 'hiver', sansWE).etages[Etage.EQUITE]
    expect(eq).toBe(0)
  })
})

// ── C. Le solveur (seed greedy) thread les poids ─────────────
describe('Équité réglable — C. le solveur utilise les poids', () => {
  it('un profil de poids extrême change le planning produit (pas une coquille vide)', () => {
    const parDefaut = genererPlanningPur(BASE)
    // Profil inversé : on annule l'équité WE et on sur-pondère la semaine 2nd.
    const extreme: EquityWeights = {
      WE_GARDE: 0, WE_PREMIER_ROLE: 0, FERIES: 0,
      SEMAINE_PREMIER: 0, SEMAINE_SECOND: 1000, GRANDS_WE: 0,
    }
    const skew = genererPlanningPur({ ...BASE, equityWeights: extreme })

    expect(parDefaut.success).toBe(true)
    expect(skew.success).toBe(true)
    if (parDefaut.success && skew.success) {
      // Le moteur a pris des décisions différentes → les poids pilotent bien
      // le greedy de bout en bout (sinon les empreintes seraient identiques).
      expect(empreinteTieBreak(skew.planning)).not.toBe(
        empreinteTieBreak(parDefaut.planning),
      )
    }
  })

  it('un profil de poids personnalisé produit quand même un planning complet', () => {
    const extreme: EquityWeights = {
      WE_GARDE: 0, WE_PREMIER_ROLE: 0, FERIES: 0,
      SEMAINE_PREMIER: 0, SEMAINE_SECOND: 1000, GRANDS_WE: 0,
    }
    const res = genererPlanningPur({ ...BASE, equityWeights: extreme })
    expect(res.success).toBe(true)
  })
})

// ── D. Le tuyau porte les 2 champs (anti-régression « bombe ») ──
// Mock Supabase : le loader lit equite_cabinet + nb_vetos_semaine_soir, et
// resoudreContexte DOIT propager les deux jusqu'au ContexteSimulation.

const POIDS_CABINET = {
  we_garde: 7, we_premier_role: 7, feries: 7,
  semaine_premier: 7, semaine_second: 7, grands_we: 7,
}

function dataFor(table: string): unknown {
  switch (table) {
    case 'periodes':
      return {
        id: 'p1', saison: 'hiver', date_debut: '2026-01-05',
        date_fin: '2026-02-01', statut: 'brouillon',
        nb_vetos_semaine_soir: 1, // effectif configuré ≠ défaut hiver (2)
      }
    case 'cabinets':
      return { zone_scolaire: 'A', region_feries: 'metropole' }
    case 'equite_cabinet':
      return POIDS_CABINET
    case 'veterinaires':
    case 'briques_regles':
    case 'regles_cabinet':
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
  // maybeSingle : equite_cabinet → la config ; periodes (période précédente) → null.
  builder.maybeSingle = () =>
    Promise.resolve({
      data: table === 'equite_cabinet' ? dataFor(table) : null,
      error: null,
    })
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

const POIDS_ATTENDUS: EquityWeights = {
  WE_GARDE: 7, WE_PREMIER_ROLE: 7, FERIES: 7,
  SEMAINE_PREMIER: 7, SEMAINE_SECOND: 7, GRANDS_WE: 7,
}

describe('Équité réglable — D. le tuyau porte equityWeights + effectif', () => {
  beforeEach(() => vi.clearAllMocks())

  it('le loader expose les poids du cabinet et l’effectif', async () => {
    const input = await chargerInputDepuisSupabase('p1', 'cab-1')
    expect(input.equityWeights).toEqual(POIDS_ATTENDUS)
    expect(input.nbVetosSemaineSoir).toBe(1)
  })

  it('resoudreContexte PROPAGE les poids ET l’effectif (anti-régression bombe)', async () => {
    const contexte = await resoudreContexte('p1', 'cab-1')
    // Les deux champs DOIVENT survivre à la reconstruction de l'objet.
    expect(contexte.equityWeights).toEqual(POIDS_ATTENDUS)
    expect(contexte.nbVetosSemaineSoir).toBe(1)
  })
})
