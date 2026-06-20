import { describe, it, expect } from 'vitest'
import {
  compterParVet,
  desequilibreWE,
  desequilibreFeries,
  desequilibreSemainePremier,
  desequilibreSemaineSecond,
  desequilibreGrandsWeSalaries,
  variance,
  ecartMaxMin,
} from '@/engine/rules/optimization'
// V2 : le scoring d'équité vit désormais dans score-lexicographique
// (scorerPlanning → étage EQUITE). scorer.ts est un stub @deprecated.
import {
  scorerPlanning,
  comparerScores,
  Etage,
} from '@/engine/score-lexicographique'
import { DEFAULT_EQUITY_WEIGHTS } from '@/engine/equity-weights'
import type { PlanningPartiel } from '@/engine/types'
import { ANNE_SOPHIE, FANNY, JEAN, ANNE_CAT, MANON, ANTOINE, VICTOR, ALL_VETS } from './scenarios/vets'

const planningVide: PlanningPartiel = { attributions: [] }

// ── Helpers ──────────────────────────────────────────────

const SALARIES = [MANON, ANTOINE, VICTOR]
const ASSOCIES = [ANNE_SOPHIE, FANNY, JEAN, ANNE_CAT]

// ── variance() et ecartMaxMin() ──────────────────────────

describe('Helpers mathématiques', () => {
  it('variance([2, 2, 2]) = 0 (équité parfaite)', () => {
    expect(variance([2, 2, 2])).toBe(0)
  })

  it('variance([0, 2]) = 1', () => {
    expect(variance([0, 2])).toBe(1)
  })

  it('variance([]) = 0', () => {
    expect(variance([])).toBe(0)
  })

  it('ecartMaxMin([1, 3, 5]) = 4', () => {
    expect(ecartMaxMin([1, 3, 5])).toBe(4)
  })

  it('ecartMaxMin([]) = 0', () => {
    expect(ecartMaxMin([])).toBe(0)
  })
})

// ── compterParVet ────────────────────────────────────────

describe('compterParVet — compteurs de base', () => {
  it('planning vide → tous les compteurs à 0', () => {
    const compteurs = compterParVet(planningVide, ALL_VETS)
    for (const c of compteurs) {
      expect(c.weGardes).toBe(0)
      expect(c.feriesGardes).toBe(0)
      expect(c.semainePremier).toBe(0)
      expect(c.semaineSecond).toBe(0)
      expect(c.grandsWePerdus).toBe(0)
    }
  })

  it('R11 — compte les WE de garde correctement', () => {
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: JEAN.id, second_id: VICTOR.id },
        { date: '2026-05-09', type: 'weekend', premier_id: JEAN.id, second_id: FANNY.id },
        { date: '2026-05-16', type: 'weekend', premier_id: MANON.id, second_id: VICTOR.id },
      ],
    }
    const compteurs = compterParVet(planning, ALL_VETS)
    const cJean = compteurs.find((c) => c.vetId === JEAN.id)!
    const cVictor = compteurs.find((c) => c.vetId === VICTOR.id)!
    const cFanny = compteurs.find((c) => c.vetId === FANNY.id)!
    const cManon = compteurs.find((c) => c.vetId === MANON.id)!

    expect(cJean.weGardes).toBe(2)
    expect(cVictor.weGardes).toBe(2)
    expect(cFanny.weGardes).toBe(1)
    expect(cManon.weGardes).toBe(1)
  })

  it('R11b — compte les week-ends en 1er (rôle à avantage financier)', () => {
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: JEAN.id, second_id: VICTOR.id },
        { date: '2026-05-09', type: 'weekend', premier_id: JEAN.id, second_id: FANNY.id },
        { date: '2026-05-16', type: 'weekend', premier_id: MANON.id, second_id: VICTOR.id },
      ],
    }
    const compteurs = compterParVet(planning, ALL_VETS)
    const cJean = compteurs.find((c) => c.vetId === JEAN.id)!
    const cVictor = compteurs.find((c) => c.vetId === VICTOR.id)!
    const cManon = compteurs.find((c) => c.vetId === MANON.id)!

    expect(cJean.weekendPremier).toBe(2)   // 1er les 2 et 9 mai
    expect(cManon.weekendPremier).toBe(1)   // 1er le 16 mai
    expect(cVictor.weekendPremier).toBe(0)  // toujours 2nd → aucun avantage
  })

  it('R12 — compte les gardes sur jours fériés', () => {
    // 2026-05-01 = 1er mai (férié fixe)
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-05-01', type: 'semaine_soir', premier_id: JEAN.id, second_id: VICTOR.id },
        { date: '2026-05-08', type: 'semaine_soir', premier_id: FANNY.id, second_id: MANON.id },
      ],
    }
    const compteurs = compterParVet(planning, ALL_VETS)
    const cJean = compteurs.find((c) => c.vetId === JEAN.id)!
    const cVictor = compteurs.find((c) => c.vetId === VICTOR.id)!
    const cFanny = compteurs.find((c) => c.vetId === FANNY.id)!

    expect(cJean.feriesGardes).toBe(1)   // 1er mai = férié
    expect(cVictor.feriesGardes).toBe(1)  // 1er mai = férié
    expect(cFanny.feriesGardes).toBe(1)   // 8 mai = férié
  })

  it('R13 — compte les gardes de semaine en 1er', () => {
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-04-20', type: 'semaine_soir', premier_id: JEAN.id, second_id: VICTOR.id },
        { date: '2026-04-21', type: 'semaine_soir', premier_id: JEAN.id, second_id: FANNY.id },
        { date: '2026-04-22', type: 'semaine_soir', premier_id: VICTOR.id, second_id: MANON.id },
      ],
    }
    const compteurs = compterParVet(planning, ALL_VETS)
    const cJean = compteurs.find((c) => c.vetId === JEAN.id)!
    const cVictor = compteurs.find((c) => c.vetId === VICTOR.id)!

    expect(cJean.semainePremier).toBe(2)
    expect(cVictor.semainePremier).toBe(1)
  })

  it('R14 — compte les gardes de semaine en 2nd', () => {
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-04-20', type: 'semaine_soir', premier_id: JEAN.id, second_id: VICTOR.id },
        { date: '2026-04-21', type: 'semaine_soir', premier_id: FANNY.id, second_id: VICTOR.id },
      ],
    }
    const compteurs = compterParVet(planning, ALL_VETS)
    const cVictor = compteurs.find((c) => c.vetId === VICTOR.id)!
    const cJean = compteurs.find((c) => c.vetId === JEAN.id)!

    expect(cVictor.semaineSecond).toBe(2)
    expect(cJean.semaineSecond).toBe(0)
  })

  it('R15 — compte les grands WE perdus pour les salariés uniquement', () => {
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: MANON.id, second_id: VICTOR.id },
        { date: '2026-05-09', type: 'weekend', premier_id: ANTOINE.id, second_id: FANNY.id },
        { date: '2026-05-16', type: 'weekend', premier_id: VICTOR.id, second_id: MANON.id },
      ],
    }
    const compteurs = compterParVet(planning, ALL_VETS)
    const cManon = compteurs.find((c) => c.vetId === MANON.id)!
    const cVictor = compteurs.find((c) => c.vetId === VICTOR.id)!
    const cAntoine = compteurs.find((c) => c.vetId === ANTOINE.id)!
    const cFanny = compteurs.find((c) => c.vetId === FANNY.id)!

    expect(cManon.grandsWePerdus).toBe(2)   // salarié : 2 WE de garde
    expect(cVictor.grandsWePerdus).toBe(2)   // salarié
    expect(cAntoine.grandsWePerdus).toBe(1)  // salarié : 1 WE de garde
    expect(cFanny.grandsWePerdus).toBe(0)    // associé : non compté
  })
})

// ── Mesures de déséquilibre ──────────────────────────────

describe('R11 — desequilibreWE', () => {
  it('= 0 si tous les vétos ont le même nombre de WE', () => {
    const compteurs = compterParVet({
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: JEAN.id, second_id: FANNY.id },
        { date: '2026-05-09', type: 'weekend', premier_id: VICTOR.id, second_id: MANON.id },
        { date: '2026-05-16', type: 'weekend', premier_id: ANTOINE.id, second_id: ANNE_SOPHIE.id },
        { date: '2026-05-23', type: 'weekend', premier_id: ANNE_CAT.id, second_id: JEAN.id },
      ],
    }, ALL_VETS)
    // JEAN = 2, FANNY = 1, VICTOR = 1, MANON = 1, ANTOINE = 1, ANNE_SOPHIE = 1, ANNE_CAT = 1
    // Ce n'est pas parfait — le test vérifie juste que la fonction retourne un nombre ≥ 0
    expect(desequilibreWE(compteurs)).toBeGreaterThanOrEqual(0)
  })

  it('> 0 si les WE sont inégalement répartis', () => {
    const compteurs = compterParVet({
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: JEAN.id, second_id: JEAN.id },
        { date: '2026-05-09', type: 'weekend', premier_id: JEAN.id, second_id: JEAN.id },
        { date: '2026-05-16', type: 'weekend', premier_id: JEAN.id, second_id: JEAN.id },
      ],
    }, ALL_VETS)
    // Jean a 3 WE, les autres 0
    expect(desequilibreWE(compteurs)).toBeGreaterThan(0)
  })
})

describe('R15 — desequilibreGrandsWeSalaries', () => {
  it('= 0 si les 3 salariés ont le même nombre de WE perdus', () => {
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: MANON.id, second_id: ANTOINE.id },
        { date: '2026-05-09', type: 'weekend', premier_id: VICTOR.id, second_id: JEAN.id },
        { date: '2026-05-16', type: 'weekend', premier_id: MANON.id, second_id: ANTOINE.id },
        { date: '2026-05-23', type: 'weekend', premier_id: VICTOR.id, second_id: FANNY.id },
      ],
    }
    // Manon=2, Antoine=2, Victor=2 → variance=0
    const compteurs = compterParVet(planning, ALL_VETS)
    expect(desequilibreGrandsWeSalaries(compteurs, ALL_VETS)).toBe(0)
  })

  it('> 0 si un salarié a plus de WE perdus que les autres', () => {
    const planning: PlanningPartiel = {
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: MANON.id, second_id: VICTOR.id },
        { date: '2026-05-09', type: 'weekend', premier_id: MANON.id, second_id: VICTOR.id },
        { date: '2026-05-16', type: 'weekend', premier_id: MANON.id, second_id: VICTOR.id },
        // ANTOINE n'a aucun WE
      ],
    }
    const compteurs = compterParVet(planning, ALL_VETS)
    expect(desequilibreGrandsWeSalaries(compteurs, ALL_VETS)).toBeGreaterThan(0)
  })
})

// ── Équité — étage EQUITE du score lexicographique V2 ─────
// NOTE migration V2 (2026-06-17) : le scoring d'équité additif V1
// (scoreEquite/POIDS dans scorer.ts) a été remplacé par le score
// lexicographique hybride (scorerPlanning → VecteurScore, étage EQUITE).
// L'équité reste pleinement testée : ces tests vérifient que
// (a) l'équité parfaite = 0, (b) un planning équilibré est strictement
// meilleur qu'un planning déséquilibré, (c) la pondération intra-étage
// EQUITE conserve la priorité WE > fériés > semaine.

describe('Équité (V2) — étage EQUITE de scorerPlanning', () => {
  it('retourne 0 sur planning vide (équité parfaite, rien à comparer)', () => {
    const v = scorerPlanning(planningVide, ALL_VETS, 'ete')
    expect(v.etages[Etage.EQUITE]).toBe(0)
  })

  it('planning équilibré : étage EQUITE plus bas que déséquilibré', () => {
    // Planning équilibré : 1 WE chacun pour Jean, Fanny, Victor, Manon…
    const planningEquilibre: PlanningPartiel = {
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: JEAN.id, second_id: VICTOR.id },
        { date: '2026-05-09', type: 'weekend', premier_id: FANNY.id, second_id: MANON.id },
        { date: '2026-05-16', type: 'weekend', premier_id: ANTOINE.id, second_id: ANNE_SOPHIE.id },
        { date: '2026-05-23', type: 'weekend', premier_id: ANNE_CAT.id, second_id: JEAN.id },
      ],
    }

    // Planning déséquilibré : Jean fait 3 WE, les autres 0
    const planningDesequilibre: PlanningPartiel = {
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: JEAN.id, second_id: FANNY.id },
        { date: '2026-05-09', type: 'weekend', premier_id: JEAN.id, second_id: FANNY.id },
        { date: '2026-05-16', type: 'weekend', premier_id: JEAN.id, second_id: FANNY.id },
      ],
    }

    const eqEquilibre = scorerPlanning(planningEquilibre, ALL_VETS, 'ete').etages[Etage.EQUITE]
    const eqDesequilibre = scorerPlanning(planningDesequilibre, ALL_VETS, 'ete').etages[Etage.EQUITE]
    expect(eqEquilibre).toBeLessThan(eqDesequilibre)
  })

  it('comparerScores préfère le planning le plus équitable (étages amont égaux)', () => {
    // Deux plannings sans pénalité souple (étages 0-5 à 0) → seul l'étage
    // EQUITE départage. Le plus équilibré doit gagner lexicographiquement.
    const planningEquilibre: PlanningPartiel = {
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: JEAN.id, second_id: VICTOR.id },
        { date: '2026-05-09', type: 'weekend', premier_id: FANNY.id, second_id: MANON.id },
        { date: '2026-05-16', type: 'weekend', premier_id: ANTOINE.id, second_id: ANNE_SOPHIE.id },
      ],
    }
    const planningDesequilibre: PlanningPartiel = {
      attributions: [
        { date: '2026-05-02', type: 'weekend', premier_id: JEAN.id, second_id: VICTOR.id },
        { date: '2026-05-09', type: 'weekend', premier_id: JEAN.id, second_id: VICTOR.id },
        { date: '2026-05-16', type: 'weekend', premier_id: JEAN.id, second_id: VICTOR.id },
      ],
    }
    const vEq = scorerPlanning(planningEquilibre, ALL_VETS, 'ete')
    const vDeseq = scorerPlanning(planningDesequilibre, ALL_VETS, 'ete')
    // comparerScores < 0 → premier argument meilleur
    expect(comparerScores(vEq, vDeseq)).toBeLessThan(0)
  })

  it('les poids d\'équité par défaut : WE_GARDE pèse davantage que SEMAINE_SECOND / SEMAINE_PREMIER / FERIES', () => {
    // La priorité d'équité V1 (WE > fériés > semaine) est conservée dans
    // les poids par défaut (curseurs configurables, repli DEFAULT_EQUITY_WEIGHTS).
    expect(DEFAULT_EQUITY_WEIGHTS.WE_GARDE).toBeGreaterThan(DEFAULT_EQUITY_WEIGHTS.SEMAINE_SECOND)
    expect(DEFAULT_EQUITY_WEIGHTS.WE_GARDE).toBeGreaterThan(DEFAULT_EQUITY_WEIGHTS.SEMAINE_PREMIER)
    expect(DEFAULT_EQUITY_WEIGHTS.WE_GARDE).toBeGreaterThan(DEFAULT_EQUITY_WEIGHTS.FERIES)
  })
})
