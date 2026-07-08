// ============================================================
// GUARDVETO — Vague 5 tranche C : cadencement « 1 WE sur N ancré » (#20)
// ============================================================
// Brique de RYTHME par-véto (famille `sequence`), réglable dur/mou. À NE PAS
// confondre avec espacement_weekend (un ESPACEMENT). Ici : CADENCEMENT ANCRÉ —
// les week-ends « du véto » sont ceux dont le samedi est à un multiple de N×7
// jours d'une date d'ancrage (passé OU futur : modulo signé). Deux sens :
//   • interdit (cas pompier) : les WE DU CYCLE sont interdits de garde ;
//   • impose : les gardes WE doivent tomber SUR le cycle (hors cycle = violation).
//
// Cycle CALENDAIRE STRICT (aucun recalage vacances). Jugé par rapport à l'ancre
// SEULE — la brique ne lit pas le planning (indépendante du lookback #17 par
// construction). Pour chaque cas : (1) DUR bloque isValid, (2) les WE autorisés
// passent, (3) MOU pénalise sans bloquer, (4) validateur indépendant d'accord,
// (5) cas INERTES, (6) normalisation ancre non-samedi, (7) jonction de périodes,
// (8) interaction saine avec le lookback #17.
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid, penaliteContraintesConfig } from '@/engine/rules/hard-constraints'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type {
  VetEngine, SlotGarde, PlanningPartiel, ContrainteEngine, AttributionGarde,
} from '@/engine/types'

// ── Fabrique de véto porteur d'UNE contrainte cadencement_weekend ──
function vetAvec(params: Record<string, unknown>, force: number) {
  const config: Record<string, unknown> = { brique: 'cadencement_weekend', force, params }
  const v: VetEngine = {
    id: 'v', prenom: 'Victor', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'c1', type: 'cadencement_weekend', actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

const slotWe = (date: string): SlotGarde => ({ date, type: 'weekend', saison: 'hiver', besoinSecond: true })
const slotSoir = (date: string): SlotGarde => ({ date, type: 'semaine_soir', saison: 'hiver', besoinSecond: false })

const attWe = (date: string): AttributionGarde =>
  ({ date, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] })

// Ancre = samedi 2026-09-05. Cycle 1 sur 3 → les samedis DU cycle :
//   … 2026-08-15, 2026-08-22(non), 2026-08-29(non), 2026-09-05, 09-12(non),
//   09-19(non), 09-26, 10-17, …  (multiples de 21 jours autour de l'ancre)
const ANCRE = '2026-09-05'
const WE_SUR_CYCLE = '2026-09-26'      // 21 jours après l'ancre → sur le cycle
const WE_HORS_CYCLE = '2026-09-12'     // 7 jours après → hors cycle
const WE_SUR_CYCLE_PASSE = '2026-08-15' // 21 jours AVANT l'ancre → sur le cycle (modulo signé)
const empty: PlanningPartiel = { attributions: [] }

// ════════════════════════════════════════════════════════════
describe('cadencement_weekend — sens « interdit » (cas pompier)', () => {
  const params = { n_semaines: 3, ancre: ANCRE, sens: 'interdit' }

  it('DUR : refuse une garde WE tombant SUR le cycle', () => {
    const v = vetAvec(params, 2)
    const r = isValid(slotWe(WE_SUR_CYCLE), v, 'premier', [v], empty)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/CADENCE_WE/)
  })

  it('DUR : autorise une garde WE HORS du cycle', () => {
    const v = vetAvec(params, 2)
    expect(isValid(slotWe(WE_HORS_CYCLE), v, 'premier', [v], empty).valid).toBe(true)
  })

  it('modulo SIGNÉ : un WE 21 jours AVANT l\'ancre est aussi sur le cycle', () => {
    const v = vetAvec(params, 2)
    expect(isValid(slotWe(WE_SUR_CYCLE_PASSE), v, 'premier', [v], empty).valid).toBe(false)
  })

  it('ne s\'applique QU\'aux week-ends : un soir de semaine passe toujours', () => {
    const v = vetAvec(params, 2)
    // Même un soir de semaine "dans" la semaine du cycle n'est pas concerné.
    expect(isValid(slotSoir('2026-09-24'), v, 'premier', [v], empty).valid).toBe(true)
  })

  it('MOU (étage 4) : n\'empêche pas mais pénalise', () => {
    const v = vetAvec(params, 4)
    expect(isValid(slotWe(WE_SUR_CYCLE), v, 'premier', [v], empty).valid).toBe(true)
    expect(penaliteContraintesConfig(slotWe(WE_SUR_CYCLE), v, 'premier', empty)).toBeGreaterThan(0)
  })

  it('validateur indépendant : signale un WE sur cycle en DUR, se tait en MOU', () => {
    const input = { dateDebut: '2026-09-01', dateFin: '2026-09-30', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const planning: PlanningPartiel = { attributions: [attWe(WE_SUR_CYCLE)] }
    const vDur = vetAvec(params, 2)
    const vDoux = vetAvec(params, 4)
    expect(validerPlanning(planning, { ...input, vets: [vDur] }).some((x) => x.regle === 'CADENCE_WE')).toBe(true)
    expect(validerPlanning(planning, { ...input, vets: [vDoux] }).some((x) => x.regle === 'CADENCE_WE')).toBe(false)
  })

  it('validateur indépendant : un WE hors cycle ne déclenche rien', () => {
    const input = { dateDebut: '2026-09-01', dateFin: '2026-09-30', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const planning: PlanningPartiel = { attributions: [attWe(WE_HORS_CYCLE)] }
    const v = vetAvec(params, 2)
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'CADENCE_WE')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
describe('cadencement_weekend — sens « impose »', () => {
  const params = { n_semaines: 3, ancre: ANCRE, sens: 'impose' }

  it('DUR : autorise une garde WE SUR le cycle', () => {
    const v = vetAvec(params, 2)
    expect(isValid(slotWe(WE_SUR_CYCLE), v, 'premier', [v], empty).valid).toBe(true)
  })

  it('DUR : refuse une garde WE HORS du cycle', () => {
    const v = vetAvec(params, 2)
    const r = isValid(slotWe(WE_HORS_CYCLE), v, 'premier', [v], empty)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/CADENCE_WE/)
  })

  it('n\'oblige PAS à poser une garde à chaque WE du cycle (filtre de position)', () => {
    // Un planning où le véto n'a AUCUNE garde WE ne viole jamais « impose ».
    const input = { dateDebut: '2026-09-01', dateFin: '2026-09-30', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const v = vetAvec(params, 2)
    // Planning vide de gardes du véto → 0 violation (pas d'obligation de présence).
    expect(validerPlanning({ attributions: [] }, { ...input, vets: [v] })
      .some((x) => x.regle === 'CADENCE_WE')).toBe(false)
  })

  it('validateur indépendant : signale un WE hors cycle en DUR', () => {
    const input = { dateDebut: '2026-09-01', dateFin: '2026-09-30', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const planning: PlanningPartiel = { attributions: [attWe(WE_HORS_CYCLE)] }
    const v = vetAvec(params, 2)
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'CADENCE_WE')).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════
describe('cadencement_weekend — cas INERTES (jamais de crash, jamais de blocage)', () => {
  it('n < 2 → inerte', () => {
    const v = vetAvec({ n_semaines: 1, ancre: ANCRE, sens: 'interdit' }, 2)
    expect(isValid(slotWe(WE_SUR_CYCLE), v, 'premier', [v], empty).valid).toBe(true)
  })

  it('ancre non-date → inerte', () => {
    const v = vetAvec({ n_semaines: 3, ancre: 'pas-une-date', sens: 'interdit' }, 2)
    expect(isValid(slotWe(WE_SUR_CYCLE), v, 'premier', [v], empty).valid).toBe(true)
  })

  it('sens inconnu → inerte', () => {
    const v = vetAvec({ n_semaines: 3, ancre: ANCRE, sens: 'bidon' }, 2)
    expect(isValid(slotWe(WE_SUR_CYCLE), v, 'premier', [v], empty).valid).toBe(true)
  })

  it('validateur indépendant : idem, aucune violation sur config inerte', () => {
    const input = { dateDebut: '2026-09-01', dateFin: '2026-09-30', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const planning: PlanningPartiel = { attributions: [attWe(WE_SUR_CYCLE)] }
    const v = vetAvec({ n_semaines: 1, ancre: ANCRE, sens: 'interdit' }, 2)
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'CADENCE_WE')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
describe('cadencement_weekend — normalisation de l\'ancre non-samedi', () => {
  // Ancre saisie un MERCREDI (2026-09-09) : elle doit être ramenée au samedi de
  // SA semaine (2026-09-12) → le cycle se cale sur 09-12, PAS sur 09-05.
  const params = { n_semaines: 3, ancre: '2026-09-09', sens: 'interdit' }

  it('DUR : le cycle se cale sur le samedi de la semaine de l\'ancre (09-12)', () => {
    const v = vetAvec(params, 2)
    // 09-12 est le samedi de la semaine de l'ancre → sur le cycle → interdit.
    expect(isValid(slotWe('2026-09-12'), v, 'premier', [v], empty).valid).toBe(false)
    // 09-05 est UNE semaine avant → hors cycle → autorisé.
    expect(isValid(slotWe('2026-09-05'), v, 'premier', [v], empty).valid).toBe(true)
    // 10-03 = 21 jours après 09-12 → sur le cycle → interdit.
    expect(isValid(slotWe('2026-10-03'), v, 'premier', [v], empty).valid).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
describe('cadencement_weekend — cycle traversant une jonction de périodes', () => {
  // L'ancre est dans la période PRÉCÉDENTE (2026-08-15), la nouvelle période
  // commence en septembre : la PHASE reste correcte par ancrage ABSOLU, sans
  // avoir besoin du lookback (c'est l'intérêt de l'ancre sur date absolue).
  const params = { n_semaines: 3, ancre: WE_SUR_CYCLE_PASSE, sens: 'interdit' }

  it('la phase reste correcte à travers la jonction (ancre en période précédente)', () => {
    const v = vetAvec(params, 2)
    // 09-05 = 21 jours après l'ancre 08-15 → sur le cycle → interdit.
    expect(isValid(slotWe('2026-09-05'), v, 'premier', [v], empty).valid).toBe(false)
    // 09-26 = 42 jours après → sur le cycle → interdit.
    expect(isValid(slotWe('2026-09-26'), v, 'premier', [v], empty).valid).toBe(false)
    // 09-12 = hors cycle → autorisé.
    expect(isValid(slotWe('2026-09-12'), v, 'premier', [v], empty).valid).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════
describe('cadencement_weekend — interaction saine avec le lookback #17', () => {
  // La brique juge le SLOT candidat par rapport à l'ancre, PAS par rapport aux
  // autres gardes : la présence d'un contexteAnterieur ne doit RIEN changer.
  const params = { n_semaines: 3, ancre: ANCRE, sens: 'interdit' }
  const contexteAnterieur: AttributionGarde[] = [attWe('2026-08-29')]

  it('le verdict est identique avec ou sans contexteAnterieur', () => {
    const v = vetAvec(params, 2)
    const sansLookback = isValid(slotWe(WE_SUR_CYCLE), v, 'premier', [v], empty).valid
    const avecLookback = isValid(slotWe(WE_SUR_CYCLE), v, 'premier', [v], empty, undefined, undefined, contexteAnterieur).valid
    expect(sansLookback).toBe(false)
    expect(avecLookback).toBe(false)
    // WE hors cycle : autorisé dans les deux cas.
    expect(isValid(slotWe(WE_HORS_CYCLE), v, 'premier', [v], empty).valid).toBe(true)
    expect(isValid(slotWe(WE_HORS_CYCLE), v, 'premier', [v], empty, undefined, undefined, contexteAnterieur).valid).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════
describe('byte-identique : sans règle de cette brique, aucun comportement ne change', () => {
  it('un véto sans cadencement passe tous les week-ends', () => {
    const v = normaliserContraintesVets([{
      id: 'v', prenom: 'Victor', nom: 'X', statut: 'associe', dernier_recours: false,
      conges: [], contraintes: [],
    }])[0]
    expect(isValid(slotWe(WE_SUR_CYCLE), v, 'premier', [v], empty).valid).toBe(true)
    expect(isValid(slotWe(WE_HORS_CYCLE), v, 'premier', [v], empty).valid).toBe(true)
    expect(penaliteContraintesConfig(slotWe(WE_SUR_CYCLE), v, 'premier', empty)).toBe(0)
  })
})
