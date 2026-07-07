// ============================================================
// GUARDVETO — Composition d'équipe par tag (backlog n°6)
// ============================================================
// « Au moins un senior par week-end » / « un junior jamais seul » :
//   1. le MOTEUR honore les règles dures (aucun créneau ciblé sans senior,
//      jamais un créneau 100 % junior) ;
//   2. le VALIDATEUR INDÉPENDANT détecte une violation sur un planning
//      trafiqué (et se tait quand la règle est souple/désactivée) ;
//   3. les DEUX gardiens sont d'accord (planning généré → 0 violation) ;
//   4. le scoreur global pénalise les règles SOUPLES à l'étage configuré ;
//   5. le mapping DB (extraireCompositions) résout les lignes regles_cabinet ;
//   6. le pré-vol signale une règle dont AUCUN véto ne porte le tag.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { scorerPlanning } from '@/engine/score-lexicographique'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { vetsAttribues } from '@/engine/attribution'
import { DEFAULT_STRUCTURE_CONFIG, type StructureConfig, type CompositionEquipeRegle } from '@/engine/structure-config'
import { extraireCompositions, type RegleCabinetRow } from '@/data/mapReglesCabinet'
import { preVolRegles } from '@/engine/pre-vol'
import type { PlanningPartiel, VetEngine, VetEngineNormalise } from '@/engine/types'

// ── Fixtures : 6 vétos sans autre contrainte, 2 seniors + 4 juniors ──

function vet(num: number, prenom: string, tags: string[]): VetEngineNormalise {
  const v: VetEngine = {
    id: `00000000-0000-0000-0000-0000000000${10 + num}`,
    prenom, nom: 'Test',
    statut: 'associe', dernier_recours: false,
    tags,
    contraintes: [], conges: [],
  }
  return normaliserContraintesVets([v])[0]
}

const SENIOR_A = vet(1, 'Sara', ['senior'])
const SENIOR_B = vet(2, 'Simon', ['senior'])
const JUNIOR_C = vet(3, 'Chloe', ['junior'])
const JUNIOR_D = vet(4, 'Diego', ['junior'])
const JUNIOR_E = vet(5, 'Emma', ['junior'])
const JUNIOR_F = vet(6, 'Felix', ['junior'])
const EQUIPE = [SENIOR_A, SENIOR_B, JUNIOR_C, JUNIOR_D, JUNIOR_E, JUNIOR_F]

const SENIORS_IDS = new Set([SENIOR_A.id, SENIOR_B.id])

function regle(partiel: Partial<CompositionEquipeRegle> & Pick<CompositionEquipeRegle, 'mode' | 'tag'>): CompositionEquipeRegle {
  return { regleId: 'r-test', actif: true, etage: 2, ...partiel }
}

function structureAvec(...compositions: CompositionEquipeRegle[]): StructureConfig {
  return { ...DEFAULT_STRUCTURE_CONFIG, compositions }
}

// Période hiver courte (4 semaines) — hiver : 2 vétos par nuit de semaine.
const PERIODE = { dateDebut: '2026-01-05', dateFin: '2026-02-01', saison: 'hiver' as const }

// ── 1. Le moteur honore les règles DURES ─────────────────────

describe('composition_equipe — moteur (règles dures)', () => {
  it('au_moins_un senior sur les week-ends : chaque WE (et son vendredi lié) compte un senior', () => {
    const input: SolverInput = {
      ...PERIODE,
      vets: EQUIPE,
      bonusMalus: {},
      lnsTimeoutMs: 0,
      structureConfig: structureAvec(
        regle({ mode: 'au_moins_un', tag: 'senior', creneaux: ['weekend'] }),
      ),
    }
    const result = genererPlanningPur(input)
    expect(result.success).toBe(true)
    if (!result.success) return

    const wes = result.planning.attributions.filter((a) => a.type === 'weekend')
    expect(wes.length).toBeGreaterThan(0)
    for (const a of wes) {
      const equipe = vetsAttribues(a)
      expect(equipe.some((id) => SENIORS_IDS.has(id)), `WE du ${a.date} sans senior`).toBe(true)
    }
  }, 30_000)

  it('pas_seuls junior : aucun créneau tenu uniquement par des juniors', () => {
    const input: SolverInput = {
      ...PERIODE,
      vets: EQUIPE,
      bonusMalus: {},
      lnsTimeoutMs: 0,
      structureConfig: structureAvec(regle({ mode: 'pas_seuls', tag: 'junior' })),
    }
    const result = genererPlanningPur(input)
    expect(result.success).toBe(true)
    if (!result.success) return

    for (const a of result.planning.attributions) {
      const equipe = vetsAttribues(a)
      if (equipe.length === 0) continue
      const queDesJuniors = equipe.every((id) => !SENIORS_IDS.has(id))
      expect(queDesJuniors, `créneau ${a.type} du ${a.date} tenu uniquement par des juniors`).toBe(false)
    }
  }, 30_000)

  it('pas_seuls junior en ÉTÉ (1 place la nuit de semaine) : jamais un junior seul la nuit', () => {
    const input: SolverInput = {
      dateDebut: '2026-07-06', dateFin: '2026-08-02', saison: 'ete',
      vets: EQUIPE,
      bonusMalus: {},
      lnsTimeoutMs: 0,
      structureConfig: structureAvec(regle({ mode: 'pas_seuls', tag: 'junior', creneaux: ['semaine_soir'] })),
    }
    const result = genererPlanningPur(input)
    expect(result.success).toBe(true)
    if (!result.success) return

    const nuits = result.planning.attributions.filter((a) => a.type === 'semaine_soir')
    expect(nuits.length).toBeGreaterThan(0)
    for (const a of nuits) {
      for (const id of vetsAttribues(a)) {
        expect(SENIORS_IDS.has(id), `nuit du ${a.date} : junior seul`).toBe(true)
      }
    }
  }, 30_000)

  it('SOUPLE (étage 4) : ne bloque jamais, même insatisfiable (équipe 100 % junior)', () => {
    const queDesJuniors = [JUNIOR_C, JUNIOR_D, JUNIOR_E, JUNIOR_F]
    const input: SolverInput = {
      ...PERIODE,
      vets: queDesJuniors,
      bonusMalus: {},
      lnsTimeoutMs: 0,
      structureConfig: structureAvec(
        regle({ mode: 'au_moins_un', tag: 'senior', etage: 4 }),
      ),
    }
    const result = genererPlanningPur(input)
    expect(result.success).toBe(true) // une règle souple ne rend jamais infaisable
  }, 30_000)
})

// ── 2+3. Validateur indépendant + accord des deux gardiens ───

describe('composition_equipe — validateur indépendant', () => {
  /** Un WE trafiqué : deux juniors seuls (viole au_moins_un senior ET pas_seuls junior). */
  const planningTrafique: PlanningPartiel = {
    attributions: [{
      date: '2026-01-10', type: 'weekend',
      placements: [
        { role: 'premier', vetId: JUNIOR_C.id },
        { role: 'second', vetId: JUNIOR_D.id },
      ],
    }],
  }
  const inputValidation = { ...PERIODE, dateDebut: '2026-01-05', dateFin: '2026-01-11', vets: EQUIPE as VetEngine[] }

  it('détecte un WE sans senior (au_moins_un dur)', () => {
    const violations = validerPlanning(planningTrafique, {
      ...inputValidation,
      structureConfig: structureAvec(regle({ mode: 'au_moins_un', tag: 'senior', creneaux: ['weekend'] })),
    })
    const compo = violations.filter((v) => v.regle === 'COMPOSITION')
    expect(compo).toHaveLength(1)
    expect(compo[0].detail).toContain('senior')
  })

  it('détecte un créneau 100 % junior (pas_seuls dur)', () => {
    const violations = validerPlanning(planningTrafique, {
      ...inputValidation,
      structureConfig: structureAvec(regle({ mode: 'pas_seuls', tag: 'junior' })),
    })
    expect(violations.filter((v) => v.regle === 'COMPOSITION')).toHaveLength(1)
  })

  it('se tait quand la règle est SOUPLE (étage ≥ 3) ou INACTIVE', () => {
    const souple = validerPlanning(planningTrafique, {
      ...inputValidation,
      structureConfig: structureAvec(regle({ mode: 'au_moins_un', tag: 'senior', etage: 4 })),
    })
    expect(souple.filter((v) => v.regle === 'COMPOSITION')).toHaveLength(0)

    const inactive = validerPlanning(planningTrafique, {
      ...inputValidation,
      structureConfig: structureAvec(regle({ mode: 'au_moins_un', tag: 'senior', actif: false })),
    })
    expect(inactive.filter((v) => v.regle === 'COMPOSITION')).toHaveLength(0)
  })

  it('ACCORD des deux gardiens : le planning généré passe le validateur sans violation', () => {
    const structureConfig = structureAvec(
      regle({ mode: 'au_moins_un', tag: 'senior', creneaux: ['weekend'] }),
      regle({ mode: 'pas_seuls', tag: 'junior' }),
    )
    const result = genererPlanningPur({
      ...PERIODE, vets: EQUIPE, bonusMalus: {}, lnsTimeoutMs: 0, structureConfig,
    })
    expect(result.success).toBe(true)
    if (!result.success) return

    const violations = validerPlanning(result.planning, {
      ...PERIODE, vets: EQUIPE as VetEngine[], structureConfig,
    })
    expect(violations).toEqual([])
  }, 30_000)
})

// ── 4. Scoreur global — pénalité souple à l'étage configuré ──

describe('composition_equipe — scoreur global (souple)', () => {
  it('pénalise une équipe violante à l’étage configuré, silencieux sinon', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-01-10', type: 'weekend',
        placements: [
          { role: 'premier', vetId: JUNIOR_C.id },
          { role: 'second', vetId: JUNIOR_D.id },
        ],
      }],
    }
    const structure = structureAvec(regle({ mode: 'au_moins_un', tag: 'senior', etage: 4 }))
    const score = scorerPlanning(planning, EQUIPE, 'hiver', undefined, structure)
    const contribs = score.contributions.filter((c) => c.regle === 'composition-souple')
    expect(contribs).toHaveLength(1)
    expect(contribs[0].etage).toBe(4)

    // Équipe conforme (un senior présent) → aucune contribution.
    const conforme: PlanningPartiel = {
      attributions: [{
        date: '2026-01-10', type: 'weekend',
        placements: [
          { role: 'premier', vetId: SENIOR_A.id },
          { role: 'second', vetId: JUNIOR_D.id },
        ],
      }],
    }
    const score2 = scorerPlanning(conforme, EQUIPE, 'hiver', undefined, structure)
    expect(score2.contributions.filter((c) => c.regle === 'composition-souple')).toHaveLength(0)
  })
})

// ── 5. Mapping DB : extraireCompositions ─────────────────────

describe('composition_equipe — extraireCompositions (regles_cabinet → moteur)', () => {
  const ligne = (over: Partial<RegleCabinetRow>): RegleCabinetRow => ({
    id: 'r1', cabinet_id: 'cab', periode_id: null,
    brique_id: 'composition_equipe',
    params_json: { qui: null, quand: null, params: { mode: 'au_moins_un', tag: 'Senior', creneaux: ['weekend'] } },
    force: 'jamais', actif: true,
    ...over,
  })

  it('résout mode + tag (normalisé minuscules) + créneaux + étage', () => {
    const [r] = extraireCompositions([ligne({})])
    expect(r).toMatchObject({
      regleId: 'r1', mode: 'au_moins_un', tag: 'senior', creneaux: ['weekend'], actif: true, etage: 2,
    })
  })

  it('ignore les lignes mal formées (mode inconnu, tag vide) sans crash', () => {
    const mauvaises = [
      ligne({ id: 'x1', params_json: { params: { mode: 'exotique', tag: 'senior' } } }),
      ligne({ id: 'x2', params_json: { params: { mode: 'pas_seuls', tag: '  ' } } }),
      ligne({ id: 'x3', params_json: null }),
    ]
    expect(extraireCompositions(mauvaises)).toEqual([])
  })

  it('conserve les règles inactives (actif=false) pour l’UI, plusieurs lignes possibles', () => {
    const rows = [
      ligne({}),
      ligne({ id: 'r2', actif: false, params_json: { params: { mode: 'pas_seuls', tag: 'junior' } }, force: 'evitee' }),
    ]
    const out = extraireCompositions(rows)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ regleId: 'r2', mode: 'pas_seuls', tag: 'junior', actif: false, etage: 4 })
  })
})

// ── 6. Pré-vol : tag sans porteur ────────────────────────────

describe('composition_equipe — pré-vol (tag sans porteur)', () => {
  it('signale une règle au_moins_un dont AUCUN véto actif ne porte le tag', () => {
    const avertissements = preVolRegles({
      vets: [JUNIOR_C, JUNIOR_D, JUNIOR_E, JUNIOR_F],
      ...PERIODE,
      structureConfig: structureAvec(regle({ mode: 'au_moins_un', tag: 'senior' })),
    })
    const compo = avertissements.filter((a) => a.code === 'composition_sans_porteur')
    expect(compo).toHaveLength(1)
    expect(compo[0].message).toContain('senior')
  })

  it('reste silencieux quand un porteur du tag existe', () => {
    const avertissements = preVolRegles({
      vets: EQUIPE,
      ...PERIODE,
      structureConfig: structureAvec(regle({ mode: 'au_moins_un', tag: 'senior' })),
    })
    expect(avertissements.filter((a) => a.code === 'composition_sans_porteur')).toHaveLength(0)
  })
})
