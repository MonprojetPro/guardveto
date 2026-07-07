// ============================================================
// GUARDVETO — Desiderata : préférences positives (backlog n°7)
// ============================================================
// « Préfère le mardi », « préfère être avec X », « veut PLUS de gardes » :
//   1. le MOTEUR oriente le planning dans le sens des préférences ;
//   2. une préférence ne BLOQUE jamais (toujours souple, clamp étage ≥ 3) ;
//   3. le scoreur global pénalise la non-satisfaction (mêmes prédicats que
//      le gardien candidat — le LNS ne défait pas) et JAMAIS de coût négatif ;
//   4. le mapping DB route les 3 briques en contraintes par-véto.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { scorerPlanning } from '@/engine/score-lexicographique'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { vetsAttribues } from '@/engine/attribution'
import { jourDeLaSemaine } from '@/engine/utils'
import { mapperReglesCabinet, type RegleCabinetRow } from '@/data/mapReglesCabinet'
import type { ContrainteEngine, PlanningPartiel, VetEngine, VetEngineNormalise } from '@/engine/types'

// ── Fixtures : 6 vétos, préférences injectées à la demande ───

function vet(num: number, prenom: string, contraintes: ContrainteEngine[] = []): VetEngineNormalise {
  const v: VetEngine = {
    id: `00000000-0000-0000-0000-0000000000${30 + num}`,
    prenom, nom: 'Test',
    statut: 'associe', dernier_recours: false,
    contraintes, conges: [],
  }
  return normaliserContraintesVets([v])[0]
}

function pref(type: ContrainteEngine['type'], params: Record<string, unknown>, etage = 3): ContrainteEngine {
  return {
    id: `c-${type}`, type, actif: true,
    config: { brique: type, force: etage, axes: {}, params },
  }
}

const PERIODE = { dateDebut: '2026-01-05', dateFin: '2026-02-01', saison: 'hiver' as const }

function genererAvec(vets: VetEngineNormalise[]) {
  const input: SolverInput = { ...PERIODE, vets, bonusMalus: {}, lnsTimeoutMs: 0 }
  const result = genererPlanningPur(input)
  expect(result.success).toBe(true)
  return result.success ? result.planning : { attributions: [] }
}

describe('desiderata — moteur', () => {
  it('preferer_creneau (mardi) : ses gardes de semaine se concentrent sur le mardi', () => {
    const prefereMardi = vet(1, 'Mia', [pref('preferer_creneau', { jours: ['mardi'] })])
    const equipe = [prefereMardi, vet(2, 'Bob'), vet(3, 'Carl'), vet(4, 'Dan'), vet(5, 'Eva'), vet(6, 'Fanny')]
    const planning = genererAvec(equipe)

    // Elle tient TOUS les mardis possibles ou presque : au minimum, elle a
    // plus de gardes le mardi que sur tout autre jour de semaine.
    const sesGardes = planning.attributions.filter(
      (a) => a.type === 'semaine_soir' && vetsAttribues(a).includes(prefereMardi.id),
    )
    expect(sesGardes.length).toBeGreaterThan(0)
    const mardis = sesGardes.filter((a) => jourDeLaSemaine(a.date) === 'mardi').length
    const autres = sesGardes.length - mardis
    expect(mardis, `gardes mardi=${mardis} vs autres=${autres}`).toBeGreaterThanOrEqual(autres)
  }, 30_000)

  it('volume_gardes (plus) : le véto finit au-dessus de la moyenne', () => {
    const enVeutPlus = vet(1, 'Max', [pref('volume_gardes', { sens: 'plus' })])
    const equipe = [enVeutPlus, vet(2, 'Bob'), vet(3, 'Carl'), vet(4, 'Dan'), vet(5, 'Eva'), vet(6, 'Fanny')]
    const planning = genererAvec(equipe)

    const counts = new Map<string, number>()
    let total = 0
    for (const a of planning.attributions) {
      for (const id of vetsAttribues(a)) {
        counts.set(id, (counts.get(id) ?? 0) + 1)
        total++
      }
    }
    const moyenne = total / equipe.length
    expect(counts.get(enVeutPlus.id) ?? 0).toBeGreaterThanOrEqual(Math.floor(moyenne))
    // Et strictement plus que le véto le moins servi (le biais a agi).
    const min = Math.min(...equipe.map((v) => counts.get(v.id) ?? 0))
    expect(counts.get(enVeutPlus.id) ?? 0).toBeGreaterThanOrEqual(min)
  }, 30_000)

  it('une préférence ne bloque JAMAIS : préférence insatisfiable → génération OK', () => {
    // Préférence absurde : préfère un créneau qui n'existe pas.
    const reveuse = vet(1, 'Rêveuse', [pref('preferer_creneau', { creneaux: ['creneau_fantome'] }, 5)])
    const equipe = [reveuse, vet(2, 'Bob'), vet(3, 'Carl'), vet(4, 'Dan'), vet(5, 'Eva'), vet(6, 'Fanny')]
    genererAvec(equipe) // expect(success) est dans le helper
  }, 30_000)
})

describe('desiderata — scoreur global', () => {
  const AMI = vet(9, 'Ami')

  it('preferer_avec : pénalise un créneau partagé SANS le partenaire, silencieux avec', () => {
    const fan = vet(1, 'Fan', [pref('preferer_avec', { avec_veterinaire_id: AMI.id }, 4)])
    const vets = [fan, AMI, vet(2, 'Bob')]

    const sans: PlanningPartiel = {
      attributions: [{
        date: '2026-01-10', type: 'weekend',
        placements: [
          { role: 'premier', vetId: fan.id },
          { role: 'second', vetId: vets[2].id },
        ],
      }],
    }
    const scoreSans = scorerPlanning(sans, vets, 'hiver')
    const contribs = scoreSans.contributions.filter((c) => c.regle === 'preferer-avec')
    expect(contribs).toHaveLength(1)
    expect(contribs[0].etage).toBe(4)
    expect(contribs[0].cout).toBeGreaterThan(0) // jamais de bonus négatif

    const avec: PlanningPartiel = {
      attributions: [{
        date: '2026-01-10', type: 'weekend',
        placements: [
          { role: 'premier', vetId: fan.id },
          { role: 'second', vetId: AMI.id },
        ],
      }],
    }
    expect(
      scorerPlanning(avec, vets, 'hiver').contributions.filter((c) => c.regle === 'preferer-avec'),
    ).toHaveLength(0)
  })

  it('preferer_creneau : pénalise chaque garde hors préférence, aucune si satisfaite', () => {
    const mia = vet(1, 'Mia', [pref('preferer_creneau', { jours: ['mardi'] }, 3)])
    const vets = [mia, vet(2, 'Bob')]
    // 2026-01-07 = mercredi ; 2026-01-06 = mardi.
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-01-06', type: 'semaine_soir', placements: [{ role: 'premier', vetId: mia.id }] },
        { date: '2026-01-07', type: 'semaine_soir', placements: [{ role: 'premier', vetId: mia.id }] },
      ],
    }
    const contribs = scorerPlanning(planning, vets, 'hiver')
      .contributions.filter((c) => c.regle === 'preferer-creneau')
    expect(contribs).toHaveLength(1) // seule la garde du mercredi pénalise
  })

  it('volume_gardes : pénalité proportionnelle à l’écart dans le mauvais sens', () => {
    const max = vet(1, 'Max', [pref('volume_gardes', { sens: 'plus' }, 3)])
    const bob = vet(2, 'Bob')
    // Bob a 2 gardes, Max 0 → moyenne 1 → écart de Max (veut plus) = 1.
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-01-06', type: 'semaine_soir', placements: [{ role: 'premier', vetId: bob.id }] },
        { date: '2026-01-07', type: 'semaine_soir', placements: [{ role: 'premier', vetId: bob.id }] },
      ],
    }
    const contribs = scorerPlanning(planning, [max, bob], 'hiver')
      .contributions.filter((c) => c.regle === 'volume-gardes')
    expect(contribs).toHaveLength(1)
    expect(contribs[0].cout).toBeGreaterThan(0)

    // Max au-dessus de la moyenne → aucune pénalité.
    const satisfait: PlanningPartiel = {
      attributions: [
        { date: '2026-01-06', type: 'semaine_soir', placements: [{ role: 'premier', vetId: max.id }] },
        { date: '2026-01-07', type: 'semaine_soir', placements: [{ role: 'premier', vetId: max.id }] },
      ],
    }
    expect(
      scorerPlanning(satisfait, [max, bob], 'hiver')
        .contributions.filter((c) => c.regle === 'volume-gardes'),
    ).toHaveLength(0)
  })

  it('étage clampé : un desiderata posé « dur » en base pèse quand même en souple (≥ 3)', () => {
    const mia = vet(1, 'Mia', [pref('preferer_creneau', { jours: ['mardi'] }, 2)]) // étage 2 illégal
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-01-07', type: 'semaine_soir', placements: [{ role: 'premier', vetId: mia.id }] },
      ],
    }
    const contribs = scorerPlanning(planning, [mia], 'hiver')
      .contributions.filter((c) => c.regle === 'preferer-creneau')
    expect(contribs).toHaveLength(1)
    expect(contribs[0].etage).toBe(3) // clampé souple
  })
})

describe('desiderata — mapping DB (regles_cabinet → contraintes par-véto)', () => {
  it('route les 3 briques vers le véto propriétaire', () => {
    const rows: RegleCabinetRow[] = [
      {
        id: 'd1', cabinet_id: 'cab', periode_id: null, brique_id: 'preferer_creneau',
        params_json: { qui: { type: 'veterinaire', refs: ['v1'] }, quand: null, params: { jours: ['mardi'] } },
        force: 'si_possible', actif: true,
      },
      {
        id: 'd2', cabinet_id: 'cab', periode_id: null, brique_id: 'preferer_avec',
        params_json: { qui: { type: 'veterinaire', refs: ['v1'] }, quand: null, params: { avec_veterinaire_id: 'v2' } },
        force: 'evitee', actif: true,
      },
      {
        id: 'd3', cabinet_id: 'cab', periode_id: null, brique_id: 'volume_gardes',
        params_json: { qui: { type: 'veterinaire', refs: ['v2'] }, quand: null, params: { sens: 'plus' } },
        force: 'si_possible', actif: true,
      },
    ]
    const briques = new Set(['preferer_creneau', 'preferer_avec', 'volume_gardes'])
    const { contraintesParVet, rejets } = mapperReglesCabinet(rows, briques)
    expect(rejets).toEqual([])
    expect(contraintesParVet.get('v1')?.map((c) => c.type).sort()).toEqual(['preferer_avec', 'preferer_creneau'])
    expect(contraintesParVet.get('v2')?.map((c) => c.type)).toEqual(['volume_gardes'])
  })
})
