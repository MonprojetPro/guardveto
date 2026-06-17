// ============================================================
// GUARDVETO — Tests « zone-aware » des vacances scolaires
// ============================================================
// Prouve que la règle « repos sauf vacances scolaires » (R1,
// flexible_vacances — ex. Fanny mercredi) honore les dates de la
// ZONE du cabinet, et pas la constante zone C codée en dur.
//
// Date discriminante : mercredi 2026-02-11
//   - Zone A « Hiver 2026 » : 2026-02-07 → 2026-02-23  → EN vacances
//   - Zone C « Hiver 2026 » : 2026-02-14 → 2026-03-02  → HORS vacances
// (dates issues du seed supabase/migrations/20260616160000_calendrier.sql)
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid } from '@/engine/rules/hard-constraints'
import { estEnVacancesScolaires } from '@/engine/utils'
import type { SlotGarde, VetEngine, PlanningPartiel, CalendrierResolu } from '@/engine/types'
import { FANNY, ALL_VETS } from './scenarios/vets'

const planningVide: PlanningPartiel = { attributions: [] }

function slot(date: string, type: SlotGarde['type'], saison: SlotGarde['saison'] = 'hiver'): SlotGarde {
  return { date, type, saison }
}

// Calendriers de référence (sous-ensemble « Hiver 2026 » de chaque zone)
const CAL_ZONE_A: CalendrierResolu = {
  feries: new Set(),
  vacancesScolaires: [{ debut: '2026-02-07', fin: '2026-02-23' }], // zone A
}
const CAL_ZONE_C: CalendrierResolu = {
  feries: new Set(),
  vacancesScolaires: [{ debut: '2026-02-14', fin: '2026-03-02' }], // zone C
}

// Mercredi discriminant : dans les vacances A mais hors vacances C.
const MERCREDI_DISCRIMINANT = '2026-02-11'

describe('Vacances scolaires — sensibilité à la zone', () => {
  it('estEnVacancesScolaires() honore la zone fournie (A) vs la constante zone C', () => {
    // Avec le calendrier zone A : le mercredi 11/02 EST en vacances.
    expect(estEnVacancesScolaires(MERCREDI_DISCRIMINANT, CAL_ZONE_A)).toBe(true)
    // Avec le calendrier zone C : le même jour N'EST PAS en vacances.
    expect(estEnVacancesScolaires(MERCREDI_DISCRIMINANT, CAL_ZONE_C)).toBe(false)
    // Fallback constante (zone C codée en dur) : hors vacances (= bug latent
    // pour un cabinet zone A si on n'injecte pas le bon calendrier).
    expect(estEnVacancesScolaires(MERCREDI_DISCRIMINANT)).toBe(false)
  })

  it('R1 (Fanny mercredi, flexible_vacances) : garde AUTORISÉE en zone A ce mercredi', () => {
    // Zone A : 11/02 est en vacances → la flexibilité s'applique → garde OK.
    const r = isValid(
      slot(MERCREDI_DISCRIMINANT, 'semaine_soir'),
      FANNY,
      'premier',
      ALL_VETS,
      planningVide,
      CAL_ZONE_A
    )
    expect(r.valid).toBe(true)
  })

  it('R1 (Fanny mercredi, flexible_vacances) : garde REFUSÉE en zone C ce mercredi', () => {
    // Zone C : 11/02 hors vacances → repos fixe du mercredi s'applique → refus.
    const r = isValid(
      slot(MERCREDI_DISCRIMINANT, 'semaine_soir'),
      FANNY,
      'premier',
      ALL_VETS,
      planningVide,
      CAL_ZONE_C
    )
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/R1/)
  })

  it('régression : sans calendrier (fallback zone C en dur) la garde du mercredi 11/02 est refusée', () => {
    // Démontre le bug latent : un cabinet zone A SANS calendrier injecté
    // retombe sur la constante zone C → comportement faux pour ce cabinet.
    const r = isValid(
      slot(MERCREDI_DISCRIMINANT, 'semaine_soir'),
      FANNY,
      'premier',
      ALL_VETS,
      planningVide
      // pas de calendrier → fallback constante zone C
    )
    expect(r.valid).toBe(false)
  })
})
