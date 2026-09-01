// ============================================================
// GUARDVETO — L'équité critique passe devant les PRÉFÉRENCES
// ============================================================
// L'INCIDENT, le 2026-08-31. MiKL recette Hiver P2 dans le bac à sable :
//   « Manon est encore en déficit, pourquoi ? »
//
// Mesuré en base : Manon 3 gardes de second de semaine, Victor 12. Neuf d'écart,
// sur une dimension réglée « essentiel », et aucune absence de Manon sur la
// période. Le moteur n'avait pourtant rien fait de travers.
//
// LA CAUSE. Toute l'équité vivait à l'étage 6, le DERNIER. Combinée à la
// garantie lexicographique du système — « un seul point à l'étage N bat
// n'importe quel nombre de points à l'étage N+1 » — cela signifiait qu'une
// seule préférence « si possible » respectée l'emportait sur n'importe quel
// déséquilibre. Le moteur avait le choix entre respecter « Victor pas le lundi »
// et rééquilibrer Manon : il a respecté la préférence, cinq lundis de suite.
//
// LE REMÈDE. Un étage `EQUITE_CRITIQUE` s'insère entre « sauf en cas de crise »
// et « à éviter au maximum ». Il ne se déclenche qu'AU-DELÀ d'un seuil, et ne
// dépasse jamais ce que l'admin a verrouillé — arbitrage de MiKL le 2026-09-01 :
// « ça doit être plus présent, mais pas dépasser les règles jamais ».
//
// Ces tests figent les DEUX moitiés de la promesse : il se déclenche quand il
// faut, et il RESTE SILENCIEUX en dessous du seuil. La seconde compte autant que
// la première : un étage qui crie tout le temps serait vite désactivé.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  comparerScores, scorerPlanning, Etage, NB_ETAGES, ORDRE_COMPARAISON,
  type VecteurScore,
} from '@/engine/score-lexicographique'
import { genererPlanningPur } from '@/engine/solver'
import { compterParVet, ecartMaxMin } from '@/engine/rules/optimization'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { DEFAULT_EQUITY_WEIGHTS } from '@/engine/equity-weights'
import type { VetEngine, PlanningPartiel } from '@/engine/types'

function vecteur(remplir: Partial<Record<Etage, number>>): VecteurScore {
  const etages = new Array(NB_ETAGES).fill(0)
  for (const [k, v] of Object.entries(remplir)) etages[Number(k)] = v
  return { etages, contributions: [] }
}

describe('ORDRE_COMPARAISON — la place de l’équité critique', () => {
  it('se lit entre « sauf en cas de crise » et « à éviter au maximum »', () => {
    const i = (e: Etage) => ORDRE_COMPARAISON.indexOf(e)
    expect(i(Etage.SAUF_CRISE)).toBeLessThan(i(Etage.EQUITE_CRITIQUE))
    expect(i(Etage.EQUITE_CRITIQUE)).toBeLessThan(i(Etage.EVITEE_AU_MAX))
    expect(i(Etage.EQUITE_CRITIQUE)).toBeLessThan(i(Etage.SI_POSSIBLE))
  })

  it('couvre TOUS les étages, sans doublon — sinon un étage serait ignoré en silence', () => {
    expect(ORDRE_COMPARAISON.length).toBe(NB_ETAGES)
    expect(new Set(ORDRE_COMPARAISON).size).toBe(NB_ETAGES)
  })
})

describe('comparerScores — ce que l’équité critique gagne, et ce qu’elle ne gagne pas', () => {
  it('un déséquilibre critique l’emporte sur N préférences « si possible »', () => {
    const desequilibre = vecteur({ [Etage.EQUITE_CRITIQUE]: 1 })
    const centPreferences = vecteur({ [Etage.SI_POSSIBLE]: 100 })
    // Le planning déséquilibré est le PIRE des deux → score plus grand.
    expect(comparerScores(desequilibre, centPreferences)).toBeGreaterThan(0)
  })

  it('… et sur N règles « à éviter au maximum »', () => {
    expect(
      comparerScores(vecteur({ [Etage.EQUITE_CRITIQUE]: 1 }), vecteur({ [Etage.EVITEE_AU_MAX]: 100 })),
    ).toBeGreaterThan(0)
  })

  it('MAIS il ne dépasse JAMAIS « sauf en cas de crise » — la limite posée par MiKL', () => {
    const uneCrise = vecteur({ [Etage.SAUF_CRISE]: 1 })
    const desequilibreEnorme = vecteur({ [Etage.EQUITE_CRITIQUE]: 10_000 })
    // Deux week-ends consécutifs restent pires qu'un gros écart de compteur.
    expect(comparerScores(uneCrise, desequilibreEnorme)).toBeGreaterThan(0)
  })

  it('ni « jamais », ni les règles dures', () => {
    const desequilibreEnorme = vecteur({ [Etage.EQUITE_CRITIQUE]: 10_000 })
    expect(comparerScores(vecteur({ [Etage.JAMAIS_USER]: 1 }), desequilibreEnorme)).toBeGreaterThan(0)
    expect(comparerScores(vecteur({ [Etage.INVARIANT_SYSTEME]: 1 }), desequilibreEnorme)).toBeGreaterThan(0)
  })

  it('un vecteur de 7 cases (avant l’ajout de l’étage) reste comparable', () => {
    // Non-régression : les appelants qui construisent encore 7 cases ne doivent
    // pas basculer sur un `undefined` silencieux qui fausserait la comparaison.
    const ancien: VecteurScore = { etages: [0, 0, 0, 0, 0, 0, 5], contributions: [] }
    const nouveau = vecteur({ [Etage.EQUITE]: 5 })
    expect(comparerScores(ancien, nouveau)).toBe(0)
  })
})

// ── Sur un vrai planning ────────────────────────────────────

const VETS: VetEngine[] = ['a', 'b', 'c', 'd'].map((id) => ({
  id, prenom: id.toUpperCase(), nom: 'X', statut: 'associe' as const,
  dernier_recours: false, conges: [], contraintes: [],
}))
const vetsN = normaliserContraintesVets(VETS)

/** Un planning de nuits de semaine où `repartition` dit qui est second, et
 *  combien de fois. Le premier tourne, il n'est pas le sujet du test. */
function planningSeconds(repartition: Record<string, number>): PlanningPartiel {
  const attributions = []
  let jour = 0
  const premiers = ['a', 'b', 'c', 'd']
  for (const [vetId, n] of Object.entries(repartition)) {
    for (let k = 0; k < n; k++) {
      // Une date par garde, espacées d'une semaine pour n'éveiller aucune règle
      // de rythme — on veut isoler l'équité, pas mesurer autre chose.
      const d = new Date(Date.UTC(2026, 0, 5 + jour * 7))
      const premier = premiers[jour % premiers.length] === vetId
        ? premiers[(jour + 1) % premiers.length]
        : premiers[jour % premiers.length]
      attributions.push({
        date: d.toISOString().split('T')[0],
        type: 'semaine_soir',
        placements: [
          { role: 'premier' as const, vetId: premier },
          { role: 'second' as const, vetId },
        ],
      })
      jour++
    }
  }
  return { attributions }
}

function etageCritique(planning: PlanningPartiel): number {
  return scorerPlanning(planning, vetsN, 'hiver', DEFAULT_EQUITY_WEIGHTS)
    .etages[Etage.EQUITE_CRITIQUE]
}

describe('scorerPlanning — l’étage ne se réveille qu’au-delà du seuil', () => {
  it('reste SILENCIEUX sur un déséquilibre ordinaire (2 d’écart, seuil 3)', () => {
    // C'est la moitié qui compte le plus : sans elle, l'étage crierait sur tout
    // et le comportement historique serait cassé pour tous les cabinets.
    expect(etageCritique(planningSeconds({ a: 5, b: 4, c: 4, d: 3 }))).toBe(0)
  })

  it('se déclenche sur le cas Manon — 3 contre 12', () => {
    expect(etageCritique(planningSeconds({ a: 12, b: 8, c: 8, d: 3 }))).toBeGreaterThan(0)
  })

  it('pèse le DÉPASSEMENT, pas l’écart entier — corriger un peu doit payer un peu', () => {
    // Sans quoi le moteur préférerait rester juste sous le seuil plutôt que de
    // réduire un écart déjà franchi.
    const pire = etageCritique(planningSeconds({ a: 12, b: 8, c: 8, d: 3 }))
    const mieux = etageCritique(planningSeconds({ a: 10, b: 8, c: 8, d: 5 }))
    expect(mieux).toBeLessThan(pire)
    expect(mieux).toBeGreaterThan(0)
  })

  it('un seuil à 0 désactive la dimension — retour exact au comportement d’avant', () => {
    const planning = planningSeconds({ a: 12, b: 8, c: 8, d: 3 })
    const sansSeuil = scorerPlanning(planning, vetsN, 'hiver', {
      ...DEFAULT_EQUITY_WEIGHTS,
      seuilsCritiques: { weekend: 0, weekend_premier: 0, ferie: 0, semaine_premier: 0, semaine_second: 0, semaine_renfort: 0, grands_weekend: 0 },
    })
    expect(sansSeuil.etages[Etage.EQUITE_CRITIQUE]).toBe(0)
  })

  it('une dimension NON équilibrée (poids 0) ne crie pas non plus', () => {
    // Un cabinet qui a réglé « second de semaine » sur « ignorée » a décidé de ne
    // pas équilibrer cette dimension. L'étage critique n'a pas à le contredire.
    //
    // Isolé sur la SEULE dimension testée : la répartition ci-dessous déséquilibre
    // aussi « premier de semaine » (le premier tourne pendant que le second
    // s'accumule), et sans cette isolation le test aurait mesuré la mauvaise
    // dimension — il échouait à 30, sur `semaine_premier`.
    const seulementSecond = {
      weekend: 0, weekend_premier: 0, ferie: 0,
      semaine_premier: 0, semaine_renfort: 0, grands_weekend: 0,
      semaine_second: 3,
    }
    const planning = planningSeconds({ a: 12, b: 8, c: 8, d: 3 })

    // Contrôle : avec son poids normal, cette dimension DOIT crier…
    expect(
      scorerPlanning(planning, vetsN, 'hiver', { ...DEFAULT_EQUITY_WEIGHTS, seuilsCritiques: seulementSecond })
        .etages[Etage.EQUITE_CRITIQUE],
    ).toBeGreaterThan(0)

    // … et se taire dès que le cabinet a décidé de ne pas l'équilibrer.
    expect(
      scorerPlanning(planning, vetsN, 'hiver', {
        ...DEFAULT_EQUITY_WEIGHTS, SEMAINE_SECOND: 0, seuilsCritiques: seulementSecond,
      }).etages[Etage.EQUITE_CRITIQUE],
    ).toBe(0)
  })
})

// ============================================================
// LE GARDE-FOU QUI COMPTE : l'étage doit CHANGER UNE GÉNÉRATION
// ============================================================
// Ce test existe parce que la première version du correctif était INERTE.
//
// L'étage lexicographique avait été posé, les 12 tests ci-dessus passaient, la
// suite complète était verte. Mesure sur une vraie génération, avec un écart de
// 6 gardes — le double du seuil : AUCUNE différence. Zéro.
//
// La raison : le LNS détruit une semaine et la RÉPARE avec `scorerCandidat`,
// resté inchangé. Il reconstruisait donc toujours la même semaine, et
// `comparerScores` n'avait jamais deux plannings différents à départager. Un
// classement ne sert à rien sans diversité à classer.
//
// Les tests unitaires ne pouvaient pas l'attraper : ils vérifiaient que le
// classement est juste, pas qu'il a un effet. C'est la leçon « un grep prouve
// qu'un code est ÉCRIT, jamais qu'il est EXÉCUTÉ », dans sa version scoring.
//
// Si ce test redevient vert avec un écart identique des deux côtés, le
// correctif est retombé inerte — quelle que soit la couleur des autres.

const SEUILS_DESACTIVES = {
  weekend: 0, weekend_premier: 0, ferie: 0,
  semaine_premier: 0, semaine_second: 0, semaine_renfort: 0, grands_weekend: 0,
}

/** 4 vétos ; le premier a une préférence SOUPLE qui couvre tous les soirs de
 *  semaine — s'il est épargné, il décroche et les trois autres encaissent.
 *  C'est la forme du cas Manon : rien d'illégal, juste quelqu'un qui sort. */
function vetsAvecUnQuiDecroche(): VetEngine[] {
  const base: VetEngine[] = ['A', 'B', 'C', 'D'].map((p) => ({
    id: `v-${p}`, prenom: p, nom: 'X', statut: 'associe',
    dernier_recours: false, conges: [], contraintes: [],
  }))
  base[0].contraintes = ['lundi', 'mardi', 'mercredi', 'jeudi'].map((jour, i) => ({
    id: `pref-${i}`,
    type: 'jour_repos_fixe',
    actif: true,
    // force 5 = « si possible » : une PRÉFÉRENCE, jamais un interdit.
    config: { brique: 'interdire_creneau', force: 5, params: { jour } },
  })) as VetEngine['contraintes']
  return base
}

function ecartSecondsApresGeneration(seuils?: typeof SEUILS_DESACTIVES): number {
  const vets = normaliserContraintesVets(vetsAvecUnQuiDecroche())
  const r = genererPlanningPur({
    dateDebut: '2025-11-03', dateFin: '2025-12-28', saison: 'hiver',
    vets, bonusMalus: {}, lnsTimeoutMs: 4000,
    equityWeights: { ...DEFAULT_EQUITY_WEIGHTS, ...(seuils ? { seuilsCritiques: seuils } : {}) },
  })
  if (!r.success) throw new Error('génération échouée — le montage du test est cassé')
  return ecartMaxMin(compterParVet(r.planning, vets).map((c) => c.semaineSecond))
}

describe('EFFET RÉEL sur une génération complète', () => {
  it('resserre l’écart de « second de semaine » — mesuré, pas supposé', () => {
    const sans = ecartSecondsApresGeneration(SEUILS_DESACTIVES)
    const avec = ecartSecondsApresGeneration()

    // Mesuré le 2026-09-01 : 6 sans, 3 avec. On fige le SENS et un gain net,
    // pas les valeurs exactes — le solver a le droit de mieux faire demain.
    expect(sans).toBeGreaterThanOrEqual(5)
    expect(avec).toBeLessThan(sans)
    expect(sans - avec).toBeGreaterThanOrEqual(2)
  })
})
