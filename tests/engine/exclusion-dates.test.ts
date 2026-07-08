// ============================================================
// GUARDVETO — Vague 6 tranche B : exclusion de dates / XOR « pas les deux » (#15a)
// ============================================================
// Brique PAR-VÉTO (famille `interdire`), réglable dur/mou. Sémantique FIGÉE :
// « pas les DEUX » — le véto ne peut pas couvrir À LA FOIS les deux cibles
// (jamais « exactement une » : on n'oblige personne à en faire une). Deux
// formes (une seule par règle) : `fetes` (paire de codes fête, une instance
// par année couverte) ou `dates` (paire de dates ISO explicites). Le piège
// week-end (slot daté du samedi couvrant sam+dim) est testé des deux côtés.
//
// Pour chaque forme : (1) DUR bloque isValid quand l'autre cible est déjà posée,
// (2) le candidat seul (sans l'autre cible) passe, (3) MOU pénalise sans bloquer,
// (4) validateur indépendant d'accord (violation à la main / pas de fantôme),
// (5) cas INERTES, (6) byte-identique sans règle, (7) solve bout en bout.
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid, penaliteContraintesConfig } from '@/engine/rules/hard-constraints'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type {
  VetEngine, SlotGarde, PlanningPartiel, ContrainteEngine, AttributionGarde,
} from '@/engine/types'

// ── Fabrique de véto porteur d'UNE contrainte exclusion_dates ──
function vetAvec(params: Record<string, unknown>, force: number) {
  const config: Record<string, unknown> = { brique: 'exclusion_dates', force, params }
  const v: VetEngine = {
    id: 'v', prenom: 'Manon', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'c1', type: 'exclusion_dates', actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

const slotSoir = (date: string): SlotGarde => ({ date, type: 'semaine_soir', saison: 'hiver', besoinSecond: false })
const slotWe = (date: string): SlotGarde => ({ date, type: 'weekend', saison: 'hiver', besoinSecond: true })

const attSoir = (date: string): AttributionGarde =>
  ({ date, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }] })
const attWe = (date: string): AttributionGarde =>
  ({ date, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] })

const empty: PlanningPartiel = { attributions: [] }

// ════════════════════════════════════════════════════════════
// Forme FÊTES — « pas Noël ET Nouvel An la même année »
// Noël = 24/25 déc ; Nouvel An = 31 déc + 1er janv (année du décembre).
// ════════════════════════════════════════════════════════════
describe('exclusion_dates — forme FÊTES (dur)', () => {
  const params = { fetes: ['noel', 'nouvel_an'] }

  it('DUR : si déjà de garde le 24 déc, refuse le 31 déc (même année)', () => {
    const v = vetAvec(params, 2)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-12-24')] }
    const r = isValid(slotSoir('2026-12-31'), v, 'premier', [v], planning)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/XOR_DATES/)
  })

  it('DUR : réciproque — si déjà le 31 déc, refuse le 24 déc', () => {
    const v = vetAvec(params, 2)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-12-31')] }
    expect(isValid(slotSoir('2026-12-24'), v, 'premier', [v], planning).valid).toBe(false)
  })

  it('DUR : le 1er janvier compte comme Nouvel An de l\'année du décembre (N-1)', () => {
    // Nouvel An 2026 = 31 déc 2026 + 1er janv 2027. Un véto déjà de garde le
    // 24 déc 2026 (Noël 2026) ne peut pas prendre le 1er janv 2027.
    const v = vetAvec(params, 2)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-12-24')] }
    expect(isValid(slotSoir('2027-01-01'), v, 'premier', [v], planning).valid).toBe(false)
  })

  it('DUR : le candidat SEUL passe (une seule fête = autorisé)', () => {
    const v = vetAvec(params, 2)
    // Rien de posé → le 24 déc seul est autorisé.
    expect(isValid(slotSoir('2026-12-24'), v, 'premier', [v], empty).valid).toBe(true)
  })

  it('DUR : deux ANNÉES différentes ne sont pas exclusives', () => {
    // Noël 2025 déjà posé, Nouvel An 2026 candidat → PAS le même XOR.
    const v = vetAvec(params, 2)
    const planning: PlanningPartiel = { attributions: [attSoir('2025-12-24')] }
    expect(isValid(slotSoir('2026-12-31'), v, 'premier', [v], planning).valid).toBe(true)
  })

  it('DUR : piège week-end — un WE couvrant le dimanche 25 déc bloque le 31', () => {
    // Le WE daté du samedi 2027-12-25 ? Non : prenons 2027. Utilisons un WE dont
    // le dimanche est le 25/12. Samedi = 24/12/2033 est un samedi ; on reste
    // simple : un WE daté du samedi 25 déc couvre 25(sam) + 26(dim). Testons le
    // dimanche via un WE daté du samedi 24 déc → couvre 24(sam) + 25(dim) = Noël.
    const v = vetAvec(params, 2)
    // WE samedi 2027-12-25 couvre 25(sam=Noël) + 26(dim). Puis 31 déc interdit.
    const planning: PlanningPartiel = { attributions: [attWe('2027-12-25')] }
    // 2027-12-31 = Nouvel An 2027, même année que Noël 2027 → refus.
    expect(isValid(slotSoir('2027-12-31'), v, 'premier', [v], planning).valid).toBe(false)
  })

  it('MOU (étage 4) : n\'empêche pas mais pénalise', () => {
    const v = vetAvec(params, 4)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-12-24')] }
    expect(isValid(slotSoir('2026-12-31'), v, 'premier', [v], planning).valid).toBe(true)
    expect(penaliteContraintesConfig(slotSoir('2026-12-31'), v, 'premier', planning)).toBeGreaterThan(0)
  })

  it('validateur indépendant : signale les deux fêtes tenues (dur), se tait en mou', () => {
    const input = { dateDebut: '2026-12-01', dateFin: '2027-01-15', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const planning: PlanningPartiel = { attributions: [attSoir('2026-12-24'), attSoir('2026-12-31')] }
    const vDur = vetAvec(params, 2)
    const vDoux = vetAvec(params, 4)
    expect(validerPlanning(planning, { ...input, vets: [vDur] }).some((x) => x.regle === 'XOR_DATES')).toBe(true)
    expect(validerPlanning(planning, { ...input, vets: [vDoux] }).some((x) => x.regle === 'XOR_DATES')).toBe(false)
  })

  it('validateur indépendant : une seule fête tenue → aucune violation', () => {
    const input = { dateDebut: '2026-12-01', dateFin: '2027-01-15', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const planning: PlanningPartiel = { attributions: [attSoir('2026-12-24')] }
    const v = vetAvec(params, 2)
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'XOR_DATES')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
// Forme DATES libres — « pas le J1 ET le J2 »
// ════════════════════════════════════════════════════════════
describe('exclusion_dates — forme DATES libres (dur)', () => {
  const params = { dates: ['2026-07-14', '2026-08-15'] }

  it('DUR : si déjà de garde le 14 juillet, refuse le 15 août', () => {
    const v = vetAvec(params, 2)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-07-14')] }
    const r = isValid(slotSoir('2026-08-15'), v, 'premier', [v], planning)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/XOR_DATES/)
  })

  it('DUR : le candidat seul passe', () => {
    const v = vetAvec(params, 2)
    expect(isValid(slotSoir('2026-07-14'), v, 'premier', [v], empty).valid).toBe(true)
  })

  it('DUR : piège week-end — un WE daté samedi couvre le dimanche cible', () => {
    // Cible = dimanche 2026-08-16. Un WE daté du samedi 2026-08-15 couvre
    // 15(sam) + 16(dim). L'autre cible = 2026-07-14 déjà posée → refus quand on
    // pose le WE (qui couvre le 16 août, l'une des cibles).
    const v = vetAvec({ dates: ['2026-07-14', '2026-08-16'] }, 2)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-07-14')] }
    // Le slot WE 2026-08-15 couvre le dimanche 16 (cible) → conflit avec le 14/07.
    expect(isValid(slotWe('2026-08-15'), v, 'premier', [v], planning).valid).toBe(false)
  })

  it('MOU (étage 5) : pénalise sans bloquer', () => {
    const v = vetAvec(params, 5)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-07-14')] }
    expect(isValid(slotSoir('2026-08-15'), v, 'premier', [v], planning).valid).toBe(true)
    expect(penaliteContraintesConfig(slotSoir('2026-08-15'), v, 'premier', planning)).toBeGreaterThan(0)
  })

  it('validateur indépendant : détecte le cumul (dur), y compris via un WE (dimanche)', () => {
    const input = { dateDebut: '2026-07-01', dateFin: '2026-08-31', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const v = vetAvec({ dates: ['2026-07-14', '2026-08-16'] }, 2)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-07-14'), attWe('2026-08-15')] }
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'XOR_DATES')).toBe(true)
  })

  it('validateur indépendant : une seule des deux dates → aucun fantôme', () => {
    const input = { dateDebut: '2026-07-01', dateFin: '2026-08-31', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const v = vetAvec(params, 2)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-07-14')] }
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'XOR_DATES')).toBe(false)
  })

  it('DUR : un SEUL slot couvrant les deux dates est refusé à la pose (accord des deux gardiens)', () => {
    // Paire = samedi 15 août + dimanche 16 août 2026 : un unique slot `weekend`
    // daté du samedi couvre LES DEUX cibles. Le moteur doit refuser la pose
    // elle-même (planning vide), sinon le validateur — qui juge les jours
    // couverts du planning final — crierait une violation fantôme au gate.
    const v = vetAvec({ dates: ['2026-08-15', '2026-08-16'] }, 2)
    const r = isValid(slotWe('2026-08-15'), v, 'premier', [v], empty)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/XOR_DATES/)
    // Et le validateur est bien d'accord : ce même WE posé = violation.
    const input = { dateDebut: '2026-08-01', dateFin: '2026-08-31', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const planning: PlanningPartiel = { attributions: [attWe('2026-08-15')] }
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'XOR_DATES')).toBe(true)
  })
})

// ════════════════════════════════════════════════════════════
// Cas INERTES — jamais de crash, jamais de blocage
// ════════════════════════════════════════════════════════════
describe('exclusion_dates — cas INERTES', () => {
  const planningDeuxFetes: PlanningPartiel = { attributions: [attSoir('2026-12-24')] }

  it('paire de fêtes IDENTIQUE → inerte', () => {
    const v = vetAvec({ fetes: ['noel', 'noel'] }, 2)
    expect(isValid(slotSoir('2026-12-31'), v, 'premier', [v], planningDeuxFetes).valid).toBe(true)
  })

  it('date invalide → inerte', () => {
    const v = vetAvec({ dates: ['2026-07-14', 'pas-une-date'] }, 2)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-07-14')] }
    expect(isValid(slotSoir('2026-08-15'), v, 'premier', [v], planning).valid).toBe(true)
  })

  it('dates identiques → inerte (validateur : aucune violation)', () => {
    // Paire identique = pas un vrai XOR. Un véto de garde sur cette date (une
    // seule fois, R22 empêchant deux gardes/jour) ne doit JAMAIS être signalé.
    const input = { dateDebut: '2026-07-01', dateFin: '2026-07-31', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const v = vetAvec({ dates: ['2026-07-14', '2026-07-14'] }, 2)
    const planning: PlanningPartiel = { attributions: [attSoir('2026-07-14')] }
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'XOR_DATES')).toBe(false)
  })

  it('forme ABSENTE (ni fetes ni dates) → inerte', () => {
    const v = vetAvec({}, 2)
    expect(isValid(slotSoir('2026-12-31'), v, 'premier', [v], planningDeuxFetes).valid).toBe(true)
  })

  it('validateur indépendant : config inerte → aucune violation', () => {
    const input = { dateDebut: '2026-12-01', dateFin: '2027-01-15', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const planning: PlanningPartiel = { attributions: [attSoir('2026-12-24'), attSoir('2026-12-31')] }
    const v = vetAvec({ fetes: ['noel', 'noel'] }, 2)
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'XOR_DATES')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
// Byte-identique : sans règle de cette brique, rien ne change
// ════════════════════════════════════════════════════════════
describe('exclusion_dates — byte-identique sans règle', () => {
  it('un véto sans exclusion peut cumuler les deux dates', () => {
    const v = normaliserContraintesVets([{
      id: 'v', prenom: 'Manon', nom: 'X', statut: 'associe', dernier_recours: false,
      conges: [], contraintes: [],
    }])[0]
    const planning: PlanningPartiel = { attributions: [attSoir('2026-12-24')] }
    expect(isValid(slotSoir('2026-12-31'), v, 'premier', [v], planning).valid).toBe(true)
    expect(penaliteContraintesConfig(slotSoir('2026-12-31'), v, 'premier', planning)).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════
// Bout en bout : un solve avec la règle dure respecte le XOR
// ════════════════════════════════════════════════════════════
describe('exclusion_dates — bout en bout (solve → validateur)', () => {
  it('un solve produit un planning où le validateur ne trouve aucun XOR_DATES', async () => {
    const { genererPlanningPur } = await import('@/engine/solver')
    // 3 vétos, une règle DURE « pas Noël ET Nouvel An » sur l'un d'eux.
    const base = (id: string, prenom: string, contraintes: ContrainteEngine[]): VetEngine => ({
      id, prenom, nom: 'X', statut: 'associe', dernier_recours: false, conges: [], contraintes,
    })
    const cExcl: ContrainteEngine = {
      id: 'c1', type: 'exclusion_dates', actif: true,
      config: { brique: 'exclusion_dates', force: 2, params: { fetes: ['noel', 'nouvel_an'] } },
    } as ContrainteEngine
    const vets = normaliserContraintesVets([
      base('v1', 'Manon', [cExcl]),
      base('v2', 'Antoine', []),
      base('v3', 'Victor', []),
    ])
    // dateDebut est un LUNDI (2026-12-14) ; la période couvre 24 déc + 31 déc + 1er janv.
    const input = {
      dateDebut: '2026-12-14', dateFin: '2027-01-11', saison: 'hiver' as const,
      vets, bonusMalus: {},
    }
    const res = genererPlanningPur(input)
    expect(res.success).toBe(true)
    const planning = res.success ? res.planning : res.planningPartiel
    // Le validateur indépendant ne doit relever aucune violation XOR_DATES.
    const violations = validerPlanning(planning, input)
    expect(violations.some((x) => x.regle === 'XOR_DATES')).toBe(false)
  })
})
