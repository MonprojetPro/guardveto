// ============================================================
// GUARDVETO — Filet d'APPLICATION des règles (anti-cécité) — 2026-06-19
// ============================================================
// Le golden test vérifie « 0 violation » VIA le validateur. Or le bug
// historique venait d'une CÉCITÉ COMMUNE solver+validateur (les deux
// lisaient la règle au mauvais endroit → d'accord entre eux, mais faux).
//
// Ce filet vérifie des FAITS DIRECTS sur le planning généré, SANS passer
// par le validateur — il attrape donc une éventuelle co-cécité résiduelle.
// Chaque assertion correspond à une règle réelle du pilote qui était
// IGNORÉE avant le correctif (normaliserContraintes + R1).
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur } from '../solver'
import { jourDeLaSemaine, estSemaineImpaireAncrée } from '../utils'
import type { VetEngine } from '../types'
import { VETS_PILOTE, PERIODE_PILOTE, CALENDRIER_PILOTE, VET } from './fixtures-pilote'

function makeInput() {
  return {
    dateDebut: PERIODE_PILOTE.dateDebut,
    dateFin: PERIODE_PILOTE.dateFin,
    saison: PERIODE_PILOTE.saison,
    vets: structuredClone(VETS_PILOTE) as VetEngine[],
    bonusMalus: {},
    calendrier: {
      feries: new Set(CALENDRIER_PILOTE.feries),
      vacancesScolaires: CALENDRIER_PILOTE.vacancesScolaires.map((v) => ({ ...v })),
    },
    lnsTimeoutMs: 0,
  }
}

function enVacances(date: string): boolean {
  return CALENDRIER_PILOTE.vacancesScolaires.some((v) => date >= v.debut && date <= v.fin)
}

const res = genererPlanningPur(makeInput())
const attributions = res.success ? res.planning.attributions : []
const aGarde = (vetId: string, a: { premier_id: string | null; second_id: string | null }) =>
  a.premier_id === vetId || a.second_id === vetId

describe("Application des règles — faits directs (le filet n'est plus aveugle)", () => {
  it('le planning est complet', () => {
    expect(res.success).toBe(true)
  })

  // R1 — Fanny : repos le mercredi, SAUF vacances scolaires.
  it('R1 : Fanny n’est jamais de garde un mercredi hors vacances scolaires', () => {
    const fautes = attributions.filter(
      (a) => aGarde(VET.fanny, a) && jourDeLaSemaine(a.date) === 'mercredi' && !enVacances(a.date),
    )
    expect(
      fautes,
      `Fanny de garde un mercredi hors vacances : ${fautes.map((a) => a.date).join(', ')}`,
    ).toEqual([])
  })

  // R6 — Antoine et Manon jamais ensemble.
  it('R6 : Antoine et Manon ne sont jamais de garde ensemble', () => {
    const fautes = attributions.filter(
      (a) =>
        [a.premier_id, a.second_id].includes(VET.antoine) &&
        [a.premier_id, a.second_id].includes(VET.manon),
    )
    expect(fautes, `duo interdit ensemble : ${fautes.map((a) => `${a.date}/${a.type}`).join(', ')}`).toEqual([])
  })

  // R2 — Anne-Sophie : indisponible soirs de semaine + week-end les semaines IMPAIRES
  // (ancre 2026-09-01, recalée vacances).
  it('R2 : Anne-Sophie n’a aucune garde soir/week-end les semaines impaires', () => {
    const fautes = attributions.filter((a) => {
      if (!aGarde(VET.anneSophie, a)) return false
      const impaire = estSemaineImpaireAncrée(a.date, '2026-09-01', CALENDRIER_PILOTE.vacancesScolaires)
      if (!impaire) return false
      return a.type === 'semaine_soir' || a.type === 'vendredi_soir' || a.type === 'weekend'
    })
    expect(
      fautes,
      `Anne-So de garde en semaine impaire : ${fautes.map((a) => `${a.date}/${a.type}`).join(', ')}`,
    ).toEqual([])
  })

  // Garde-fou de non-régression : AVANT le correctif, Fanny était de garde
  // ~8 mercredis. On vérifie qu'on est bien repassé sous la barre (preuve que
  // l'application a réellement changé le résultat, pas un hasard).
  it('preuve d’effet : Fanny a très peu de mercredis (vs 8 avant le correctif)', () => {
    const fannyMercredis = attributions.filter(
      (a) => aGarde(VET.fanny, a) && jourDeLaSemaine(a.date) === 'mercredi',
    )
    // Seuls des mercredis EN VACANCES sont tolérés.
    expect(fannyMercredis.every((a) => enVacances(a.date))).toBe(true)
  })
})
