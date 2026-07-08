// ============================================================
// GUARDVETO — Vague 6 tranche C : garde conditionnelle ORIENTÉE (#15b)
// ============================================================
// Brique PAR-VÉTO `seulement_avec` (famille `interdire`), réglable dur/mou :
// « A seulement de garde si B est de garde sur le MÊME créneau ». ORIENTÉE :
// A dépend de B, jamais l'inverse (une ligne, pas de miroir). Jugée à la POSE
// COMPLÉTANTE (gabarit composition_equipe) — l'équipe se fige quand la dernière
// place se pourvoit ; avant, l'avenir peut encore amener B.
//
// Deux gardiens dans la même livraison (moteur + validateur indépendant), sinon
// violations fantômes ou invisibles. On teste : (1) DUR pose complétante, (2)
// orientation (B sans A OK), (3) slot 1 place (A refusé), (4) ciblage créneaux,
// (5) MOU pénalise sans bloquer, (6) validateur (violation à la main / pas de
// fantôme), (7) inertie, (8) byte-identique, (9) bout en bout solve→validateur.
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid } from '@/engine/rules/hard-constraints'
import { penaliteSeulementAvecCandidat, scorerSeulementAvec } from '@/engine/rules/seulement-avec'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type {
  VetEngine, VetEngineNormalise, SlotGarde, PlanningPartiel, ContrainteEngine, AttributionGarde,
} from '@/engine/types'

// A = porteur de la règle ; B = binôme requis ; C = tiers quelconque.
const A = 'vA', B = 'vB', C = 'vC'

/** Véto porteur d'UNE règle seulement_avec (params + étage). */
function vetA(params: Record<string, unknown>, force: number): VetEngineNormalise {
  const config: Record<string, unknown> = { brique: 'seulement_avec', force, params }
  const v: VetEngine = {
    id: A, prenom: 'Antoine', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'c1', type: 'seulement_avec', actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

/** Vétos sans règle (B et C). */
function vetSimple(id: string, prenom: string): VetEngineNormalise {
  return normaliserContraintesVets([{
    id, prenom, nom: 'X', statut: 'associe', dernier_recours: false, conges: [], contraintes: [],
  }])[0]
}

// Slot 2 places (week-end en hiver) et slot 1 place (soir été).
const slotWe = (date: string): SlotGarde => ({ date, type: 'weekend', saison: 'hiver', besoinSecond: true, nbPlaces: 2 })
const slotSolo = (date: string): SlotGarde => ({ date, type: 'semaine_soir', saison: 'ete', besoinSecond: false, nbPlaces: 1 })

// Attribution week-end avec une place déjà pourvue par `who` (l'autre à null).
const weUnePlace = (date: string, who: string | null): AttributionGarde =>
  ({ date, type: 'weekend', placements: [{ role: 'premier', vetId: who }, { role: 'second', vetId: null }] })

const params = { avec_veterinaire_id: B }
const empty: PlanningPartiel = { attributions: [] }

const vB = vetSimple(B, 'Victor')
const vC = vetSimple(C, 'Chloé')

// ════════════════════════════════════════════════════════════
// DUR — pose complétante (slot 2 places)
// ════════════════════════════════════════════════════════════
describe('seulement_avec — DUR pose complétante (slot 2 places)', () => {
  it('A posé en 1re place PASSE tant que le slot n\'est pas complet (avenir peut amener B)', () => {
    const a = vetA(params, 2)
    // Rien encore posé sur ce slot : poser A en 1er n'est pas complétant (place 2 libre).
    const r = isValid(slotWe('2026-11-14'), a, 'premier', [a, vB, vC], empty)
    expect(r.valid).toBe(true)
  })

  it('pose COMPLÉTANTE avec équipe {A, C} sans B → refus', () => {
    const a = vetA(params, 2)
    // C occupe déjà la 1re place ; on pose A en 2nd → complétant, B absent → refus.
    const planning: PlanningPartiel = { attributions: [weUnePlace('2026-11-14', C)] }
    const r = isValid(slotWe('2026-11-14'), a, 'second', [a, vB, vC], planning)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/SEULEMENT_AVEC/)
  })

  it('pose COMPLÉTANTE avec équipe {A, B} → OK', () => {
    const a = vetA(params, 2)
    // B occupe déjà la 1re place ; on pose A en 2nd → complétant, B présent → OK.
    const planning: PlanningPartiel = { attributions: [weUnePlace('2026-11-14', B)] }
    const r = isValid(slotWe('2026-11-14'), a, 'second', [a, vB, vC], planning)
    expect(r.valid).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════
// ORIENTATION — B peut être de garde sans A (jamais l'inverse)
// ════════════════════════════════════════════════════════════
describe('seulement_avec — orientation (cœur de la brique)', () => {
  it('B (le binôme requis) peut compléter un créneau sans A — aucune règle sur B', () => {
    const a = vetA(params, 2)
    // C déjà posé ; on pose B en 2nd → complétant. B n'a AUCUNE règle → OK.
    const planning: PlanningPartiel = { attributions: [weUnePlace('2026-11-14', C)] }
    const r = isValid(slotWe('2026-11-14'), vB, 'second', [a, vB, vC], planning)
    expect(r.valid).toBe(true)
  })

  it('la règle ne se déclenche QUE quand on pose A (le porteur)', () => {
    const a = vetA(params, 2)
    // On pose C (tiers) en complétant une équipe {A, C} : A est déjà là sans B,
    // mais poser C n'est pas jugé par la règle de A (elle est portée par A).
    // NB : ce cas de figure « A déjà là sans B » ne peut pas naître du moteur
    // (A aurait été le dernier posé et refusé) — on prouve juste que la règle
    // est bien attachée au porteur, pas au tiers.
    const planning: PlanningPartiel = { attributions: [weUnePlace('2026-11-14', A)] }
    const r = isValid(slotWe('2026-11-14'), vC, 'second', [a, vB, vC], planning)
    expect(r.valid).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════
// SLOT 1 PLACE — A refusé (pose complétante immédiate)
// ════════════════════════════════════════════════════════════
describe('seulement_avec — slot 1 place', () => {
  it('DUR : sur un créneau à une seule place, A est refusé (B ne peut pas y être)', () => {
    const a = vetA(params, 2)
    // La pose de A EST complétante (1 place) → équipe finale = {A}, B absent → refus.
    const r = isValid(slotSolo('2026-08-11'), a, 'premier', [a, vB, vC], empty)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/SEULEMENT_AVEC/)
  })
})

// ════════════════════════════════════════════════════════════
// CIBLAGE CRÉNEAUX — la règle ne s'applique qu'aux types ciblés
// ════════════════════════════════════════════════════════════
describe('seulement_avec — ciblage créneaux', () => {
  it('règle ciblée sur weekend : ne s\'applique PAS au soir de semaine', () => {
    const a = vetA({ avec_veterinaire_id: B, creneaux: ['weekend'] }, 2)
    // Slot solo (semaine_soir) hors ciblage → A passe même sans B.
    expect(isValid(slotSolo('2026-08-11'), a, 'premier', [a, vB, vC], empty).valid).toBe(true)
  })

  it('règle ciblée sur weekend : s\'applique bien au weekend (refus si B absent)', () => {
    const a = vetA({ avec_veterinaire_id: B, creneaux: ['weekend'] }, 2)
    const planning: PlanningPartiel = { attributions: [weUnePlace('2026-11-14', C)] }
    expect(isValid(slotWe('2026-11-14'), a, 'second', [a, vB, vC], planning).valid).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
// MOU — pénalise sans bloquer
// ════════════════════════════════════════════════════════════
describe('seulement_avec — MOU (étage ≥ 3)', () => {
  it('MOU : la pose complétante sans B n\'est PAS bloquée mais pénalisée (candidat)', () => {
    const a = vetA(params, 4)
    const planning: PlanningPartiel = { attributions: [weUnePlace('2026-11-14', C)] }
    // isValid ne bloque pas (souple).
    expect(isValid(slotWe('2026-11-14'), a, 'second', [a, vB, vC], planning).valid).toBe(true)
    // Mais le scoreur de candidat pénalise à la pose complétante.
    expect(penaliteSeulementAvecCandidat(slotWe('2026-11-14'), 'second', a, planning)).toBeGreaterThan(0)
  })

  it('MOU : équipe {A, B} → aucune pénalité', () => {
    const a = vetA(params, 4)
    const planning: PlanningPartiel = { attributions: [weUnePlace('2026-11-14', B)] }
    expect(penaliteSeulementAvecCandidat(slotWe('2026-11-14'), 'second', a, planning)).toBe(0)
  })

  it('MOU : le scoreur GLOBAL pénalise un créneau final {A, C} sans B', () => {
    const a = vetA(params, 4)
    const planning: PlanningPartiel = { attributions: [{
      date: '2026-11-14', type: 'weekend',
      placements: [{ role: 'premier', vetId: A }, { role: 'second', vetId: C }],
    }] }
    expect(scorerSeulementAvec(planning, [a, vB, vC]).length).toBeGreaterThan(0)
  })

  it('DUR : le scoreur GLOBAL ne compte JAMAIS une règle dure (bloquée en amont)', () => {
    const a = vetA(params, 2)
    const planning: PlanningPartiel = { attributions: [{
      date: '2026-11-14', type: 'weekend',
      placements: [{ role: 'premier', vetId: A }, { role: 'second', vetId: C }],
    }] }
    expect(scorerSeulementAvec(planning, [a, vB, vC])).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════
// VALIDATEUR indépendant — accord des deux gardiens
// ════════════════════════════════════════════════════════════
describe('seulement_avec — validateur indépendant', () => {
  const input = { dateDebut: '2026-11-01', dateFin: '2026-11-30', saison: 'hiver' as const, nbVetosSemaineSoir: 2 }

  it('violation détectée : A de garde sans B sur le même créneau (dur)', () => {
    const a = vetA(params, 2)
    const planning: PlanningPartiel = { attributions: [{
      date: '2026-11-14', type: 'weekend',
      placements: [{ role: 'premier', vetId: A }, { role: 'second', vetId: C }],
    }] }
    const v = validerPlanning(planning, { ...input, vets: [a, vB, vC] })
    expect(v.some((x) => x.regle === 'SEULEMENT_AVEC')).toBe(true)
  })

  it('AUCUN fantôme : A avec B → pas de violation', () => {
    const a = vetA(params, 2)
    const planning: PlanningPartiel = { attributions: [{
      date: '2026-11-14', type: 'weekend',
      placements: [{ role: 'premier', vetId: A }, { role: 'second', vetId: B }],
    }] }
    const v = validerPlanning(planning, { ...input, vets: [a, vB, vC] })
    expect(v.some((x) => x.regle === 'SEULEMENT_AVEC')).toBe(false)
  })

  it('AUCUN fantôme : B de garde SANS A (orientation) → pas de violation', () => {
    const a = vetA(params, 2)
    const planning: PlanningPartiel = { attributions: [{
      date: '2026-11-14', type: 'weekend',
      placements: [{ role: 'premier', vetId: B }, { role: 'second', vetId: C }],
    }] }
    const v = validerPlanning(planning, { ...input, vets: [a, vB, vC] })
    expect(v.some((x) => x.regle === 'SEULEMENT_AVEC')).toBe(false)
  })

  it('AUCUN fantôme : règle MOU (étage ≥ 3) → jamais une violation dure', () => {
    const a = vetA(params, 4)
    const planning: PlanningPartiel = { attributions: [{
      date: '2026-11-14', type: 'weekend',
      placements: [{ role: 'premier', vetId: A }, { role: 'second', vetId: C }],
    }] }
    const v = validerPlanning(planning, { ...input, vets: [a, vB, vC] })
    expect(v.some((x) => x.regle === 'SEULEMENT_AVEC')).toBe(false)
  })

  it('ciblage : A sans B sur un créneau HORS ciblage → pas de violation', () => {
    const a = vetA({ avec_veterinaire_id: B, creneaux: ['weekend'] }, 2)
    // A de garde en soir de semaine (hors ciblage weekend) sans B → OK.
    const planning: PlanningPartiel = { attributions: [{
      date: '2026-11-10', type: 'semaine_soir',
      placements: [{ role: 'premier', vetId: A }, { role: 'second', vetId: C }],
    }] }
    const v = validerPlanning(planning, { ...input, vets: [a, vB, vC] })
    expect(v.some((x) => x.regle === 'SEULEMENT_AVEC')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
// INERTIE — mal configurée → aucun effet, jamais de crash
// ════════════════════════════════════════════════════════════
describe('seulement_avec — inertie', () => {
  it('avec_veterinaire_id absent → aucun effet (isValid + validateur)', () => {
    const a = vetA({}, 2)
    const planning: PlanningPartiel = { attributions: [weUnePlace('2026-11-14', C)] }
    expect(isValid(slotWe('2026-11-14'), a, 'second', [a, vB, vC], planning).valid).toBe(true)
    const input = { dateDebut: '2026-11-01', dateFin: '2026-11-30', saison: 'hiver' as const, nbVetosSemaineSoir: 2 }
    const final: PlanningPartiel = { attributions: [{
      date: '2026-11-14', type: 'weekend',
      placements: [{ role: 'premier', vetId: A }, { role: 'second', vetId: C }],
    }] }
    expect(validerPlanning(final, { ...input, vets: [a, vB, vC] }).some((x) => x.regle === 'SEULEMENT_AVEC')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
// BYTE-IDENTIQUE — sans règle, rien ne change
// ════════════════════════════════════════════════════════════
describe('seulement_avec — byte-identique sans règle', () => {
  it('un véto sans règle peut être de garde sans personne de précis', () => {
    const a = vetSimple(A, 'Antoine')
    const planning: PlanningPartiel = { attributions: [weUnePlace('2026-11-14', C)] }
    expect(isValid(slotWe('2026-11-14'), a, 'second', [a, vB, vC], planning).valid).toBe(true)
    expect(penaliteSeulementAvecCandidat(slotWe('2026-11-14'), 'second', a, planning)).toBe(0)
    expect(scorerSeulementAvec(planning, [a, vB, vC])).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════
// BOUT EN BOUT — solve avec règle dure → validateur d'accord
// ════════════════════════════════════════════════════════════
describe('seulement_avec — bout en bout (solve → validateur)', () => {
  it('un solve avec la règle dure ne produit jamais A sans B sur les slots visés', async () => {
    const { genererPlanningPur } = await import('@/engine/solver')
    const base = (id: string, prenom: string, contraintes: ContrainteEngine[]): VetEngine => ({
      id, prenom, nom: 'X', statut: 'associe', dernier_recours: false, conges: [], contraintes,
    })
    // A « seulement avec B » DUR, ciblé sur les week-ends (créneaux 2 places).
    const cSA: ContrainteEngine = {
      id: 'c1', type: 'seulement_avec', actif: true,
      config: { brique: 'seulement_avec', force: 2, params: { avec_veterinaire_id: B, creneaux: ['weekend'] } },
    } as ContrainteEngine
    const vets = normaliserContraintesVets([
      base(A, 'Antoine', [cSA]),
      base(B, 'Victor', []),
      base(C, 'Chloé', []),
      base('vD', 'Diane', []),
    ])
    const input = {
      dateDebut: '2026-11-02', dateFin: '2026-11-29', saison: 'hiver' as const,
      vets, bonusMalus: {},
    }
    const res = genererPlanningPur(input)
    expect(res.success).toBe(true)
    const planning = res.success ? res.planning : res.planningPartiel
    // Le validateur indépendant ne relève aucune violation SEULEMENT_AVEC.
    expect(validerPlanning(planning, input).some((x) => x.regle === 'SEULEMENT_AVEC')).toBe(false)
    // Et concrètement : chaque week-end où A est présent contient aussi B.
    for (const at of planning.attributions) {
      if (at.type !== 'weekend') continue
      const ids = at.placements.map((p) => p.vetId).filter((x): x is string => x !== null)
      if (ids.includes(A)) expect(ids).toContain(B)
    }
  })
})
