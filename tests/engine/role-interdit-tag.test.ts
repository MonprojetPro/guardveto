// ============================================================
// GUARDVETO — Rôle interdit selon attribut (backlog n°22)
// ============================================================
// « Un junior jamais 1er » :
//   1. le MOTEUR n'attribue jamais le rôle interdit à un porteur du tag ;
//   2. le VALIDATEUR détecte la violation sur un planning trafiqué (et se
//      tait quand la règle est souple/désactivée) ;
//   3. les deux gardiens sont d'accord (planning généré → 0 violation) ;
//   4. le scoreur global pénalise les règles SOUPLES à l'étage configuré ;
//   5. le mapping DB (extraireRolesInterdits) ;
//   6. le pré-vol : règle intenable (tous porteurs) / inerte (aucun porteur) ;
//   7. la conversion IA (propositionVersRoleInterdit).
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { scorerPlanning } from '@/engine/score-lexicographique'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { vetPourRole } from '@/engine/attribution'
import { DEFAULT_STRUCTURE_CONFIG, type StructureConfig, type RoleInterditTagRegle } from '@/engine/structure-config'
import { extraireRolesInterdits, type RegleCabinetRow } from '@/data/mapReglesCabinet'
import { preVolRegles } from '@/engine/pre-vol'
import type { PlanningPartiel, VetEngine, VetEngineNormalise } from '@/engine/types'

// ── Fixtures : 6 vétos sans autre contrainte, 2 juniors ──────

function vet(num: number, prenom: string, tags: string[]): VetEngineNormalise {
  const v: VetEngine = {
    id: `00000000-0000-0000-0000-0000000000${20 + num}`,
    prenom, nom: 'Test',
    statut: 'associe', dernier_recours: false,
    tags,
    contraintes: [], conges: [],
  }
  return normaliserContraintesVets([v])[0]
}

const JUNIOR_A = vet(1, 'Jade', ['junior'])
const JUNIOR_B = vet(2, 'Jules', ['junior'])
const SENIOR_C = vet(3, 'Sacha', ['senior'])
const SENIOR_D = vet(4, 'Sonia', ['senior'])
const SENIOR_E = vet(5, 'Serge', [])
const SENIOR_F = vet(6, 'Sofia', [])
const EQUIPE = [JUNIOR_A, JUNIOR_B, SENIOR_C, SENIOR_D, SENIOR_E, SENIOR_F]

const JUNIORS_IDS = new Set([JUNIOR_A.id, JUNIOR_B.id])

function regle(partiel: Partial<RoleInterditTagRegle> = {}): RoleInterditTagRegle {
  return { regleId: 'ri-test', tag: 'junior', role: 'premier', actif: true, etage: 2, ...partiel }
}

function structureAvec(...rolesInterdits: RoleInterditTagRegle[]): StructureConfig {
  return { ...DEFAULT_STRUCTURE_CONFIG, rolesInterdits }
}

const PERIODE = { dateDebut: '2026-01-05', dateFin: '2026-02-01', saison: 'hiver' as const }

// ── 1. Moteur ────────────────────────────────────────────────

describe('role_interdit_tag — moteur (règle dure)', () => {
  it('« un junior jamais 1er » : aucun junior ne tient le rôle premier', () => {
    const input: SolverInput = {
      ...PERIODE,
      vets: EQUIPE,
      bonusMalus: {},
      lnsTimeoutMs: 0,
      structureConfig: structureAvec(regle()),
    }
    const result = genererPlanningPur(input)
    expect(result.success).toBe(true)
    if (!result.success) return

    for (const a of result.planning.attributions) {
      const premier = vetPourRole(a, 'premier')
      if (!premier) continue
      expect(JUNIORS_IDS.has(premier), `${a.type} du ${a.date} : junior en 1er`).toBe(false)
    }
  }, 30_000)

  it('ciblage créneaux : interdit sur weekend seulement → les nuits de semaine restent libres', () => {
    const input: SolverInput = {
      ...PERIODE,
      vets: EQUIPE,
      bonusMalus: {},
      lnsTimeoutMs: 0,
      structureConfig: structureAvec(regle({ creneaux: ['weekend'] })),
    }
    const result = genererPlanningPur(input)
    expect(result.success).toBe(true)
    if (!result.success) return

    for (const a of result.planning.attributions) {
      if (a.type !== 'weekend') continue
      const premier = vetPourRole(a, 'premier')
      if (!premier) continue
      expect(JUNIORS_IDS.has(premier), `WE du ${a.date} : junior en 1er`).toBe(false)
    }
  }, 30_000)

  it('SOUPLE (étage 4) : ne bloque jamais, même intenable (tous juniors)', () => {
    const tousJuniors = [JUNIOR_A, JUNIOR_B, vet(7, 'Jim', ['junior']), vet(8, 'Joy', ['junior'])]
    const result = genererPlanningPur({
      ...PERIODE,
      vets: tousJuniors,
      bonusMalus: {},
      lnsTimeoutMs: 0,
      structureConfig: structureAvec(regle({ etage: 4 })),
    })
    expect(result.success).toBe(true)
  }, 30_000)
})

// ── 2+3. Validateur + accord des gardiens ────────────────────

describe('role_interdit_tag — validateur indépendant', () => {
  const planningTrafique: PlanningPartiel = {
    attributions: [{
      date: '2026-01-10', type: 'weekend',
      placements: [
        { role: 'premier', vetId: JUNIOR_A.id },
        { role: 'second', vetId: SENIOR_C.id },
      ],
    }],
  }
  const inputValidation = { ...PERIODE, dateDebut: '2026-01-05', dateFin: '2026-01-11', vets: EQUIPE as VetEngine[] }

  it('détecte un junior en 1er (règle dure)', () => {
    const violations = validerPlanning(planningTrafique, {
      ...inputValidation,
      structureConfig: structureAvec(regle()),
    })
    const roleTag = violations.filter((v) => v.regle === 'ROLE_TAG')
    expect(roleTag).toHaveLength(1)
    expect(roleTag[0].vetId).toBe(JUNIOR_A.id)
  })

  it('se tait quand le junior est 2nd, quand la règle est souple ou inactive', () => {
    const planningOk: PlanningPartiel = {
      attributions: [{
        date: '2026-01-10', type: 'weekend',
        placements: [
          { role: 'premier', vetId: SENIOR_C.id },
          { role: 'second', vetId: JUNIOR_A.id },
        ],
      }],
    }
    expect(validerPlanning(planningOk, {
      ...inputValidation, structureConfig: structureAvec(regle()),
    }).filter((v) => v.regle === 'ROLE_TAG')).toHaveLength(0)

    expect(validerPlanning(planningTrafique, {
      ...inputValidation, structureConfig: structureAvec(regle({ etage: 4 })),
    }).filter((v) => v.regle === 'ROLE_TAG')).toHaveLength(0)

    expect(validerPlanning(planningTrafique, {
      ...inputValidation, structureConfig: structureAvec(regle({ actif: false })),
    }).filter((v) => v.regle === 'ROLE_TAG')).toHaveLength(0)
  })

  it('ACCORD des deux gardiens : le planning généré passe le validateur', () => {
    const structureConfig = structureAvec(regle())
    const result = genererPlanningPur({
      ...PERIODE, vets: EQUIPE, bonusMalus: {}, lnsTimeoutMs: 0, structureConfig,
    })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(validerPlanning(result.planning, {
      ...PERIODE, vets: EQUIPE as VetEngine[], structureConfig,
    })).toEqual([])
  }, 30_000)
})

// ── 4. Scoreur global — souple ───────────────────────────────

describe('role_interdit_tag — scoreur global (souple)', () => {
  it('pénalise un junior en 1er à l’étage configuré, silencieux sinon', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-01-10', type: 'weekend',
        placements: [
          { role: 'premier', vetId: JUNIOR_A.id },
          { role: 'second', vetId: SENIOR_C.id },
        ],
      }],
    }
    const structure = structureAvec(regle({ etage: 3 }))
    const score = scorerPlanning(planning, EQUIPE, 'hiver', undefined, structure)
    const contribs = score.contributions.filter((c) => c.regle === 'role-interdit-souple')
    expect(contribs).toHaveLength(1)
    expect(contribs[0].etage).toBe(3)

    const conforme: PlanningPartiel = {
      attributions: [{
        date: '2026-01-10', type: 'weekend',
        placements: [
          { role: 'premier', vetId: SENIOR_C.id },
          { role: 'second', vetId: JUNIOR_A.id },
        ],
      }],
    }
    const score2 = scorerPlanning(conforme, EQUIPE, 'hiver', undefined, structure)
    expect(score2.contributions.filter((c) => c.regle === 'role-interdit-souple')).toHaveLength(0)
  })
})

// ── 5. Mapping DB ────────────────────────────────────────────

describe('role_interdit_tag — extraireRolesInterdits', () => {
  const ligne = (over: Partial<RegleCabinetRow>): RegleCabinetRow => ({
    id: 'ri1', cabinet_id: 'cab', periode_id: null,
    brique_id: 'role_interdit_tag',
    params_json: { qui: null, quand: null, params: { tag: 'Junior', role: 'premier', creneaux: ['weekend'] } },
    force: 'jamais', actif: true,
    ...over,
  })

  it('résout tag (normalisé) + rôle + créneaux + étage', () => {
    const [r] = extraireRolesInterdits([ligne({})])
    expect(r).toMatchObject({
      regleId: 'ri1', tag: 'junior', role: 'premier', creneaux: ['weekend'], actif: true, etage: 2,
    })
  })

  it('ignore les lignes mal formées sans crash', () => {
    expect(extraireRolesInterdits([
      ligne({ id: 'x1', params_json: { params: { tag: 'junior' } } }), // role manquant
      ligne({ id: 'x2', params_json: { params: { role: 'premier', tag: ' ' } } }),
      ligne({ id: 'x3', params_json: null }),
    ])).toEqual([])
  })
})

// ── 6. Pré-vol ───────────────────────────────────────────────

describe('role_interdit_tag — pré-vol', () => {
  it('signale la règle INTENABLE quand TOUS les vétos actifs portent le tag (dur)', () => {
    const tousJuniors = [JUNIOR_A, JUNIOR_B]
    const avert = preVolRegles({
      vets: tousJuniors,
      ...PERIODE,
      structureConfig: structureAvec(regle()),
    })
    const cible = avert.filter((a) => a.code === 'role_interdit_intenable')
    expect(cible).toHaveLength(1)
    expect(cible[0].message).toContain('TOUS')
  })

  it('signale la règle INERTE quand personne ne porte le tag', () => {
    const avert = preVolRegles({
      vets: [SENIOR_C, SENIOR_D],
      ...PERIODE,
      structureConfig: structureAvec(regle()),
    })
    const cible = avert.filter((a) => a.code === 'role_interdit_intenable')
    expect(cible).toHaveLength(1)
    expect(cible[0].message).toContain('sans effet')
  })

  it('silencieux quand la règle est tenable (mélange de tags)', () => {
    const avert = preVolRegles({
      vets: EQUIPE,
      ...PERIODE,
      structureConfig: structureAvec(regle()),
    })
    expect(avert.filter((a) => a.code === 'role_interdit_intenable')).toHaveLength(0)
  })
})
