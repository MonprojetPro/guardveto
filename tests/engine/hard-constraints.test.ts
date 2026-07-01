import { describe, it, expect } from 'vitest'
import { isValid } from '@/engine/rules/hard-constraints'
import type { SlotGarde, PlanningPartiel, VetEngine } from '@/engine/types'
import {
  ANNE_SOPHIE, FANNY, JEAN, ANNE_CAT, MANON, ANTOINE, VICTOR, ALL_VETS,
} from './scenarios/vets'

const planningVide: PlanningPartiel = { attributions: [] }

// ── Helper ──────────────────────────────────────────────

function slot(date: string, type: SlotGarde['type'], saison: SlotGarde['saison'] = 'hiver'): SlotGarde {
  return { date, type, saison }
}

// Semaine impaire : semaine 17 de 2026 → lundi 20 avril 2026 (sem 17 = impaire)
// Semaine paire   : semaine 18 de 2026 → lundi 27 avril 2026

// ── R16 : Congés ────────────────────────────────────────

describe('R16 — Véto en congé', () => {
  it('refuse une garde si le véto est en congé ce jour', () => {
    const fannyEnConge = {
      ...FANNY,
      conges: [{ date_debut: '2026-05-04', date_fin: '2026-05-10' }],
    }
    const result = isValid(slot('2026-05-06', 'semaine_soir'), fannyEnConge, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R16/)
  })

  it('autorise une garde hors période de congé', () => {
    const fannyEnConge = {
      ...FANNY,
      conges: [{ date_debut: '2026-05-04', date_fin: '2026-05-10' }],
    }
    const result = isValid(slot('2026-05-11', 'semaine_soir'), fannyEnConge, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })
})

// ── R17 : Été — 1 seul de garde ─────────────────────────

describe('R17 — Été : 1 seul de garde', () => {
  it('refuse le rôle 2nd en semaine été', () => {
    const result = isValid(slot('2026-06-15', 'semaine_soir', 'ete'), JEAN, 'second', ALL_VETS, planningVide)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R17/)
  })

  it('accepte le rôle 1er en semaine été', () => {
    const result = isValid(slot('2026-06-15', 'semaine_soir', 'ete'), JEAN, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })

  it('accepte le rôle 2nd en WE même en été', () => {
    const result = isValid(slot('2026-06-20', 'weekend', 'ete'), VICTOR, 'second', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })
})

// ── R1 : Repos fixe ─────────────────────────────────────

describe('R1 — Jours de repos fixes', () => {
  it('Fanny : refuse mercredi hors vacances scolaires', () => {
    // 2026-03-11 = mercredi, hors vacances (vac hiver finissent 02/03)
    const result = isValid(slot('2026-03-11', 'semaine_soir'), FANNY, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R1/)
  })

  it('Fanny : autorise mercredi pendant les vacances scolaires', () => {
    // 2026-04-15 = mercredi pendant vacances Pâques (11 avr – 27 avr)
    const result = isValid(slot('2026-04-15', 'semaine_soir'), FANNY, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })

  it('Anne-Sophie : refuse jeudi semaine impaire', () => {
    // 2026-04-23 = jeudi, sem 17 = impaire
    const result = isValid(slot('2026-04-23', 'semaine_soir'), ANNE_SOPHIE, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R1/)
  })

  it('Anne-Sophie : autorise jeudi semaine paire', () => {
    // 2026-04-30 = jeudi, sem 18 = paire
    const result = isValid(slot('2026-04-30', 'semaine_soir'), ANNE_SOPHIE, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })
})

// ── R2 : Anne-So indispo semaines impaires ───────────────

describe('R2 — Indisponibilité cyclique (Anne-Sophie)', () => {
  it('refuse soir de semaine impaire', () => {
    // 2026-04-20 = lundi sem 17 = impaire
    const result = isValid(slot('2026-04-20', 'semaine_soir'), ANNE_SOPHIE, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R2/)
  })

  it('refuse weekend semaine impaire', () => {
    // 2026-04-25 = samedi sem 17 = impaire
    const result = isValid(slot('2026-04-25', 'weekend'), ANNE_SOPHIE, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R2/)
  })

  it('autorise soir de semaine paire', () => {
    // 2026-04-28 = mardi sem 18 = paire (lundi bloqué par R1 repos lundi AP paires)
    const result = isValid(slot('2026-04-28', 'semaine_soir'), ANNE_SOPHIE, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })

  it('autorise weekend semaine paire', () => {
    // 2026-05-02 = samedi sem 18 = paire
    const result = isValid(slot('2026-05-02', 'weekend'), ANNE_SOPHIE, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })
})

// ── R3/R5 : Repos conditionnel ───────────────────────────

describe('R3/R5 — Repos conditionnel', () => {
  it('Jean : refuse vendredi sans garde WE', () => {
    // Semaine du 2026-04-27 : Jean n'a pas de WE → repos vendredi
    const result = isValid(slot('2026-05-01', 'semaine_soir'), JEAN, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R3/)
  })

  it('Jean : autorise vendredi si garde WE', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    const result = isValid(slot('2026-05-01', 'semaine_soir'), JEAN, 'premier', ALL_VETS, planning)
    expect(result.valid).toBe(true)
  })

  it('Jean : refuse mardi si garde WE', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-04-25', type: 'weekend',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    const result = isValid(slot('2026-04-28', 'semaine_soir'), JEAN, 'premier', ALL_VETS, planning)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R3/)
  })

  it('Manon : refuse jeudi si garde WE', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-04-25', type: 'weekend',
        placements: [{ role: 'premier', vetId: MANON.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    const result = isValid(slot('2026-04-23', 'semaine_soir'), MANON, 'premier', ALL_VETS, planning)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R3|R5/)
  })

  // ── Fix R3 : vendredi_soir traité comme garde WE ───────
  // Sans ce fix, Victor/Antoine/Manon/Jean étaient bloqués de tous les WE
  // car leur contrainte "sinon: vendredi" bloquait le vendredi soir (WE pas encore planifié).

  it('Victor : autorise vendredi_soir même sans WE planifié (vendredi_soir = garde WE)', () => {
    // Victor a "sinon: vendredi". Sans le fix, il serait bloqué.
    const result = isValid(slot('2026-05-08', 'vendredi_soir'), VICTOR, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })

  it('Antoine : autorise vendredi_soir même sans WE planifié', () => {
    const result = isValid(slot('2026-05-08', 'vendredi_soir'), ANTOINE, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })

  it('Manon : autorise vendredi_soir même sans WE planifié', () => {
    const result = isValid(slot('2026-05-08', 'vendredi_soir'), MANON, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })

  it('Jean : autorise vendredi_soir même sans WE planifié', () => {
    const result = isValid(slot('2026-05-08', 'vendredi_soir'), JEAN, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
  })

  it('Victor : repos jeudi reste bloqué une fois vendredi_soir planifié (gardeWe=true)', () => {
    // vendredi_soir 8 mai → Victor "si_garde_we: jeudi" → jeudi 7 mai bloqué
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-08', type: 'vendredi_soir',
        placements: [{ role: 'premier', vetId: VICTOR.id }, { role: 'second', vetId: FANNY.id }],
      }],
    }
    const result = isValid(slot('2026-05-07', 'semaine_soir'), VICTOR, 'premier', ALL_VETS, planning)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R3|R5/)
  })
})

// ── R6 : Duo interdit Manon + Antoine ───────────────────

describe('R6 — Duo interdit', () => {
  it('refuse Antoine si Manon est déjà assignée (duo seuls)', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-04-25', type: 'weekend',
        placements: [{ role: 'premier', vetId: MANON.id }, { role: 'second', vetId: null }],
      }],
    }
    const result = isValid(slot('2026-04-25', 'weekend'), ANTOINE, 'second', ALL_VETS, planning)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R6/)
  })

  it('autorise Antoine si Victor est le 1er (pas de duo Manon+Antoine)', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-04-25', type: 'weekend',
        placements: [{ role: 'premier', vetId: VICTOR.id }, { role: 'second', vetId: null }],
      }],
    }
    const result = isValid(slot('2026-04-25', 'weekend'), ANTOINE, 'second', ALL_VETS, planning)
    expect(result.valid).toBe(true)
  })

  it('autorise Manon si Victor est le 1er', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-04-25', type: 'weekend',
        placements: [{ role: 'premier', vetId: VICTOR.id }, { role: 'second', vetId: null }],
      }],
    }
    const result = isValid(slot('2026-04-25', 'weekend'), MANON, 'second', ALL_VETS, planning)
    expect(result.valid).toBe(true)
  })
})

// ── R7 : Dernier recours ─────────────────────────────────

describe('R7 — Dernier recours (Anne-Cat)', () => {
  it('retourne valid=true mais avec un warning', () => {
    const result = isValid(slot('2026-04-27', 'semaine_soir'), ANNE_CAT, 'premier', ALL_VETS, planningVide)
    expect(result.valid).toBe(true)
    expect(result.warning).toMatch(/R7/)
  })

  it('les autres vétérinaires n\'ont pas de warning R7', () => {
    const result = isValid(slot('2026-04-27', 'semaine_soir'), JEAN, 'premier', ALL_VETS, planningVide)
    expect(result.warning).toBeUndefined()
  })
})

// ── R8 : Inversion 1er/2nd vendredi→WE ──────────────────

describe('R8 — Inversion vendredi soir / WE', () => {
  it('refuse Jean comme 1er WE s\'il était 1er vendredi soir', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-01', type: 'vendredi_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    const result = isValid(slot('2026-05-02', 'weekend'), JEAN, 'premier', ALL_VETS, planning)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R8/)
  })

  it('accepte Jean comme 2nd WE s\'il était 1er vendredi soir', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-01', type: 'vendredi_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    const result = isValid(slot('2026-05-02', 'weekend'), JEAN, 'second', ALL_VETS, planning)
    expect(result.valid).toBe(true)
  })
})

// ── R9 : Vendredi soir lié au WE ────────────────────────

describe('R9 — Vendredi soir lié au WE', () => {
  it('refuse Victor au WE si le duo vendredi était Jean + Fanny', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-01', type: 'vendredi_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: FANNY.id }],
      }],
    }
    const result = isValid(slot('2026-05-02', 'weekend'), VICTOR, 'premier', ALL_VETS, planning)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R9/)
  })

  it('accepte Jean au WE si Jean était dans le duo vendredi', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-01', type: 'vendredi_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: FANNY.id }],
      }],
    }
    const result = isValid(slot('2026-05-02', 'weekend'), JEAN, 'second', ALL_VETS, planning)
    expect(result.valid).toBe(true)
  })
})

// ── R19 : WE toujours 2 de garde ────────────────────────

describe('R19 — WE toujours 2 de garde', () => {
  it('refuse le 2nd si le 1er n\'est pas encore assigné', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-04-25', type: 'weekend',
        placements: [{ role: 'premier', vetId: null }, { role: 'second', vetId: null }],
      }],
    }
    const result = isValid(slot('2026-04-25', 'weekend'), VICTOR, 'second', ALL_VETS, planning)
    expect(result.valid).toBe(false)
    expect(result.raison).toMatch(/R19/)
  })
})
