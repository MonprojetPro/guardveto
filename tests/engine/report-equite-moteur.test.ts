// ============================================================
// GUARDVETO — Le report d'équité traverse LES TROIS juges (B-196 lot 0)
// ============================================================
// Le grand livre lui-même est prouvé dans `grand-livre-equite.test.ts`,
// sur les vrais bilans du Val d'Allier. Ici on prouve ce qu'il devient
// une fois dans le moteur — et surtout qu'aucun des trois juges ne
// l'ignore, puisque c'est la panne qu'on répare :
//
//   ① le PREMIER JET (`scorerCandidat`) : il ne voyait le report que
//      sur les week-ends ;
//   ② la PHASE D'AMÉLIORATION (`scorerCandidatLNS`) : elle l'ignorait
//      complètement et pouvait défaire le rattrapage ;
//   ③ le SCORE FINAL (`scorerPlanning`) : il l'ignorait aussi, donc il
//      acceptait sans broncher une amélioration qui creusait la dette.
//
// ⚠️ « Un grep prouve qu'un code est ÉCRIT, jamais qu'il est APPELÉ » :
// chaque test ci-dessous mesure une SORTIE (un score, un planning), pas
// la présence d'un paramètre.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, scorerCandidatLNS, type SolverInput, type SolverStep } from '@/engine/solver'
import { scorerPlanning, Etage } from '@/engine/score-lexicographique'
import type { VetEngine, VetEngineNormalise, PlanningPartiel } from '@/engine/types'
import { estAttribue } from '@/engine/attribution'
import { DEFAULT_EQUITY_WEIGHTS } from '@/engine/equity-weights'
import type { ReportEquiteMap } from '@/engine/grand-livre-equite'

// ── Une équipe minimale, sans aucune règle ───────────────
// Trois vétos interchangeables : tout écart de traitement entre eux ne
// peut venir QUE du report. C'est ce qui rend la mesure lisible.
//
// ⚠️ TROIS, ET PAS DEUX. Écrit d'abord avec deux vétos, le test des
// week-ends échouait en annonçant 4 contre 4 : un week-end d'été a DEUX
// places, donc à deux vétos ils y sont tous les deux, tous les samedis.
// Aucun arbitrage n'était possible — le report n'avait rien à changer,
// et le test mesurait l'absence de choix, pas l'absence d'effet.

function vet(id: string, statut: 'associe' | 'salarie' = 'associe'): VetEngine {
  return {
    id,
    nom: id.toUpperCase(),
    prenom: id,
    statut,
    dernier_recours: false,
    tags: [],
    contraintes: [],
    conges: [],
  } as unknown as VetEngine
}

const ALEX = vet('alex')
const BOB = vet('bob')
const CHLOE = vet('chloe')
const EQUIPE = [ALEX, BOB, CHLOE]

/** 4 semaines d'été : un seul véto par soir, les week-ends se comptent bien. */
const PERIODE = { dateDebut: '2026-06-01', dateFin: '2026-06-28', saison: 'ete' as const }

function input(reportEquite: ReportEquiteMap): SolverInput {
  return {
    dateDebut: PERIODE.dateDebut,
    dateFin: PERIODE.dateFin,
    saison: PERIODE.saison,
    vets: EQUIPE,
    reportEquite,
    lnsTimeoutMs: 0, // premier jet seul : on isole le juge ①
  }
}

function compter(planning: PlanningPartiel, vetId: string, type?: string): number {
  return planning.attributions.filter(
    (a) => estAttribue(a, vetId) && (type === undefined || a.type === type),
  ).length
}

/**
 * Génère et EXIGE un succès.
 *
 * Un `if (!r.success) return` laisse un test passer en vert quand la
 * génération échoue : il ne teste alors plus rien. Ici, une impasse est un
 * échec de test, pas une sortie discrète.
 */
function genererOuEchouer(report: ReportEquiteMap): PlanningPartiel {
  const r = genererPlanningPur(input(report))
  if (!r.success) throw new Error('la génération a échoué, le test ne peut rien mesurer')
  return r.planning
}

// ============================================================
// ① LE PREMIER JET
// ============================================================

describe('Report d’équité — ① le premier jet', () => {
  it('sans report, les vétos se partagent les week-ends à égalité', () => {
    const p = genererOuEchouer({})
    const ecart = Math.abs(compter(p, 'alex', 'weekend') - compter(p, 'bob', 'weekend'))
    expect(ecart).toBeLessThanOrEqual(1)
  })

  it('avec une dette de week-ends, celui qui a trop donné en reçoit MOINS', () => {
    // Alex doit faire moins (report négatif), Bob doit faire plus.
    const p = genererOuEchouer({
      alex: { we: -1, semaine: 0, feries: 0 },
      bob: { we: 1, semaine: 0, feries: 0 },
    })
    expect(compter(p, 'bob', 'weekend')).toBeGreaterThan(compter(p, 'alex', 'weekend'))
  })

  it('UNE DETTE DE SEMAINE CHANGE LE PLANNING — elle était ignorée avant', () => {
    // C'est LE défaut trouvé le 2026-11-10 : `loader.ts` ne chargeait que
    // `ecart_we`. Antoine avait +5 gardes de semaine en cumul et le moteur
    // n'en voyait aucune. Ici, seule la dimension `semaine` est renseignée :
    // si elle n'était pas lue, les deux plannings seraient identiques.
    const sansReport = genererOuEchouer({})
    const avecDette = genererOuEchouer({
      alex: { we: 0, semaine: -2, feries: 0 },
      bob: { we: 0, semaine: 2, feries: 0 },
    })

    expect(compter(avecDette, 'alex', 'semaine_soir'))
      .toBeLessThan(compter(sansReport, 'alex', 'semaine_soir'))
    expect(compter(avecDette, 'bob', 'semaine_soir'))
      .toBeGreaterThan(compter(avecDette, 'alex', 'semaine_soir'))
  })

  it('un report vide rend EXACTEMENT le planning d’avant (aucune régression)', () => {
    const a = genererOuEchouer({})
    const b = genererOuEchouer({})
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    // Et un report de zéros se comporte comme un report absent.
    const zeros = genererOuEchouer({ alex: { we: 0, semaine: 0, feries: 0 } })
    expect(JSON.stringify(zeros)).toBe(JSON.stringify(a))
  })
})

// ============================================================
// ② LA PHASE D'AMÉLIORATION
// ============================================================

describe('Report d’équité — ② la phase d’amélioration (LNS)', () => {
  const vetsN = EQUIPE as unknown as VetEngineNormalise[]
  const step: SolverStep = {
    date: '2026-06-06', type: 'weekend', saison: 'ete', role: 'premier',
    besoinSecond: false, nbPlaces: 1, rolesCreneau: ['premier'],
  } as unknown as SolverStep
  const planningVide: PlanningPartiel = { attributions: [] }

  it('elle TIENT COMPTE du report — elle l’ignorait entièrement', () => {
    const sans = scorerCandidatLNS(
      step, ALEX, planningVide, vetsN, DEFAULT_EQUITY_WEIGHTS,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    )
    const avecDette = scorerCandidatLNS(
      step, ALEX, planningVide, vetsN, DEFAULT_EQUITY_WEIGHTS,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { alex: { we: -1, semaine: 0, feries: 0 } },
    )
    // Alex a trop donné → son score MONTE → il passe après les autres.
    expect(avecDette).toBeGreaterThan(sans)
  })

  it('celui à qui on doit des gardes passe devant', () => {
    const avecCredit = scorerCandidatLNS(
      step, ALEX, planningVide, vetsN, DEFAULT_EQUITY_WEIGHTS,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { alex: { we: 1, semaine: 0, feries: 0 } },
    )
    const sans = scorerCandidatLNS(
      step, ALEX, planningVide, vetsN, DEFAULT_EQUITY_WEIGHTS,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    )
    expect(avecCredit).toBeLessThan(sans)
  })

  it('la CRISE, elle, ne reçoit pas de report — et c’est voulu', () => {
    // `reparer.ts` appelle ce scoreur sans report : remplacer quelqu'un au
    // pied levé n'est pas le moment de rembourser l'histoire. Le défaut du
    // paramètre doit donc rester neutre.
    const parDefaut = scorerCandidatLNS(
      step, ALEX, planningVide, vetsN, DEFAULT_EQUITY_WEIGHTS,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    )
    const vide = scorerCandidatLNS(
      step, ALEX, planningVide, vetsN, DEFAULT_EQUITY_WEIGHTS,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, {},
    )
    expect(parDefaut).toBe(vide)
  })
})

// ============================================================
// ③ LE SCORE FINAL — celui qui accepte ou refuse
// ============================================================

describe('Report d’équité — ③ le score final', () => {
  const vetsN = EQUIPE as unknown as VetEngineNormalise[]

  /** Un planning où Alex prend les 2 week-ends et Bob aucun. */
  const alexPrendTout: PlanningPartiel = {
    attributions: [
      { date: '2026-06-06', type: 'weekend', placements: [{ role: 'premier', vetId: 'alex' }] },
      { date: '2026-06-13', type: 'weekend', placements: [{ role: 'premier', vetId: 'alex' }] },
    ] as unknown as PlanningPartiel['attributions'],
  }
  /** Le même, partagé. */
  const partage: PlanningPartiel = {
    attributions: [
      { date: '2026-06-06', type: 'weekend', placements: [{ role: 'premier', vetId: 'alex' }] },
      { date: '2026-06-13', type: 'weekend', placements: [{ role: 'premier', vetId: 'bob' }] },
    ] as unknown as PlanningPartiel['attributions'],
  }

  function equite(planning: PlanningPartiel, report: ReportEquiteMap = {}): number {
    return scorerPlanning(
      planning, vetsN, 'ete', DEFAULT_EQUITY_WEIGHTS, undefined, undefined, undefined, undefined, report,
    ).etages[Etage.EQUITE]
  }

  it('sans report, le partage est jugé meilleur que le déséquilibre', () => {
    expect(equite(partage)).toBeLessThan(equite(alexPrendTout))
  })

  it('LE VERDICT S’INVERSE quand Bob traîne une dette — le score l’ignorait', () => {
    // Bob a déjà fait 2 week-ends de trop les périodes passées (report
    // négatif = doit en faire moins). Lui en redonner un n'est PAS
    // équitable : le planning « Alex prend tout » devient le bon.
    const bobEnDette: ReportEquiteMap = { bob: { we: -2, semaine: 0, feries: 0 } }
    expect(equite(alexPrendTout, bobEnDette)).toBeLessThan(equite(partage, bobEnDette))
  })

  it('un report vide laisse le score STRICTEMENT identique à l’historique', () => {
    const sans = scorerPlanning(partage, vetsN, 'ete')
    const vide = scorerPlanning(
      partage, vetsN, 'ete', undefined, undefined, undefined, undefined, undefined, {},
    )
    expect(vide.etages).toEqual(sans.etages)
    expect(vide.contributions).toEqual(sans.contributions)
  })

  it('l’étage ÉQUITÉ CRITIQUE voit lui aussi la dette', () => {
    // Même mesure, même source : `compteursEffectifs` sert les deux étages.
    const seuilBas = {
      ...DEFAULT_EQUITY_WEIGHTS,
      seuilsCritiques: { ...DEFAULT_EQUITY_WEIGHTS.seuilsCritiques, weekend: 1 },
    }
    const sans = scorerPlanning(
      partage, vetsN, 'ete', seuilBas, undefined, undefined, undefined, undefined, {},
    ).etages[Etage.EQUITE_CRITIQUE]
    const avec = scorerPlanning(
      partage, vetsN, 'ete', seuilBas, undefined, undefined, undefined, undefined,
      { bob: { we: -3, semaine: 0, feries: 0 } },
    ).etages[Etage.EQUITE_CRITIQUE]
    // Partagé 1-1, mais Bob porte 3 week-ends de dette : l'écart réel est
    // de 3, pas de 0. L'étage critique doit se réveiller.
    expect(avec).toBeGreaterThan(sans)
  })
})
