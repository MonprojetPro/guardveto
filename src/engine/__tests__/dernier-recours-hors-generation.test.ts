// ============================================================
// B-046 — le dernier recours n'entre JAMAIS dans une génération
// ============================================================
// Décision de MiKL du 26/08/2026. Ce que ces tests protègent :
//
//   • l'exclusion est réelle, pas une simple préférence de tri (le défaut
//     d'avant : un score de 1 000 000 que le moteur franchissait dès qu'il
//     n'avait plus personne) ;
//   • une période insoluble sans lui ÉCHOUE au lieu de le mobiliser en douce ;
//   • les chemins MANUELS le gardent proposable — c'est toute sa raison
//     d'être, et c'est ce qu'un refus posé dans `isValid` aurait cassé ;
//   • le pré-vol ne conseille pas de supprimer ses règles.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '../solver'
import { effectifPourGeneration, exclusDeLaGeneration } from '../effectif'
import { isValid } from '../rules/hard-constraints'
import { preVolRegles } from '../pre-vol'
import { normaliserContraintesVets } from '../normaliserContraintes'
import { premierId, secondId } from '../attribution'
import type { VetEngine, ContrainteEngine } from '../types'

const DATE_DEBUT = '2025-11-03' // lundi
const DATE_FIN = '2025-11-28'   // vendredi (4 semaines)

function vet(id: string, prenom: string, dernier_recours = false): VetEngine {
  return {
    id,
    nom: prenom.toUpperCase(),
    prenom,
    statut: 'associe',
    dernier_recours,
    contraintes: [],
    conges: [],
  }
}

function input(vets: VetEngine[]): SolverInput {
  return {
    dateDebut: DATE_DEBUT,
    dateFin: DATE_FIN,
    saison: 'hiver',
    vets,
    bonusMalus: {},
    lnsTimeoutMs: 2000,
  }
}

/** Tous les ids présents dans un planning, tous rôles confondus. */
function idsPlaces(attributions: { placements?: unknown }[] | undefined, planning: {
  attributions: Parameters<typeof premierId>[0][]
}): Set<string> {
  const out = new Set<string>()
  for (const a of planning.attributions) {
    const p = premierId(a)
    const s = secondId(a)
    if (p) out.add(p)
    if (s) out.add(s)
  }
  return out
}

describe('B-046 — effectif de la génération', () => {
  it('effectifPourGeneration retire le dernier recours, exclusDeLaGeneration le nomme', () => {
    const equipe = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol', true)]

    expect(effectifPourGeneration(equipe).map((v) => v.id)).toEqual(['v1', 'v2'])
    expect(exclusDeLaGeneration(equipe).map((v) => v.prenom)).toEqual(['Carol'])
  })

  it("le dernier recours n'apparaît nulle part dans un planning généré", () => {
    const equipe = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol', true)]
    const result = genererPlanningPur(input(effectifPourGeneration(equipe)))

    expect(result.success).toBe(true)
    if (!result.success) return

    const places = idsPlaces(undefined, result.planning)
    expect(places.has('v3')).toBe(false)
    // Contrôle négatif : le test ne passe pas parce que le planning est vide.
    expect(places.size).toBeGreaterThan(0)
  })

  it('une période que SEUL le dernier recours pouvait boucler échoue au lieu de le mobiliser', () => {
    // Deux vétos actifs seulement, dont un indisponible partout (congé sur toute
    // la période) : sans le dernier recours, il ne reste qu'une personne pour
    // des nuits qui en demandent une — mais les week-ends en demandent deux.
    const congeTotal = { date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' as const }
    const equipe: VetEngine[] = [
      vet('v1', 'Alice'),
      { ...vet('v2', 'Bob'), conges: [congeTotal] },
      vet('v3', 'Carol', true),
    ]

    // AVEC le dernier recours dans l'effectif (ancien comportement) : le moteur
    // sort un planning EN LE MOBILISANT. Sans ce contrôle, le test suivant
    // pourrait passer pour une raison qui n'a rien à voir.
    const avant = genererPlanningPur(input(equipe))
    expect(avant.success).toBe(true)
    if (!avant.success) return
    expect(idsPlaces(undefined, avant.planning).has('v3')).toBe(true)

    // SANS lui (comportement B-046) : le moteur ne le repêche pas, il échoue
    // et le dit — c'est le prix assumé de l'exclusion.
    const apres = genererPlanningPur(input(effectifPourGeneration(equipe)))
    expect(apres.success).toBe(false)
    if (apres.success) return
    expect(apres.joursNonCouverts.length).toBeGreaterThan(0)
  })

  it('reste proposable à la main : isValid l’accepte, avec un avertissement', () => {
    const equipe = normaliserContraintesVets([
      vet('v1', 'Alice'),
      vet('v3', 'Carol', true),
    ])
    const carol = equipe.find((v) => v.id === 'v3')!

    const r = isValid(
      { date: '2025-11-05', type: 'semaine_soir', saison: 'hiver' },
      carol,
      'premier',
      equipe,
      { attributions: [] },
    )

    expect(r.valid).toBe(true)
    expect(r.warning).toMatch(/dernier recours/i)
  })
})

describe('B-046 — le pré-vol ne prend pas le dernier recours pour un véto sorti', () => {
  const regle: ContrainteEngine = {
    id: 'r1',
    type: 'interdire_creneau',
    actif: true,
    config: { brique: 'interdire_creneau', force: 1, creneau: 'weekend' },
  } as unknown as ContrainteEngine

  const commun = {
    vets: [vet('v1', 'Alice')], // effectif de génération : Carol en est absente
    dateDebut: DATE_DEBUT,
    dateFin: DATE_FIN,
    saison: 'hiver' as const,
    annuaire: [
      { id: 'v1', prenom: 'Alice', nom: 'A', actif: true },
      { id: 'v3', prenom: 'Carol', nom: 'C', actif: true },
    ],
    contraintesParVet: new Map([['v3', [regle]]]),
  }

  it("sans l'information, il conseillerait de supprimer une règle encore utile", () => {
    const avert = preVolRegles(commun)
    expect(avert.some((a) => a.code === 'regle_veto_sorti')).toBe(true)
  })

  it('avec idsHorsGeneration, il se tait sur cette règle', () => {
    const avert = preVolRegles({ ...commun, idsHorsGeneration: ['v3'] })
    expect(avert.some((a) => a.code === 'regle_veto_sorti')).toBe(false)
  })
})
