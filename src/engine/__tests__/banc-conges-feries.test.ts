// ============================================================
// GUARDVETO — 2e banc d'essai : congés posés + jours fériés (Lot 1 — Tâche C)
// ============================================================
// Le golden pilote ne stresse NI les congés NI les fériés. Ce banc complète le
// filet : plusieurs scénarios pilote où des vétos ont des CONGÉS et où la
// période contient des JOURS FÉRIÉS. Pour chaque scénario :
//   • genererPlanningPur doit RÉUSSIR (planning complet)
//   • validerPlanning (validateur INDÉPENDANT) doit renvoyer 0 violation DURE
//     — y compris R16 (aucune garde sur un congé).
// Plus un scénario de DÉTERMINISME sous congés/fériés (2 runs identiques).
//
// On reste sur le seed greedy (lnsTimeoutMs: 0) pour la reproductibilité des
// assertions, SAUF le test de déterminisme dédié qui exerce le LNS par défaut.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur } from '../solver'
import { validerPlanning } from '../validation/validerPlanning'
import type { SolverInput } from '../solver'
import type { PlanningPartiel, VetEngine, CongeEngine } from '../types'
import { VETS_PILOTE, PERIODE_PILOTE, CALENDRIER_PILOTE, VET } from './fixtures-pilote'

// ── Fériés plausibles DANS la fenêtre pilote (jan→mars 2026) ──
// Tous des jeudis = créneaux semaine_soir (ne cassent pas la couverture WE).
const FERIES_PILOTE = ['2026-01-15', '2026-02-26', '2026-03-19']

// ── Congés posés (modérés pour préserver la faisabilité à 7 vétos) ──
// Manon part 1 semaine ; Victor pose un long week-end. Aucun congé sur
// Anne-Catherine (dernier recours) ni saturation simultanée.
const CONGE_MANON: CongeEngine = { date_debut: '2026-02-09', date_fin: '2026-02-15', type: 'vacances' }
const CONGE_VICTOR: CongeEngine = { date_debut: '2026-03-12', date_fin: '2026-03-15', type: 'vacances' }
const CONGE_JEAN: CongeEngine = { date_debut: '2026-01-19', date_fin: '2026-01-22', type: 'formation' }

/** Pose des congés sur des vétos ciblés (par id) sans toucher au reste. */
function avecConges(
  congesParVet: Partial<Record<string, CongeEngine[]>>,
): VetEngine[] {
  return VETS_PILOTE.map((v) => ({
    ...v,
    contraintes: v.contraintes.map((c) => ({ ...c })),
    conges: congesParVet[v.id] ? [...(congesParVet[v.id] as CongeEngine[])] : [...v.conges],
  })) as VetEngine[]
}

function makeInput(
  vets: VetEngine[],
  feries: string[],
  lnsTimeoutMs: number | undefined = 0,
): SolverInput {
  return {
    dateDebut: PERIODE_PILOTE.dateDebut,
    dateFin: PERIODE_PILOTE.dateFin,
    saison: PERIODE_PILOTE.saison,
    vets,
    bonusMalus: {},
    calendrier: {
      feries: new Set(feries),
      vacancesScolaires: CALENDRIER_PILOTE.vacancesScolaires.map((v) => ({ ...v })),
    },
    lnsTimeoutMs,
  }
}

function validationInput(input: SolverInput) {
  return {
    dateDebut: input.dateDebut,
    dateFin: input.dateFin,
    saison: input.saison,
    vets: input.vets,
    calendrier: input.calendrier,
  }
}

function empreinte(planning: PlanningPartiel): string {
  return JSON.stringify(
    [...planning.attributions]
      .sort((a, b) =>
        a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date),
      )
      .map((a) => `${a.date}|${a.type}|${a.placements.map((p) => p.vetId ?? '-').join('|')}`),
  )
}

const TEST_TIMEOUT = 60_000

describe('Banc congés + fériés — faisabilité + 0 violation dure', () => {
  it('Scénario 1 — fériés seuls (aucun congé) : faisable, 0 violation', () => {
    const input = makeInput(avecConges({}), FERIES_PILOTE)
    const res = genererPlanningPur(input)
    expect(res.success, 'planning doit réussir avec fériés').toBe(true)
    if (!res.success) return
    const violations = validerPlanning(res.planning, validationInput(input))
    expect(
      violations,
      `violations : ${violations.map((v) => `${v.regle}@${v.date}`).join(', ')}`,
    ).toEqual([])
  }, TEST_TIMEOUT)

  it('Scénario 2 — congé d’une semaine (Manon) + fériés : faisable, 0 violation, Manon absente sur son congé', () => {
    const input = makeInput(avecConges({ [VET.manon]: [CONGE_MANON] }), FERIES_PILOTE)
    const res = genererPlanningPur(input)
    expect(res.success).toBe(true)
    if (!res.success) return

    const violations = validerPlanning(res.planning, validationInput(input))
    expect(
      violations,
      `violations : ${violations.map((v) => `${v.regle}@${v.date}`).join(', ')}`,
    ).toEqual([])

    // Faits directs : Manon n'apparaît sur AUCUN créneau de son congé.
    const fautes = res.planning.attributions.filter(
      (a) =>
        a.placements.some((p) => p.vetId === VET.manon) &&
        a.date >= CONGE_MANON.date_debut &&
        a.date <= CONGE_MANON.date_fin,
    )
    expect(fautes, `Manon de garde sur son congé : ${fautes.map((a) => a.date).join(', ')}`).toEqual([])
  }, TEST_TIMEOUT)

  it('Scénario 3 — plusieurs vétos en congé (Manon + Victor + Jean) + fériés : faisable, 0 violation', () => {
    const input = makeInput(
      avecConges({
        [VET.manon]: [CONGE_MANON],
        [VET.victor]: [CONGE_VICTOR],
        [VET.jean]: [CONGE_JEAN],
      }),
      FERIES_PILOTE,
    )
    const res = genererPlanningPur(input)
    expect(res.success, 'planning doit rester faisable avec 3 congés étalés').toBe(true)
    if (!res.success) return

    const violations = validerPlanning(res.planning, validationInput(input))
    expect(
      violations,
      `violations : ${violations.map((v) => `${v.regle}@${v.date}`).join(', ')}`,
    ).toEqual([])

    // Aucun véto en congé n'est de garde pendant son congé (R16, faits directs).
    const congesParVet: Record<string, CongeEngine> = {
      [VET.manon]: CONGE_MANON,
      [VET.victor]: CONGE_VICTOR,
      [VET.jean]: CONGE_JEAN,
    }
    for (const [vetId, conge] of Object.entries(congesParVet)) {
      const fautes = res.planning.attributions.filter(
        (a) =>
          a.placements.some((p) => p.vetId === vetId) &&
          a.date >= conge.date_debut &&
          a.date <= conge.date_fin,
      )
      expect(fautes, `${vetId} de garde sur son congé : ${fautes.map((a) => a.date).join(', ')}`).toEqual([])
    }
  }, TEST_TIMEOUT)

  it('Scénario 4 — congé couvrant un jour férié (Jean en formation autour du 15/01) : faisable, 0 violation', () => {
    // Le congé de Jean (19→22 jan) n'englobe pas le férié du 15 ; on teste ici
    // un congé qui CHEVAUCHE un férié pour exercer l'intersection congé×férié.
    const congeFerie: CongeEngine = { date_debut: '2026-01-12', date_fin: '2026-01-16', type: 'vacances' }
    const input = makeInput(avecConges({ [VET.victor]: [congeFerie] }), FERIES_PILOTE)
    const res = genererPlanningPur(input)
    expect(res.success).toBe(true)
    if (!res.success) return
    const violations = validerPlanning(res.planning, validationInput(input))
    expect(
      violations,
      `violations : ${violations.map((v) => `${v.regle}@${v.date}`).join(', ')}`,
    ).toEqual([])
  }, TEST_TIMEOUT)

  it('Scénario 5 — DÉTERMINISME sous congés + fériés (LNS par défaut) : 2 runs identiques', () => {
    // LNS actif (lnsTimeoutMs undefined) → exerce le critère d'arrêt déterministe
    // ajouté en Dette B, sous la charge congés+fériés.
    const mk = () =>
      makeInput(
        avecConges({ [VET.manon]: [CONGE_MANON], [VET.victor]: [CONGE_VICTOR] }),
        FERIES_PILOTE,
        undefined,
      )
    const r1 = genererPlanningPur(mk())
    const r2 = genererPlanningPur(mk())
    expect(r1.success && r2.success).toBe(true)
    if (!r1.success || !r2.success) return
    expect(empreinte(r1.planning)).toBe(empreinte(r2.planning))

    // Et toujours 0 violation dure sur le résultat optimisé par le LNS.
    const violations = validerPlanning(r1.planning, validationInput(mk()))
    expect(
      violations,
      `violations (LNS) : ${violations.map((v) => `${v.regle}@${v.date}`).join(', ')}`,
    ).toEqual([])
  }, TEST_TIMEOUT)
})
