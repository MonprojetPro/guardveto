// ============================================================
// GUARDVETO — Golden test du cabinet pilote (filet de sécurité P1-A)
// ============================================================
// Recrée le filet de non-régression disparu avec les bancs d'essai.
// Génère un planning pour le pilote (7 vétos, 10 règles réelles, hiver
// 12 sem) et garantit :
//   1. le solver trouve une solution complète,
//   2. ZÉRO violation de contrainte DURE (validateur indépendant),
//   3. le résultat est DÉTERMINISTE (même entrée → même planning).
//
// Ce test est le GATE de P1A-004 : quand le moteur basculera de
// contraintes_veto vers regles_cabinet, ce planning doit rester valide.
//
// HISTORIQUE DES DEUX DETTES (Lot 1 — RÉSOLUES le 2026-06-24) :
//   (a) « genererPlanningPur MUTE son input » → FAUX après normaliserContraintes
//       devenue pure. Prouvé par mutation-sonde.test.ts (deep equal avant/après,
//       seed ET LNS). Le structuredClone défensif de makeInput a donc été RETIRÉ.
//   (b) « le LNS tourne sous budget de TEMPS → non déterministe » → CORRIGÉ :
//       le critère d'arrêt par défaut est désormais déterministe (convergence +
//       plafond de passes lnsMaxPasses), plus aucune coupe au chrono par défaut.
//       On garde quand même lnsTimeoutMs: 0 ici (= seed greedy seul) : ce filet
//       cible la BASCULE des règles (P1A-004), pas l'optimisation d'équité (LNS).
//   NB : le seed greedy prend ~3 s sur 12 semaines → timeout par test allongé
//        (TEST_TIMEOUT) pour les tests qui génèrent deux fois.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur } from '../solver'
import { validerPlanning } from '../validation/validerPlanning'
import type { PlanningPartiel, VetEngine } from '../types'
import { VETS_PILOTE, PERIODE_PILOTE, CALENDRIER_PILOTE } from './fixtures-pilote'

/**
 * Input pilote. Plus de structuredClone défensif : genererPlanningPur ne mute
 * pas son input (dette a close, prouvé par mutation-sonde.test.ts). On crée
 * tout de même des objets frais (Set/tableaux neufs) pour l'isolation des tests.
 */
function makeInput() {
  return {
    dateDebut: PERIODE_PILOTE.dateDebut,
    dateFin: PERIODE_PILOTE.dateFin,
    saison: PERIODE_PILOTE.saison,
    vets: VETS_PILOTE as VetEngine[],
    bonusMalus: {},
    calendrier: {
      feries: new Set(CALENDRIER_PILOTE.feries),
      vacancesScolaires: CALENDRIER_PILOTE.vacancesScolaires.map((v) => ({ ...v })),
    },
    lnsTimeoutMs: 0, // seed greedy seul (le LNS n'est pas l'objet de ce filet)
  }
}

/** Empreinte stable d'un planning : attributions triées + sérialisées. */
function empreinte(planning: PlanningPartiel): string {
  return JSON.stringify(
    [...planning.attributions]
      .sort((a, b) =>
        a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date)
      )
      .map((a) => `${a.date}|${a.type}|${a.premier_id ?? '-'}|${a.second_id ?? '-'}`)
  )
}

// Le seed greedy prend ~3 s sur 12 semaines ; les tests à deux générations
// dépasseraient le timeout vitest par défaut (5 s).
const TEST_TIMEOUT = 30_000

describe('Golden test pilote (filet P1-A)', () => {
  it('génère un planning complet pour le pilote', () => {
    const res = genererPlanningPur(makeInput())
    expect(res.success, 'le solver doit trouver une solution complète pour le pilote').toBe(true)
  }, TEST_TIMEOUT)

  it('produit ZÉRO violation de contrainte dure', () => {
    const input = makeInput()
    const res = genererPlanningPur(input)
    expect(res.success).toBe(true)
    if (!res.success) return

    const violations = validerPlanning(res.planning, {
      dateDebut: input.dateDebut,
      dateFin: input.dateFin,
      saison: input.saison,
      vets: input.vets,
      calendrier: input.calendrier,
    })

    expect(
      violations,
      `planning pilote invalide : ${violations.map((v) => `${v.regle}@${v.date}`).join(', ')}`
    ).toEqual([])
  }, TEST_TIMEOUT)

  it('est déterministe : deux générations → planning identique (seed greedy)', () => {
    const r1 = genererPlanningPur(makeInput())
    const r2 = genererPlanningPur(makeInput())
    expect(r1.success && r2.success).toBe(true)
    if (!r1.success || !r2.success) return
    expect(empreinte(r1.planning)).toBe(empreinte(r2.planning))
  }, TEST_TIMEOUT)
})
