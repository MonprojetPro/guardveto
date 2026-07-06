// ============================================================
// GUARDVETO — RG tranche 2 : relations génériques entre créneaux (moteur)
// ============================================================
// R8/R9 ne sont plus câblées sur le couple vendredi_soir↔weekend : le moteur
// consomme des relations EN DONNÉE (structure.relations, repli couple
// historique). Preuves par FAITS DIRECTS :
//   A. l'appariement des occurrences (même jour, adjacence, fenêtre, capture) ;
//   B. les checks durs appliquent une relation CUSTOM entre codes sur-mesure ;
//   C. relations = [] → le couple historique n'est PLUS appliqué (découplage
//      réel) ; relations custom → le couple historique n'est plus appliqué non
//      plus (la donnée fait foi) ;
//   D. le scoreur pénalise une relation custom réglée SOUPLE ;
//   E. resoudreRelationsStructure filtre (inactif, repos_apres, code null) ;
//   F. bout-en-bout : le solveur produit la MÊME équipe sur deux créneaux
//      sur-mesure liés par meme_binome.
// (Le byte-identique du défaut est déjà gardé par p3b-sur-mesure.test.ts et
// structure-r8r9.test.ts, qui traversent désormais le chemin générique.)
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { validerPlanning, type ValidationInput } from '@/engine/validation/validerPlanning'
import {
  isValid, checkR8Inversion, checkR9VendrediLieWE,
} from '@/engine/rules/hard-constraints'
import { scorerPlanning, Etage } from '@/engine/score-lexicographique'
import {
  apparierSourcePourCible, apparierCiblePourSource, resoudreRelationsStructure,
} from '@/engine/relations-structure'
import type { RelationStructure, StructureConfig } from '@/engine/structure-config'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { vetsAttribues } from '@/engine/attribution'
import type {
  VetEngine, VetEngineNormalise, SlotGarde, PlanningPartiel, AttributionGarde,
} from '@/engine/types'
import type { CreneauModele, RelationCreneau } from '@/engine/creneau-modele'

// ── Fixtures ─────────────────────────────────────────────

const mkVet = (id: string): VetEngineNormalise => normaliserContraintesVets([{
  id, prenom: id, nom: id.toUpperCase(), statut: 'associe', dernier_recours: false,
  contraintes: [], conges: [],
} as VetEngine])[0]
const A = mkVet('A'), B = mkVet('B'), C = mkVet('C'), D = mkVet('D')
const ALL = [A, B, C, D]

const attr = (date: string, type: string, ...vetIds: (string | null)[]): AttributionGarde => ({
  date,
  type,
  placements: vetIds.map((vetId, i) => ({ role: i === 0 ? 'premier' : i === 1 ? 'second' : `p${i}`, vetId })),
})

// Relation custom : « garde du matin » liée à la « garde du soir ».
const REL_MEME: RelationStructure = { sourceCode: 'sm_matin', cibleCode: 'sm_soir', genre: 'meme_binome' }
const REL_INV: RelationStructure = { sourceCode: 'sm_matin', cibleCode: 'sm_soir', genre: 'inversion_role' }

// ── A. Appariement des occurrences ───────────────────────

describe('appariement — même jour, adjacence, fenêtre, capture', () => {
  it('même jour : matin et soir du MÊME jour sont appariés (deux gardes/jour)', () => {
    const p: PlanningPartiel = { attributions: [attr('2026-01-06', 'sm_matin', 'A', 'B')] }
    expect(apparierSourcePourCible(p, REL_MEME, '2026-01-06')?.date).toBe('2026-01-06')
    expect(apparierCiblePourSource({ attributions: [attr('2026-01-06', 'sm_soir', 'A', 'B')] }, REL_MEME, '2026-01-06')?.date).toBe('2026-01-06')
  })

  it('adjacence : la source appariée est la PLUS PROCHE en arrière', () => {
    const p: PlanningPartiel = {
      attributions: [attr('2026-01-05', 'sm_matin', 'A', 'B'), attr('2026-01-07', 'sm_matin', 'C', 'D')],
    }
    expect(apparierSourcePourCible(p, REL_MEME, '2026-01-08')?.date).toBe('2026-01-07')
  })

  it('fenêtre : une source à plus de 7 jours n’est PAS appariée', () => {
    const p: PlanningPartiel = { attributions: [attr('2026-01-05', 'sm_matin', 'A', 'B')] }
    expect(apparierSourcePourCible(p, REL_MEME, '2026-01-13')).toBeUndefined()
  })

  it('capture : une occurrence CIBLE plus proche capture la source (pas nous)', () => {
    // matin lun 05 … soir mar 06 … soir mer 07 : le soir du 07 ne doit PAS
    // être apparié au matin du 05 — le soir du 06 (plus proche du matin) l'est.
    const p: PlanningPartiel = {
      attributions: [attr('2026-01-05', 'sm_matin', 'A', 'B'), attr('2026-01-06', 'sm_soir', 'A', 'B')],
    }
    expect(apparierSourcePourCible(p, REL_MEME, '2026-01-07')).toBeUndefined()
  })

  it('couple historique : depuis un samedi, la source appariée est LE vendredi J-1', () => {
    const relHisto: RelationStructure = { sourceCode: 'vendredi_soir', cibleCode: 'weekend', genre: 'meme_binome' }
    const p: PlanningPartiel = { attributions: [attr('2026-01-09', 'vendredi_soir', 'A', 'B')] }
    expect(apparierSourcePourCible(p, relHisto, '2026-01-10')?.date).toBe('2026-01-09')
  })
})

// ── B. Checks durs sur une relation CUSTOM ───────────────

const ferme = { actif: true, etage: 2 }
const planningMatinAB: PlanningPartiel = { attributions: [attr('2026-01-06', 'sm_matin', 'A', 'B')] }
const slotSoir: SlotGarde = { date: '2026-01-06', type: 'sm_soir', saison: 'hiver', besoinSecond: true }

describe('checks durs — relation custom sm_matin → sm_soir', () => {
  it('meme_binome : C (hors équipe du matin) refusé sur le soir lié', () => {
    const r = checkR9VendrediLieWE(C, slotSoir, planningMatinAB, ferme, [REL_MEME])
    expect(r.valid).toBe(false)
    expect(r.raison).toContain('R9')
    expect(r.raison).toContain('sm_matin')
  })

  it('meme_binome : A (dans l’équipe du matin) accepté sur le soir lié', () => {
    expect(checkR9VendrediLieWE(A, slotSoir, planningMatinAB, ferme, [REL_MEME]).valid).toBe(true)
  })

  it('meme_binome sens source : planifier le matin avec un véto hors équipe du soir déjà posé → refusé', () => {
    const pSoir: PlanningPartiel = { attributions: [attr('2026-01-06', 'sm_soir', 'A', 'B')] }
    const slotMatin: SlotGarde = { date: '2026-01-06', type: 'sm_matin', saison: 'hiver', besoinSecond: true }
    expect(checkR9VendrediLieWE(C, slotMatin, pSoir, ferme, [REL_MEME]).valid).toBe(false)
    expect(checkR9VendrediLieWE(B, slotMatin, pSoir, ferme, [REL_MEME]).valid).toBe(true)
  })

  it('inversion_role : A (1er le matin) refusé 1er sur le soir lié, accepté 2nd', () => {
    const rMemeRole = checkR8Inversion(A, slotSoir, 'premier', planningMatinAB, ferme, [REL_INV])
    expect(rMemeRole.valid).toBe(false)
    expect(rMemeRole.raison).toContain('R8')
    expect(checkR8Inversion(A, slotSoir, 'second', planningMatinAB, ferme, [REL_INV]).valid).toBe(true)
  })

  it('sans occurrence source dans la fenêtre → aucune contrainte', () => {
    const slotSoirLoin: SlotGarde = { date: '2026-01-20', type: 'sm_soir', saison: 'hiver', besoinSecond: true }
    expect(checkR9VendrediLieWE(C, slotSoirLoin, planningMatinAB, ferme, [REL_MEME]).valid).toBe(true)
  })
})

// ── C. La DONNÉE fait foi : le couple historique n'est plus câblé ──

describe('isValid — les relations en donnée remplacent le couple historique', () => {
  const SAM = '2026-01-10'
  const planningVenAB: PlanningPartiel = { attributions: [attr('2026-01-09', 'vendredi_soir', 'A', 'B')] }
  const slotWe: SlotGarde = { date: SAM, type: 'weekend', saison: 'hiver', besoinSecond: true }

  it('relations ABSENTES (undefined) → repli couple historique : C refusé au WE', () => {
    expect(isValid(slotWe, C, 'premier', ALL, planningVenAB).valid).toBe(false)
  })

  it('relations = [] (cabinet sans relation) → découplage réel : C accepté au WE', () => {
    const cfg: StructureConfig = {
      r9_liaison: ferme, r8_inversion: ferme, relations: [],
    }
    expect(isValid(slotWe, C, 'premier', ALL, planningVenAB, undefined, cfg).valid).toBe(true)
  })

  it('relations custom UNIQUEMENT → le couple vendredi↔WE n’est plus appliqué', () => {
    const cfg: StructureConfig = {
      r9_liaison: ferme, r8_inversion: ferme, relations: [REL_MEME, REL_INV],
    }
    expect(isValid(slotWe, C, 'premier', ALL, planningVenAB, undefined, cfg).valid).toBe(true)
  })
})

// ── D. Scoreur : relation custom réglée SOUPLE ────────────

describe('scorerPlanning — relation custom souple = pénalité au bon étage', () => {
  // Matin {A,B} / soir {C,D} : équipe différente sur les créneaux liés.
  const planningDecouple: PlanningPartiel = {
    attributions: [attr('2026-01-06', 'sm_matin', 'A', 'B'), attr('2026-01-06', 'sm_soir', 'C', 'D')],
  }

  it('meme_binome souple (étage 3) violée → pénalité SAUF_CRISE, 0 invariant', () => {
    const cfg: StructureConfig = {
      r9_liaison: { actif: true, etage: 3 },
      r8_inversion: { actif: false, etage: 2 },
      relations: [REL_MEME],
    }
    const v = scorerPlanning(planningDecouple, ALL, 'hiver', undefined, cfg)
    expect(v.etages[Etage.SAUF_CRISE]).toBeGreaterThan(0)
    expect(v.contributions.some((c) => c.regle === 'R9-souple')).toBe(true)
  })

  it('équipes identiques → aucune pénalité', () => {
    const pOk: PlanningPartiel = {
      attributions: [attr('2026-01-06', 'sm_matin', 'A', 'B'), attr('2026-01-06', 'sm_soir', 'B', 'A')],
    }
    const cfg: StructureConfig = {
      r9_liaison: { actif: true, etage: 3 },
      r8_inversion: { actif: false, etage: 2 },
      relations: [REL_MEME],
    }
    const v = scorerPlanning(pOk, ALL, 'hiver', undefined, cfg)
    expect(v.contributions.some((c) => c.regle === 'R9-souple')).toBe(false)
  })
})

// ── E. resoudreRelationsStructure (résolution ids → codes) ──

describe('resoudreRelationsStructure — mapping + filtres', () => {
  const creneau = (id: string, code: string | null): CreneauModele => ({
    id, code, nom: id, joursSemaine: [1], surFeries: false, heureDebut: '08:00',
    heureFin: '18:00', offsetJoursFin: 0, nbPlaces: 2, roles: ['premier', 'second'],
    actif: true, ordre: 1,
  })
  const creneaux = [creneau('c1', 'sm_matin'), creneau('c2', 'sm_soir'), creneau('c3', null)]
  const rel = (over: Partial<RelationCreneau>): RelationCreneau => ({
    id: 'r', sourceId: 'c1', cibleId: 'c2', genre: 'meme_binome', actif: true, ...over,
  })

  it('résout les ids en codes', () => {
    expect(resoudreRelationsStructure([rel({})], creneaux)).toEqual([
      { sourceCode: 'sm_matin', cibleCode: 'sm_soir', genre: 'meme_binome' },
    ])
  })

  it('filtre : inactive, repos_apres (non consommé), créneau sans code, id inconnu', () => {
    expect(resoudreRelationsStructure([
      rel({ actif: false }),
      rel({ genre: 'repos_apres' }),
      rel({ cibleId: 'c3' }), // code null → jamais planifié
      rel({ sourceId: 'zz' }), // créneau introuvable
    ], creneaux)).toEqual([])
  })
})

// ── F. Bout-en-bout : le solveur respecte une relation custom ──

describe('bout-en-bout — meme_binome sur deux créneaux sur-mesure (mar → mer)', () => {
  const creneau = (partiel: Partial<CreneauModele> & { id: string }): CreneauModele => ({
    code: null, nom: partiel.id, joursSemaine: [], surFeries: false,
    heureDebut: '18:30', heureFin: '08:30', offsetJoursFin: 1, nbPlaces: 2,
    roles: ['premier', 'second'], actif: true, ordre: 1, ...partiel,
  })
  const catalogue: CreneauModele[] = [
    creneau({ id: 'ss', code: 'semaine_soir', joursSemaine: [1, 2, 3, 4], ordre: 1 }),
    creneau({ id: 'vs', code: 'vendredi_soir', joursSemaine: [5], ordre: 2 }),
    creneau({ id: 'we', code: 'weekend', joursSemaine: [6], offsetJoursFin: 2, ordre: 3 }),
    creneau({ id: 'ma', code: 'sm_matin', joursSemaine: [2], heureDebut: '08:30', heureFin: '18:30', offsetJoursFin: 0, ordre: 5 }),
    creneau({ id: 'so', code: 'sm_soir', joursSemaine: [3], heureDebut: '08:30', heureFin: '18:30', offsetJoursFin: 0, ordre: 6 }),
  ]
  const vets: VetEngine[] = Array.from({ length: 6 }, (_, i) => ({
    id: `v${i + 1}`, nom: `N${i + 1}`, prenom: `P${i + 1}`, statut: 'associe',
    dernier_recours: false, contraintes: [], conges: [],
  }))
  // La DONNÉE : couple historique CONSERVÉ + relation custom mar→mer.
  const input: SolverInput = {
    dateDebut: '2026-01-05', dateFin: '2026-02-01', saison: 'hiver',
    vets, bonusMalus: {}, creneaux: catalogue,
    structureConfig: {
      r9_liaison: ferme,
      r8_inversion: ferme,
      relations: [
        { sourceCode: 'vendredi_soir', cibleCode: 'weekend', genre: 'meme_binome' },
        { sourceCode: 'vendredi_soir', cibleCode: 'weekend', genre: 'inversion_role' },
        { sourceCode: 'sm_matin', cibleCode: 'sm_soir', genre: 'meme_binome' },
      ],
    },
  }
  const result = genererPlanningPur(input)

  it('le solveur réussit', () => {
    expect(result.success).toBe(true)
  })

  it('chaque mercredi (sm_soir) porte la MÊME équipe que le mardi (sm_matin) lié', () => {
    if (!result.success) return
    const soirs = result.planning.attributions.filter((a) => a.type === 'sm_soir')
    expect(soirs.length).toBeGreaterThan(0)
    for (const soir of soirs) {
      const matin = result.planning.attributions.find(
        (a) => a.type === 'sm_matin' && a.date < soir.date && a.date >= '2026-01-05',
      )
      const matinsAvant = result.planning.attributions
        .filter((a) => a.type === 'sm_matin' && a.date < soir.date)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
      const matinLie = matinsAvant[0] ?? matin
      expect(matinLie).toBeDefined()
      expect(vetsAttribues(soir).sort()).toEqual(vetsAttribues(matinLie!).sort())
    }
  })

  it('le couple historique vendredi↔WE reste respecté (relations conservées)', () => {
    if (!result.success) return
    for (const we of result.planning.attributions.filter((a) => a.type === 'weekend')) {
      const ven = result.planning.attributions.find(
        (a) => a.type === 'vendredi_soir' && a.date < we.date,
      )
      const vensAvant = result.planning.attributions
        .filter((a) => a.type === 'vendredi_soir' && a.date < we.date)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
      const venLie = vensAvant[0] ?? ven
      expect(venLie).toBeDefined()
      expect(vetsAttribues(we).sort()).toEqual(vetsAttribues(venLie!).sort())
    }
  })

  // ── Tranche 3 : le VALIDATEUR INDÉPENDANT voit les mêmes relations ──
  it('validateur : le planning généré ne porte AUCUNE violation (les deux gardiens d’accord)', () => {
    if (!result.success) return
    const vInput: ValidationInput = {
      dateDebut: '2026-01-05', dateFin: '2026-02-01', saison: 'hiver',
      vets, creneaux: catalogue, structureConfig: input.structureConfig,
    }
    expect(validerPlanning(result.planning, vInput)).toEqual([])
  })

  it('validateur : casser l’équipe d’un sm_soir → violation R9 DÉTECTÉE sur le type custom', () => {
    if (!result.success) return
    const soir = result.planning.attributions.find((a) => a.type === 'sm_soir')!
    const intrus = vets.find((v) => !vetsAttribues(soir).includes(v.id))!
    const casse = {
      attributions: result.planning.attributions.map((a) =>
        a === soir
          ? { ...a, placements: [{ role: 'premier', vetId: intrus.id }, a.placements[1]] }
          : a,
      ),
    }
    const vInput: ValidationInput = {
      dateDebut: '2026-01-05', dateFin: '2026-02-01', saison: 'hiver',
      vets, creneaux: catalogue, structureConfig: input.structureConfig,
    }
    const violations = validerPlanning(casse, vInput)
    expect(violations.some((v) => v.regle === 'R9' && v.type === 'sm_soir')).toBe(true)
  })
})

// ── G. Validateur indépendant — la donnée fait foi (anti-fantôme) ──

describe('validerPlanning — relations génériques (tranche 3)', () => {
  const ferme2 = { actif: true, etage: 2 }
  // Vendredi {A,B} / week-end {C,D} : couple historique violé SI appliqué.
  const planningDecouple: PlanningPartiel = {
    attributions: [
      attr('2026-01-09', 'vendredi_soir', 'A', 'B'),
      attr('2026-01-10', 'weekend', 'C', 'D'),
    ],
  }
  const base: ValidationInput = {
    dateDebut: '2026-01-09', dateFin: '2026-01-11', saison: 'hiver',
    vets: ALL,
  }

  it('relations ABSENTES (undefined) → repli couple historique : R9 signalée', () => {
    expect(validerPlanning(planningDecouple, base).some((v) => v.regle === 'R9')).toBe(true)
  })

  it('relations = [] → découplage réel : AUCUNE violation R8/R9 (pas de fantôme)', () => {
    const v = validerPlanning(planningDecouple, {
      ...base,
      structureConfig: { r9_liaison: ferme2, r8_inversion: ferme2, relations: [] },
    })
    expect(v.some((x) => x.regle === 'R9' || x.regle === 'R8')).toBe(false)
  })

  it('relation custom violée → R9 signalée sur les types custom, pas sur le couple historique', () => {
    // Matin {A,B} / soir {C,D} le même jour, liés meme_binome.
    const p: PlanningPartiel = {
      attributions: [attr('2026-01-06', 'sm_matin', 'A', 'B'), attr('2026-01-06', 'sm_soir', 'C', 'D')],
    }
    const v = validerPlanning(p, {
      ...base,
      dateDebut: '2026-01-06', dateFin: '2026-01-06',
      structureConfig: { r9_liaison: ferme2, r8_inversion: ferme2, relations: [REL_MEME] },
    })
    const r9 = v.filter((x) => x.regle === 'R9')
    expect(r9).toHaveLength(1)
    expect(r9[0].type).toBe('sm_soir')
    expect(r9[0].detail).toContain('sm_matin')
  })

  it('relation custom inversion_role : rôle conservé → R8 signalée avec le véto fautif', () => {
    const p: PlanningPartiel = {
      attributions: [attr('2026-01-06', 'sm_matin', 'A', 'B'), attr('2026-01-06', 'sm_soir', 'A', 'C')],
    }
    const v = validerPlanning(p, {
      ...base,
      dateDebut: '2026-01-06', dateFin: '2026-01-06',
      structureConfig: { r9_liaison: { actif: false, etage: 2 }, r8_inversion: ferme2, relations: [REL_INV] },
    })
    const r8 = v.filter((x) => x.regle === 'R8')
    expect(r8).toHaveLength(1)
    expect(r8[0].vetId).toBe('A') // A garde le rôle premier du matin au soir
    expect(r8[0].type).toBe('sm_soir')
  })

  it('réglage souple → le validateur se tait aussi sur les relations custom', () => {
    const p: PlanningPartiel = {
      attributions: [attr('2026-01-06', 'sm_matin', 'A', 'B'), attr('2026-01-06', 'sm_soir', 'C', 'D')],
    }
    const v = validerPlanning(p, {
      ...base,
      dateDebut: '2026-01-06', dateFin: '2026-01-06',
      structureConfig: { r9_liaison: { actif: true, etage: 4 }, r8_inversion: ferme2, relations: [REL_MEME] },
    })
    expect(v.some((x) => x.regle === 'R9')).toBe(false)
  })
})
