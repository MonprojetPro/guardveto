import { describe, it, expect } from 'vitest'
import { penalite, penaliteR10WEConsecutif, PENALITE } from '@/engine/rules/soft-constraints'
import type { SlotGarde, PlanningPartiel } from '@/engine/types'
import { JEAN, FANNY, VICTOR, MANON } from './scenarios/vets'

const planningVide: PlanningPartiel = { attributions: [] }

function slot(date: string, type: SlotGarde['type'], saison: SlotGarde['saison'] = 'hiver'): SlotGarde {
  return { date, type, saison }
}

// ── R10 : Pas 2 WE consécutifs ───────────────────────────

describe('R10 — Pas 2 WE de garde de suite', () => {
  // WE 1 : samedi 2026-05-02
  // WE 2 : samedi 2026-05-09
  // WE 3 : samedi 2026-05-16

  it('retourne 0 si pas de garde WE le week-end précédent', () => {
    const score = penaliteR10WEConsecutif(
      slot('2026-05-09', 'weekend'),
      JEAN,
      planningVide
    )
    expect(score).toBe(0)
  })

  it('retourne une pénalité forte si garde WE le week-end précédent', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        premier_id: JEAN.id, second_id: VICTOR.id,
      }],
    }
    const score = penaliteR10WEConsecutif(
      slot('2026-05-09', 'weekend'),
      JEAN,
      planning
    )
    expect(score).toBe(PENALITE.WE_CONSECUTIF)
    expect(score).toBeGreaterThan(0)
  })

  it('ne pénalise pas si Jean n\'était pas de garde le WE précédent', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        premier_id: FANNY.id, second_id: VICTOR.id,  // JEAN absent
      }],
    }
    const score = penaliteR10WEConsecutif(
      slot('2026-05-09', 'weekend'),
      JEAN,
      planning
    )
    expect(score).toBe(0)
  })

  it('pénalise aussi pour vendredi soir si garde WE précédent', () => {
    // Vendredi 2026-05-08 → associé au samedi 2026-05-09
    // WE précédent = samedi 2026-05-02
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        premier_id: JEAN.id, second_id: VICTOR.id,
      }],
    }
    const score = penaliteR10WEConsecutif(
      slot('2026-05-08', 'vendredi_soir'),
      JEAN,
      planning
    )
    expect(score).toBe(PENALITE.WE_CONSECUTIF)
  })

  it('ne pénalise pas un créneau de semaine (non WE)', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        premier_id: JEAN.id, second_id: VICTOR.id,
      }],
    }
    const score = penaliteR10WEConsecutif(
      slot('2026-05-05', 'semaine_soir'),
      JEAN,
      planning
    )
    expect(score).toBe(0)
  })

  it('pénalise si garde WE précédent était en tant que 2nd', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        premier_id: FANNY.id, second_id: JEAN.id,  // Jean = 2nd
      }],
    }
    const score = penaliteR10WEConsecutif(
      slot('2026-05-09', 'weekend'),
      JEAN,
      planning
    )
    expect(score).toBe(PENALITE.WE_CONSECUTIF)
  })
})

// ── penalite() — point d'entrée ──────────────────────────

describe('penalite() — agrégation', () => {
  it('retourne 0 sur planning vide', () => {
    expect(penalite(slot('2026-05-09', 'weekend'), JEAN, planningVide)).toBe(0)
  })

  it('retourne la pénalité R10 si applicable', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        premier_id: MANON.id, second_id: VICTOR.id,
      }],
    }
    expect(penalite(slot('2026-05-09', 'weekend'), MANON, planning)).toBe(PENALITE.WE_CONSECUTIF)
  })

  it('retourne 0 pour un créneau semaine sans contrainte souple', () => {
    expect(penalite(slot('2026-05-04', 'semaine_soir'), JEAN, planningVide)).toBe(0)
  })
})
