// ============================================================
// B-096 — LES MOUVEMENTS ARRIVAIENT À FILOU SANS AUCUN SCORE
// ============================================================
// Le 2026-09-02, la liste envoyée à Filou disait « le moteur accepte ces
// permutations » et rien d'autre. Le filtre porte sur `isValid`, donc sur les
// règles DURES : légal et souhaitable étaient confondus. On lui demandait de
// choisir un levier sans lui donner de balance — et il a répondu, huit fois,
// qu'il ne voyait pas de correction à proposer.
//
// La balance existait pourtant : `arbitrer.ts` mesure déjà cet effet, mais
// APRÈS coup, sur ce que Filou a proposé. Jamais au moment de choisir.
//
// Ce que ces tests verrouillent :
//   • le sens est celui du moteur, pas une estimation ;
//   • un mouvement qui ne change rien est dit ÉGAL, pas « améliore » — sinon
//     Filou proposerait du remue-ménage en croyant réparer ;
//   • « sur quoi » nomme l'étage qui a DÉCIDÉ, et se lit en français.
// ============================================================

import { describe, it, expect } from 'vitest'
import { effetsDesMouvements, planningApres } from '../relecture/effet'
import type { MouvementPossible } from '../relecture/mouvements'
import { normaliserContraintesVets } from '../normaliserContraintes'
import type { PlanningPartiel, VetEngine } from '../types'

function vet(id: string, prenom: string): VetEngine {
  return {
    id, nom: prenom, prenom, statut: 'associe',
    dernier_recours: false, contraintes: [], conges: [],
  }
}

const EQUIPE = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol')]

function ctx() {
  return { vets: normaliserContraintesVets(EQUIPE), saison: 'hiver' as const }
}

/**
 * Alice porte TOUS les week-ends, Carol aucun. Le déséquilibre est franc :
 * tout mouvement qui en rend un à Carol doit être vu comme une amélioration.
 */
function planningDesequilibre(): PlanningPartiel {
  const we = (date: string, premier: string, second: string) => ({
    date, type: 'weekend',
    placements: [{ role: 'premier', vetId: premier }, { role: 'second', vetId: second }],
  })
  return {
    attributions: [
      we('2025-11-08', 'v1', 'v2'),
      we('2025-11-15', 'v1', 'v2'),
      we('2025-11-22', 'v1', 'v2'),
    ],
  }
}

describe('effetsDesMouvements — le sens', () => {
  it('dit AMÉLIORE quand le mouvement rééquilibre les week-ends', () => {
    // Carol prend un week-end à Alice : 3/0 devient 2/1.
    const rendreUnWeekendACarol: MouvementPossible = {
      genre: 'echange_weekend',
      affectations: [{ date: '2025-11-22', type: 'weekend', role: 'premier', vetId: 'v3' }],
    }
    const [effet] = effetsDesMouvements(
      planningDesequilibre(), [rendreUnWeekendACarol], ctx(),
    )
    expect(effet.sens).toBe('ameliore')
    expect(effet.surQuoi).toBeTruthy()
  })

  it('dit ÉGAL quand rien ne change au score', () => {
    // Remettre Alice là où elle est déjà : le planning est identique.
    const sansEffet: MouvementPossible = {
      genre: 'echange_simple',
      affectations: [{ date: '2025-11-08', type: 'weekend', role: 'premier', vetId: 'v1' }],
    }
    const [effet] = effetsDesMouvements(planningDesequilibre(), [sansEffet], ctx())
    expect(effet.sens).toBe('egal')
    expect(effet.surQuoi).toBeUndefined()
  })

  it('dit DÉGRADE quand le mouvement aggrave le déséquilibre', () => {
    // Point de repère : sur le planning déséquilibré, donner une place à Carol
    // (qui n'a rien) améliore. C'est la référence contre laquelle le cas
    // suivant doit s'opposer.
    const versCarol: MouvementPossible = {
      genre: 'echange_simple',
      affectations: [{ date: '2025-11-22', type: 'weekend', role: 'second', vetId: 'v3' }],
    }
    const [bon] = effetsDesMouvements(planningDesequilibre(), [versCarol], ctx())
    expect(bon.sens).toBe('ameliore')

    // Et l'inverse, sur un planning déjà équilibré, doit dégrader.
    const equilibre: PlanningPartiel = {
      attributions: [
        { date: '2025-11-08', type: 'weekend', placements: [{ role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v2' }] },
        { date: '2025-11-15', type: 'weekend', placements: [{ role: 'premier', vetId: 'v3' }, { role: 'second', vetId: 'v1' }] },
        { date: '2025-11-22', type: 'weekend', placements: [{ role: 'premier', vetId: 'v2' }, { role: 'second', vetId: 'v3' }] },
      ],
    }
    const concentre: MouvementPossible = {
      genre: 'echange_simple',
      affectations: [
        { date: '2025-11-15', type: 'weekend', role: 'premier', vetId: 'v1' },
        { date: '2025-11-22', type: 'weekend', role: 'premier', vetId: 'v1' },
      ],
    }
    const [mauvais] = effetsDesMouvements(equilibre, [concentre], ctx())
    expect(mauvais.sens).toBe('degrade')
  })
})

describe('effetsDesMouvements — ce que « sur quoi » raconte', () => {
  it('est une phrase en français, sans code de règle ni numéro d’étage', () => {
    const m: MouvementPossible = {
      genre: 'echange_weekend',
      affectations: [{ date: '2025-11-22', type: 'weekend', role: 'premier', vetId: 'v3' }],
    }
    const [effet] = effetsDesMouvements(planningDesequilibre(), [m], ctx())
    // Cette phrase finit dans ce que Filou dit à l'administratrice. Un « R11 »
    // ou un « étage 6 » qui fuiterait jusque-là serait exactement le défaut
    // B-023 : raisonner sur une formulation que personne d'autre n'emploie.
    expect(effet.surQuoi).not.toMatch(/\bR\d+|étage|EQUITE|SAUF_CRISE/i)
    expect(effet.surQuoi!.length).toBeGreaterThan(10)
  })
})

describe('planningApres — ce que le mouvement produit', () => {
  it('applique toutes les affectations, et ne touche rien d’autre', () => {
    const m: MouvementPossible = {
      genre: 'echange_weekend',
      affectations: [{ date: '2025-11-22', type: 'weekend', role: 'premier', vetId: 'v3' }],
    }
    const apres = planningApres(planningDesequilibre(), m)

    const cible = apres.attributions.find((a) => a.date === '2025-11-22')!
    expect(cible.placements.find((p) => p.role === 'premier')!.vetId).toBe('v3')
    // Le second de ce week-end n'était pas dans le mouvement : il ne bouge pas.
    expect(cible.placements.find((p) => p.role === 'second')!.vetId).toBe('v2')
    // Les autres week-ends non plus.
    const intact = apres.attributions.find((a) => a.date === '2025-11-08')!
    expect(intact.placements.find((p) => p.role === 'premier')!.vetId).toBe('v1')
  })

  it('ne modifie pas le planning d’origine', () => {
    // Le scoreur est appelé sur des dizaines de mouvements à la suite : une
    // mutation en place les ferait tous se marcher dessus, et l'effet mesuré
    // serait celui d'un planning que personne n'a demandé.
    const origine = planningDesequilibre()
    planningApres(origine, {
      genre: 'echange_simple',
      affectations: [{ date: '2025-11-22', type: 'weekend', role: 'premier', vetId: 'v3' }],
    })
    const inchange = origine.attributions.find((a) => a.date === '2025-11-22')!
    expect(inchange.placements.find((p) => p.role === 'premier')!.vetId).toBe('v1')
  })
})
