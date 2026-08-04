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
//
// ⚠️ UNE HYPOTHÈSE EST DEVENUE EXPLICITE LE 2026-08-04.
//
// L'équivalence reposait en silence sur un point d'accord entre les deux
// chemins : sans effectif réglé, tous deux appliquaient « hiver = 2, été = 1 ».
// Ce repli a été retiré du chemin CATALOGUE — c'est désormais le nombre de
// places du créneau qui décide (la structure des gardes du cabinet, plutôt que
// deux lignes en dur dans le moteur). Le chemin legacy, lui, n'a aucun créneau
// à lire : il garde le repli saison, faute de mieux.
//
// Les deux chemins ne peuvent donc plus s'accorder tout seuls sur l'effectif de
// nuit en été. On fixe l'effectif des DEUX côtés pour continuer à comparer ce
// que ce test a toujours voulu comparer : les types de garde, les jours, les
// rôles, les week-ends, les fériés. Supprimer le test aurait coûté ce filet-là ;
// le laisser rouge en aurait fait un test qu'on apprend à ignorer.
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
  const saison = scenario.periode.saison as 'hiver' | 'ete'
  return {
    dateDebut: scenario.periode.dateDebut,
    dateFin: scenario.periode.dateFin,
    saison,
    vets: scenario.vets as unknown as VetEngine[],
    bonusMalus: scenario.bonusMalus ?? {},
    creneaux,
    // L'effectif de nuit, posé à l'identique des deux côtés — c'est l'ancien
    // repli saison, écrit noir sur blanc au lieu d'être supposé partagé.
    nbVetosSemaineSoir: saison === 'hiver' ? 2 : 1,
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
