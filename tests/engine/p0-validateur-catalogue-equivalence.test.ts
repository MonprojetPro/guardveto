import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { validerPlanning, type ValidationInput } from '@/engine/validation/validerPlanning'
import type { VetEngine } from '@/engine/types'
import type { CreneauModele } from '@/engine/creneau-modele'

import hiverStandard from './scenarios/hiver-standard.json'
import eteCongesLourds from './scenarios/ete-conges-lourds.json'

// ============================================================
// P0 — Le validateur INDÉPENDANT devient catalogue-aware (slotsAttendus).
//
// PREUVE d'ÉQUIVALENCE : pour le catalogue PAR DÉFAUT (seed des 4 types), valider
// un planning AVEC le catalogue (branche « donnée ») produit EXACTEMENT les mêmes
// violations que SANS (repli sur le mapping en dur historique). C'est le filet qui
// autorise à brancher `ctx.creneaux` dans revaliderPlanning sans toucher à la
// fiabilité prouvée.
//
// On prouve l'équivalence dans les DEUX sens :
//   1. planning fiable  → 0 violation des deux côtés (pas de faux positif) ;
//   2. planning saboté  → MÊMES violations des deux côtés (la branche catalogue
//      ne masque aucune détection).
//
// Zone TILT : on ne branche jamais le catalogue au validateur sans cette preuve.
// ============================================================

function cm(over: Partial<CreneauModele>): CreneauModele {
  return {
    id: 'x', code: null, nom: '', joursSemaine: [], surFeries: false,
    heureDebut: '18:30', heureFin: '08:30', offsetJoursFin: 1,
    nbPlaces: 2, roles: ['premier', 'second'], actif: true, ordre: 0, ...over,
  }
}

// Catalogue PAR DÉFAUT = miroir exact du seed des 4 types (migration P1).
const DEFAUT: CreneauModele[] = [
  cm({ code: 'semaine_soir', joursSemaine: [1, 2, 3, 4], ordre: 1 }),
  cm({ code: 'vendredi_soir', joursSemaine: [5], ordre: 2 }),
  cm({ code: 'weekend', joursSemaine: [6], heureDebut: '08:30', offsetJoursFin: 2, ordre: 3 }),
  cm({ code: 'ferie', joursSemaine: [], surFeries: true, heureDebut: '08:30', ordre: 4 }),
]

interface ScenarioMin {
  periode: { dateDebut: string; dateFin: string; saison: string }
  vets: unknown[]
  bonusMalus?: Record<string, number>
}

// ⚠️ 2026-08-04 — l'effectif de nuit est posé EXPLICITEMENT des deux côtés.
// Le chemin catalogue ne retombe plus sur « hiver = 2, été = 1 » : sans
// surcharge, c'est le nombre de places du créneau qui décide. Les deux chemins
// ne s'accordent donc plus tout seuls en été, et sans cette valeur explicite le
// test comparerait deux effectifs différents au lieu de comparer les slots.
// Même parti pris que `p2b-catalogue-equivalence` — cf. son en-tête.
function effectifDe(scenario: ScenarioMin): number {
  return scenario.periode.saison === 'hiver' ? 2 : 1
}

function baseInput(scenario: ScenarioMin): ValidationInput {
  return {
    dateDebut: scenario.periode.dateDebut,
    dateFin: scenario.periode.dateFin,
    saison: scenario.periode.saison as 'hiver' | 'ete',
    vets: scenario.vets as unknown as VetEngine[],
    nbVetosSemaineSoir: effectifDe(scenario),
  }
}

function solverInput(scenario: ScenarioMin): SolverInput {
  return {
    dateDebut: scenario.periode.dateDebut,
    dateFin: scenario.periode.dateFin,
    saison: scenario.periode.saison as 'hiver' | 'ete',
    vets: scenario.vets as unknown as VetEngine[],
    bonusMalus: scenario.bonusMalus ?? {},
    nbVetosSemaineSoir: effectifDe(scenario),
  }
}

for (const [nom, scenario] of [
  ['hiver-standard', hiverStandard],
  ['ete-conges-lourds', eteCongesLourds],
] as const) {
  describe(`P0 — ${nom} : validateur catalogue par défaut ≡ repli en dur`, () => {
    const gen = genererPlanningPur(solverInput(scenario as ScenarioMin))

    it('le planning de référence est généré', () => {
      expect(gen.success).toBe(true)
    })

    it('planning fiable : AVEC catalogue ≡ SANS (aucune violation des deux côtés)', () => {
      if (!gen.success) return
      const base = baseInput(scenario as ScenarioMin)
      const sans = validerPlanning(gen.planning, base)
      const avec = validerPlanning(gen.planning, { ...base, creneaux: DEFAUT })
      expect(avec).toEqual(sans)
      expect(sans).toEqual([]) // planning issu du solver fiable → 0 violation
    })

    it('planning saboté : AVEC catalogue ≡ SANS (mêmes violations détectées)', () => {
      if (!gen.success) return
      // Sabotage déterministe : on retire 1 attribution sur 5 → trous de couverture.
      const casse = {
        attributions: gen.planning.attributions.filter((_, i) => i % 5 !== 0),
      }
      const base = baseInput(scenario as ScenarioMin)
      const sans = validerPlanning(casse, base)
      const avec = validerPlanning(casse, { ...base, creneaux: DEFAUT })
      expect(avec).toEqual(sans)
      // Le sabotage DOIT produire des violations, sinon le test ne prouve rien.
      expect(sans.length).toBeGreaterThan(0)
    })
  })
}
