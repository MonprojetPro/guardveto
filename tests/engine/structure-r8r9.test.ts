// ============================================================
// GUARDVETO — R8/R9 réglables (structure du week-end) — tests
// ============================================================
// R8 (inversion des rôles) et R9 (même binôme vendredi=WE) deviennent
// réglables : DÉSACTIVABLES (toggle) et de NIVEAU configurable (ferme→souple).
// On vérifie les DEUX gardiens (moteur isValid + validateur indépendant) +
// le scoreur (pénalité souple) + l'extraction de config + la non-régression.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  checkR8Inversion,
  checkR9VendrediLieWE,
  isValid,
} from '@/engine/rules/hard-constraints'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { scorerPlanning, Etage } from '@/engine/score-lexicographique'
import { extraireStructureConfig, type RegleCabinetRow } from '@/data/mapReglesCabinet'
import {
  DEFAULT_STRUCTURE_CONFIG,
  type StructureConfig,
} from '@/engine/structure-config'
import { vendrediDeSemaine } from '@/engine/utils'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, VetEngineNormalise, SlotGarde, PlanningPartiel } from '@/engine/types'

// ── Fixtures ─────────────────────────────────────────────
const vet = (id: string): VetEngineNormalise => normaliserContraintesVets([{
  id, prenom: id, nom: 'X', statut: 'associe', dernier_recours: false,
  contraintes: [], conges: [],
} as VetEngine])[0]
const A = vet('A'), B = vet('B'), C = vet('C'), D = vet('D')
const ALL = [A, B, C, D]

// Vendredi/samedi cohérents (le check lit vendrediDeSemaine(date du WE)).
const SAM = '2026-01-10'
const VEN = vendrediDeSemaine(SAM)

// Vendredi soir = duo {A,B} (A=1er, B=2nd).
const planningVenAB: PlanningPartiel = {
  attributions: [{ date: VEN, type: 'vendredi_soir', premier_id: 'A', second_id: 'B' }],
}
const weekendSlot: SlotGarde = { date: SAM, type: 'weekend', saison: 'hiver', besoinSecond: true }

const off = { actif: false, etage: 2 }
const ferme = { actif: true, etage: 2 }
const souple = { actif: true, etage: 5 }

// ── A. checkR9 (moteur) honore la config ─────────────────
describe('R9 — checkR9VendrediLieWE honore la config', () => {
  // C n'est PAS dans le duo du vendredi {A,B}.
  it('FERME (défaut) → bloque un véto absent du duo vendredi', () => {
    const r = checkR9VendrediLieWE(C, weekendSlot, planningVenAB) // défaut = ferme
    expect(r.valid).toBe(false)
    expect(r.raison).toContain('R9')
  })
  it('DÉSACTIVÉE → ne bloque pas', () => {
    expect(checkR9VendrediLieWE(C, weekendSlot, planningVenAB, off).valid).toBe(true)
  })
  it('SOUPLE → ne bloque pas (pénalité gérée au scoring)', () => {
    expect(checkR9VendrediLieWE(C, weekendSlot, planningVenAB, souple).valid).toBe(true)
  })
})

// ── B. checkR8 (moteur) honore la config ─────────────────
describe('R8 — checkR8Inversion honore la config', () => {
  // A était 1er vendredi → 1er le WE viole l'inversion.
  it('FERME (défaut) → bloque le non-respect de l’inversion', () => {
    const r = checkR8Inversion(A, weekendSlot, 'premier', planningVenAB)
    expect(r.valid).toBe(false)
    expect(r.raison).toContain('R8')
  })
  it('DÉSACTIVÉE → ne bloque pas', () => {
    expect(checkR8Inversion(A, weekendSlot, 'premier', planningVenAB, off).valid).toBe(true)
  })
  it('SOUPLE → ne bloque pas', () => {
    expect(checkR8Inversion(A, weekendSlot, 'premier', planningVenAB, souple).valid).toBe(true)
  })
})

// ── C. isValid bout-en-bout : R9 off découple vendredi/WE ──
describe('isValid — R9 désactivée autorise un binôme WE différent du vendredi', () => {
  const cfgR9off: StructureConfig = {
    r9_liaison: off,
    r8_inversion: off, // on coupe aussi R8 pour isoler le découplage
  }
  it('défaut : C (hors duo vendredi) refusé en 1er du WE', () => {
    const r = isValid(weekendSlot, C, 'premier', ALL, planningVenAB)
    expect(r.valid).toBe(false)
  })
  it('R9+R8 désactivées : C accepté', () => {
    const r = isValid(weekendSlot, C, 'premier', ALL, planningVenAB, undefined, cfgR9off)
    expect(r.valid).toBe(true)
  })
})

// ── D. Validateur indépendant : pas de violation fantôme ──
describe('validerPlanning — R8/R9 selon la config (anti-fantôme)', () => {
  // Planning DÉCOUPLÉ : vendredi {A,B}, week-end {C,D}.
  const planningDecouple: PlanningPartiel = {
    attributions: [
      { date: VEN, type: 'vendredi_soir', premier_id: 'A', second_id: 'B' },
      { date: SAM, type: 'weekend', premier_id: 'C', second_id: 'D' },
    ],
  }
  const input = {
    dateDebut: VEN, dateFin: '2026-01-11', saison: 'hiver' as const, vets: ALL,
  }

  it('défaut (ferme) → signale la violation R9', () => {
    const v = validerPlanning(planningDecouple, input)
    expect(v.some((x) => x.regle === 'R9')).toBe(true)
  })
  it('R9 désactivée → AUCUNE violation R9 (pas de fantôme)', () => {
    const v = validerPlanning(planningDecouple, {
      ...input,
      structureConfig: { r9_liaison: off, r8_inversion: off },
    })
    expect(v.some((x) => x.regle === 'R9')).toBe(false)
    expect(v.some((x) => x.regle === 'R8')).toBe(false)
  })
})

// ── E. Scoreur : R9 souple = pénalité (pas invariant) ────
describe('scorerPlanning — R9 souple pénalise sans casser la validité', () => {
  const planningDecouple: PlanningPartiel = {
    attributions: [
      { date: VEN, type: 'vendredi_soir', premier_id: 'A', second_id: 'B' },
      { date: SAM, type: 'weekend', premier_id: 'C', second_id: 'D' },
    ],
  }

  it('FERME → la violation R9 compte comme INVARIANT (étage 0)', () => {
    const v = scorerPlanning(planningDecouple, ALL, 'hiver') // défaut ferme
    expect(v.etages[Etage.INVARIANT_SYSTEME]).toBeGreaterThan(0)
  })

  it('SOUPLE (étage 3) → 0 invariant, pénalité à l’étage SAUF_CRISE', () => {
    const cfg: StructureConfig = {
      r9_liaison: { actif: true, etage: 3 },
      r8_inversion: off, // isole R9
    }
    const v = scorerPlanning(planningDecouple, ALL, 'hiver', undefined, cfg)
    expect(v.etages[Etage.INVARIANT_SYSTEME]).toBe(0)
    expect(v.etages[Etage.SAUF_CRISE]).toBeGreaterThan(0)
  })
})

// ── F. extraireStructureConfig (pur) ─────────────────────
describe('extraireStructureConfig — défaut + lecture des règles', () => {
  it('aucune règle → défaut ferme + active pour R8 et R9', () => {
    expect(extraireStructureConfig([])).toEqual(DEFAULT_STRUCTURE_CONFIG)
  })

  it('lit l’activation et l’étage depuis les règles', () => {
    const rows: RegleCabinetRow[] = [
      { id: '1', cabinet_id: 'c', periode_id: null, brique_id: 'liaison_creneaux',
        actif: false, force: 'jamais', params_json: { params: {} } }, // R9 désactivée
      { id: '2', cabinet_id: 'c', periode_id: null, brique_id: 'inversion_role',
        actif: true, force: 'si_possible', params_json: { params: {} } }, // R8 souple (étage 5)
    ]
    const cfg = extraireStructureConfig(rows)
    expect(cfg.r9_liaison).toEqual({ actif: false, etage: 2 })
    expect(cfg.r8_inversion).toEqual({ actif: true, etage: 5 })
  })
})
