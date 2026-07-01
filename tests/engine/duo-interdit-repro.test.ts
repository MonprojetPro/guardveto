// ============================================================
// REPRO — Bug duo_interdit : Antoine + Manon seul binôme de WE
// ============================================================
// Reproduit le bug observé en prod (été 2026) : un planning généré
// place Antoine + Manon comme SEUL binôme de week-end. La règle
// duo_interdit est DURE : ces deux vétos ne doivent JAMAIS être
// l'unique binôme d'une garde (week-end inclus, premier+second).
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { isValid } from '@/engine/rules/hard-constraints'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { premierId, secondId } from '@/engine/attribution'
import type { PlanningPartiel, SlotGarde, VetEngine, VetEngineNormalise } from '@/engine/types'
import { ALL_VETS, MANON, ANTOINE } from './scenarios/vets'

/** Normalise un véto de test (hisse params) → type exigé par isValid. */
function n(v: VetEngine): VetEngineNormalise {
  return normaliserContraintesVets([v])[0]
}

/**
 * MANON avec un duo_interdit AU FORMAT BRIQUE V2 (post-migration prod).
 * Le champ `avec_veterinaire_id` est imbriqué dans `params`, pas au top-level.
 * C'est la forme RÉELLE en base après 20260616170001_migrate_contraintes.sql.
 */
const MANON_V2: VetEngineNormalise = n({
  ...MANON,
  contraintes: [
    {
      id: 'c5', type: 'jour_repos_conditionnel', actif: true,
      config: { si_garde_we: 'jeudi', sinon: 'vendredi' },
    },
    {
      id: 'c6-v2', type: 'duo_interdit', actif: true,
      config: {
        brique: 'duo_interdit',
        axes: {},
        force: 2,
        params: { avec_veterinaire_id: ANTOINE.id, description: 'Manon + Antoine' },
      },
    },
  ],
})

const ANTOINE_V2: VetEngineNormalise = n({
  ...ANTOINE,
  contraintes: [
    {
      id: 'c7', type: 'jour_repos_conditionnel', actif: true,
      config: { si_garde_we: 'jeudi', sinon: 'vendredi' },
    },
    {
      id: 'c8-v2', type: 'duo_interdit', actif: true,
      config: {
        brique: 'duo_interdit',
        axes: {},
        force: 2,
        params: { avec_veterinaire_id: MANON.id, description: 'Antoine + Manon' },
      },
    },
  ],
})

function slotWE(date: string): SlotGarde {
  return { date, type: 'weekend', saison: 'ete' }
}

/**
 * ANNE-SOPHIE avec indisponibilité cyclique ANCRÉE (semaines impaires depuis
 * une ancre tombant un MARDI — exactement le cas qui cassait la parité
 * intra-semaine). Indispo soir_semaine + weekend les semaines IMPAIRES.
 */
const ANNE_SOPHIE_ANCREE: VetEngineNormalise = n({
  ...ALL_VETS[0], // ANNE_SOPHIE
  contraintes: [
    {
      id: 'c1-ancre', type: 'indisponibilite_cyclique', actif: true,
      config: {
        semaines: 'impaires',
        periodes: ['soir_semaine', 'weekend'],
        ancre: '2026-09-01', // mardi — déclencheur du bug intra-semaine
      },
    },
  ],
})

/** Vrai si l'attribution est le duo exact {Manon, Antoine} (peu importe le rôle). */
function estDuoManonAntoine(premierId: string | null, secondId: string | null): boolean {
  const pair = new Set([premierId, secondId])
  return pair.has(MANON.id) && pair.has(ANTOINE.id)
}

describe('REPRO — duo_interdit config V2 (avec_veterinaire_id dans params)', () => {
  it('REFUSE Antoine en 2nd quand Manon est 1ère, avec config brique V2', () => {
    // C'est le scénario PROD : config V2 (force:2, params.avec_veterinaire_id).
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-07-25', type: 'weekend',
        placements: [{ role: 'premier', vetId: MANON_V2.id }, { role: 'second', vetId: null }],
      }],
    }
    const vets = [...ALL_VETS.filter((v) => v.id !== MANON.id && v.id !== ANTOINE.id), MANON_V2, ANTOINE_V2]
    const result = isValid(slotWE('2026-07-25'), ANTOINE_V2, 'second', vets, planning)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R6/)
  })

  it('REFUSE Manon en 2nd quand Antoine est 1er, avec config brique V2', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-08-15', type: 'weekend',
        placements: [{ role: 'premier', vetId: ANTOINE_V2.id }, { role: 'second', vetId: null }],
      }],
    }
    const vets = [...ALL_VETS.filter((v) => v.id !== MANON.id && v.id !== ANTOINE.id), MANON_V2, ANTOINE_V2]
    const result = isValid(slotWE('2026-08-15'), MANON_V2, 'second', vets, planning)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R6/)
  })
})

describe('R2 — Anne-Sophie : parité ancrée STABLE sur toute la semaine', () => {
  // Le calendrier passé à isValid contient les vacances pour les recalages
  // (ici vide → comptage simple depuis l'ancre normalisée au lundi).
  const calendrier = { feries: new Set<string>(), vacancesScolaires: [] }

  it('même verdict (indispo/dispo) pour tous les soirs de semaine d\'une même semaine', () => {
    // Semaine du lundi 2026-09-07 → semaine 1 depuis l'ancre (impaire) → INDISPO partout.
    const jours = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'] // lun..jeu
    const verdicts = jours.map(
      (d) =>
        isValid(
          { date: d, type: 'semaine_soir', saison: 'hiver' },
          ANNE_SOPHIE_ANCREE,
          'premier',
          ALL_VETS,
          { attributions: [] },
          calendrier
        ).valid
    )
    // Tous identiques (pas de bascule intra-semaine)
    expect(new Set(verdicts).size).toBe(1)
    // Et conformes à la règle : semaine impaire → indisponible
    expect(verdicts.every((v) => v === false)).toBe(true)
  })

  it('le WE (samedi) et les soirs de la même semaine ont le MÊME verdict', () => {
    // Semaine du lundi 2026-09-07 (impaire) : soir jeudi ET samedi → tous INDISPO.
    const soirJeudi = isValid(
      { date: '2026-09-10', type: 'semaine_soir', saison: 'hiver' },
      ANNE_SOPHIE_ANCREE, 'premier', ALL_VETS, { attributions: [] }, calendrier
    ).valid
    const we = isValid(
      { date: '2026-09-12', type: 'weekend', saison: 'hiver' },
      ANNE_SOPHIE_ANCREE, 'premier', ALL_VETS, { attributions: [] }, calendrier
    ).valid
    expect(soirJeudi).toBe(we)
    expect(soirJeudi).toBe(false) // semaine impaire → indispo
  })

  it('semaine paire (du lundi 2026-09-14) → Anne-Sophie disponible', () => {
    // Semaine 1+1 = 2 depuis ancre → paire → DISPONIBLE.
    const we = isValid(
      { date: '2026-09-19', type: 'weekend', saison: 'hiver' },
      ANNE_SOPHIE_ANCREE, 'premier', ALL_VETS, { attributions: [] }, calendrier
    ).valid
    expect(we).toBe(true)
  })
})

describe('REPRO — duo_interdit Antoine + Manon (binôme WE)', () => {
  it('ne place JAMAIS Antoine + Manon comme unique binôme de week-end (été)', () => {
    // Période d'été 12 semaines incluant les samedis observés en prod
    // (2026-07-25 et 2026-08-15). Lundi de départ : 2026-07-06.
    const input: SolverInput = {
      dateDebut: '2026-07-06',
      dateFin: '2026-09-27',
      saison: 'ete',
      vets: ALL_VETS,
      bonusMalus: {},
      lnsTimeoutMs: 1_000,
    }

    const result = genererPlanningPur(input)
    expect(result.success).toBe(true)
    if (!result.success) return

    const duosInterdits = result.planning.attributions.filter(
      (a) =>
        (a.type === 'weekend' || a.type === 'vendredi_soir') &&
        estDuoManonAntoine(premierId(a), secondId(a))
    )

    expect(duosInterdits).toEqual([])
  }, 15_000)

  it('ne place JAMAIS Antoine + Manon comme unique binôme de garde de semaine (hiver, 2 de garde)', () => {
    // En hiver les soirs de semaine ont 1er + 2nd → risque de duo seuls.
    const input: SolverInput = {
      dateDebut: '2026-01-05',
      dateFin: '2026-03-29',
      saison: 'hiver',
      vets: ALL_VETS,
      bonusMalus: {},
      lnsTimeoutMs: 1_000,
    }

    const result = genererPlanningPur(input)
    expect(result.success).toBe(true)
    if (!result.success) return

    const duosInterdits = result.planning.attributions.filter((a) =>
      estDuoManonAntoine(premierId(a), secondId(a))
    )

    expect(duosInterdits).toEqual([])
  }, 15_000)
})
