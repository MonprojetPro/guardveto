import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import type { VetEngine } from '@/engine/types'
import type { CreneauModele } from '@/engine/creneau-modele'

import hiverStandard from './scenarios/hiver-standard.json'
import eteCongesLourds from './scenarios/ete-conges-lourds.json'

// ============================================================
// P2b — PREUVE DÉCISIVE : consommer le catalogue par défaut ne change
// RIEN. Le solver complet, sur un même scénario, doit produire un planning
// STRICTEMENT IDENTIQUE avec le catalogue par défaut (branche catalogue) et
// sans catalogue (repli sur le mapping en dur). C'est le filet qui autorise
// la bascule du moteur sans toucher à la fiabilité prouvée.
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

function buildInput(scenario: ScenarioMin, creneaux?: CreneauModele[]): SolverInput {
  return {
    dateDebut: scenario.periode.dateDebut,
    dateFin: scenario.periode.dateFin,
    saison: scenario.periode.saison as 'hiver' | 'ete',
    vets: scenario.vets as unknown as VetEngine[],
    bonusMalus: scenario.bonusMalus ?? {},
    creneaux,
  }
}

function tri(planning: { attributions: Array<{ date: string; type: string }> }) {
  return [...planning.attributions].sort((a, b) =>
    (a.date + a.type).localeCompare(b.date + b.type),
  )
}

for (const [nom, scenario] of [
  ['hiver-standard', hiverStandard],
  ['ete-conges-lourds', eteCongesLourds],
] as const) {
  describe(`P2b — ${nom} : catalogue par défaut ≡ repli en dur`, () => {
    const sans = genererPlanningPur(buildInput(scenario))
    const avec = genererPlanningPur(buildInput(scenario, DEFAUT))

    it('les deux génèrent avec succès', () => {
      expect(sans.success).toBe(true)
      expect(avec.success).toBe(true)
    })

    it('produisent EXACTEMENT le même planning', () => {
      if (!sans.success || !avec.success) return
      expect(tri(avec.planning)).toEqual(tri(sans.planning))
    })
  })
}
