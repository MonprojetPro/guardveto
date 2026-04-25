import { describe, it, expect } from 'vitest'
import {
  penalite,
  penaliteR10WEConsecutif,
  penaliteFeteFinAnnee,
  penaliteInversionFerie,
  PENALITE,
} from '@/engine/rules/soft-constraints'
import type { SlotGarde, PlanningPartiel } from '@/engine/types'
import { JEAN, FANNY, VICTOR, MANON } from './scenarios/vets'

const planningVide: PlanningPartiel = { attributions: [] }

function slot(date: string, type: SlotGarde['type'], saison: SlotGarde['saison'] = 'hiver'): SlotGarde {
  return { date, type, saison }
}

// ── R10 : Pas 2 WE consécutifs ───────────────────────────

describe('R10 — Pas 2 WE de garde de suite', () => {
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
        premier_id: FANNY.id, second_id: VICTOR.id,
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
        premier_id: FANNY.id, second_id: JEAN.id,
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

// ── R10b : Fêtes de fin d'année ──────────────────────────

describe('R10b — Pénalité soirs de réveillon (24 déc, 31 déc)', () => {
  it('pénalise le 24 décembre (réveillon Noël)', () => {
    expect(penaliteFeteFinAnnee(slot('2026-12-24', 'semaine_soir'))).toBe(PENALITE.FETE_FIN_ANNEE)
  })

  it('pénalise le 31 décembre (réveillon Jour de l\'An)', () => {
    expect(penaliteFeteFinAnnee(slot('2026-12-31', 'semaine_soir'))).toBe(PENALITE.FETE_FIN_ANNEE)
  })

  it('ne pénalise pas le 25 décembre (férié géré par équité)', () => {
    expect(penaliteFeteFinAnnee(slot('2026-12-25', 'semaine_soir'))).toBe(0)
  })

  it('ne pénalise pas le 1er janvier (férié géré par équité)', () => {
    expect(penaliteFeteFinAnnee(slot('2027-01-01', 'semaine_soir'))).toBe(0)
  })

  it('ne pénalise pas un jour ordinaire de décembre', () => {
    expect(penaliteFeteFinAnnee(slot('2026-12-23', 'semaine_soir'))).toBe(0)
  })

  it('ne s\'applique pas aux créneaux WE', () => {
    expect(penaliteFeteFinAnnee(slot('2026-12-24', 'weekend'))).toBe(0)
    expect(penaliteFeteFinAnnee(slot('2026-12-24', 'vendredi_soir'))).toBe(0)
  })
})

// ── R8b : Inversion 1er/2nd sur fériés ──────────────────

describe('R8b — Inversion rôle sur jours fériés (§7, si possible)', () => {
  // Ascension 2026 = jeudi 14 mai. La garde de veille = mercredi 13 mai.

  it('pénalise si Jean était 1er la veille et est candidat 1er sur férié', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-13', type: 'semaine_soir',
        premier_id: JEAN.id, second_id: VICTOR.id,
      }],
    }
    const score = penaliteInversionFerie(
      slot('2026-05-14', 'semaine_soir'), // Ascension
      JEAN, 'premier', planning
    )
    expect(score).toBe(PENALITE.INVERSION_FERIE)
  })

  it('ne pénalise pas si Jean était 1er la veille et est candidat 2nd sur férié', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-13', type: 'semaine_soir',
        premier_id: JEAN.id, second_id: VICTOR.id,
      }],
    }
    const score = penaliteInversionFerie(
      slot('2026-05-14', 'semaine_soir'),
      JEAN, 'second', planning
    )
    expect(score).toBe(0)
  })

  it('pénalise si Fanny était 2nd la veille et est candidate 2nd sur férié', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-13', type: 'semaine_soir',
        premier_id: JEAN.id, second_id: FANNY.id,
      }],
    }
    const score = penaliteInversionFerie(
      slot('2026-05-14', 'semaine_soir'),
      FANNY, 'second', planning
    )
    expect(score).toBe(PENALITE.INVERSION_FERIE)
  })

  it('retourne 0 si pas de garde la veille', () => {
    const score = penaliteInversionFerie(
      slot('2026-05-14', 'semaine_soir'),
      JEAN, 'premier', planningVide
    )
    expect(score).toBe(0)
  })

  it('ne s\'applique pas sur un jour non férié', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-11', type: 'semaine_soir',
        premier_id: JEAN.id, second_id: VICTOR.id,
      }],
    }
    // 12 mai 2026 = mardi ordinaire
    const score = penaliteInversionFerie(
      slot('2026-05-12', 'semaine_soir'),
      JEAN, 'premier', planning
    )
    expect(score).toBe(0)
  })

  it('ne s\'applique pas aux créneaux WE', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-13', type: 'semaine_soir',
        premier_id: JEAN.id, second_id: VICTOR.id,
      }],
    }
    const score = penaliteInversionFerie(
      slot('2026-05-14', 'weekend'),
      JEAN, 'premier', planning
    )
    expect(score).toBe(0)
  })

  it('fonctionne aussi sur Lundi de Pâques 2026 (6 avril)', () => {
    // Veille = dimanche 5 avril — mais le dimanche n'a pas de garde (couvert par WE)
    // Donc attrVeille = undefined → pénalité = 0
    const score = penaliteInversionFerie(
      slot('2026-04-06', 'semaine_soir'),
      JEAN, 'premier', planningVide
    )
    expect(score).toBe(0) // pas de garde le dimanche → pas de pénalité
  })
})

// ── penalite() — point d'entrée ──────────────────────────

describe('penalite() — agrégation', () => {
  it('retourne 0 sur planning vide', () => {
    expect(penalite(slot('2026-05-09', 'weekend'), JEAN, 'premier', planningVide)).toBe(0)
  })

  it('retourne la pénalité R10 si applicable', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        premier_id: MANON.id, second_id: VICTOR.id,
      }],
    }
    expect(penalite(slot('2026-05-09', 'weekend'), MANON, 'premier', planning))
      .toBe(PENALITE.WE_CONSECUTIF)
  })

  it('retourne 0 pour un créneau semaine ordinaire', () => {
    expect(penalite(slot('2026-05-04', 'semaine_soir'), JEAN, 'premier', planningVide)).toBe(0)
  })

  it('cumule R10b + R8b si applicable le même soir', () => {
    // 24 déc 2026 = jeudi — et Jean était 1er la veille (23 déc)
    // → pénalité R10b (réveillon) + R8b (inversion) si c'est un férié
    // Note: 24 déc n'est PAS un férié officiel → R8b ne s'applique pas
    // → seulement R10b
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-12-23', type: 'semaine_soir',
        premier_id: JEAN.id, second_id: VICTOR.id,
      }],
    }
    const score = penalite(slot('2026-12-24', 'semaine_soir'), JEAN, 'premier', planning)
    // R10b = 30, R8b = 0 (24 déc n'est pas férié), R10 WE = 0
    expect(score).toBe(PENALITE.FETE_FIN_ANNEE)
  })
})
