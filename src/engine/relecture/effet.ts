// ============================================================
// GUARDVETO — CE QU'UN MOUVEMENT AMÉLIORE, OU DÉGRADE (B-096)
// ============================================================
// MiKL, le 2026-09-02, après la relecture réelle de Hiver P2 : huit constats,
// huit fois « il ne voit pas de correction automatique ».
//
// Un des trois trous mesurés ce jour-là : la liste des mouvements arrivait à
// Filou SANS SCORE. Elle disait « le moteur accepte ces permutations », jamais
// laquelle améliore ni ce qu'elle coûte. Le filtre porte sur `isValid`, donc
// sur les règles DURES seulement — **légal et souhaitable étaient confondus**.
// On demandait à Filou d'arbitrer sans lui donner la balance.
//
// ── LA BALANCE EXISTAIT DÉJÀ, ET ELLE ÉTAIT BRANCHÉE À L'ENVERS ─────────────
//
// `arbitrer.ts` calcule DÉJÀ cet effet (`EffetScore`), avec `scorerPlanning` et
// `comparerScores` — mais APRÈS coup, sur ce que Filou a proposé. Le moteur
// savait donc dire « ce mouvement dégrade le planning »… une fois le mouvement
// choisi. Jamais au moment où il fallait choisir.
//
// Ce module fait la même mesure EN AMONT, sur chaque mouvement de la liste.
// Rien de neuf n'est inventé : c'est le même scoreur, le même comparateur.
//
// ── POURQUOI ON DIT AUSSI « SUR QUOI » ──────────────────────────────────────
//
// « Ce mouvement améliore » ne se répète pas à une administratrice. « Il réduit
// un déséquilibre important » se répète. On nomme donc l'ÉTAGE qui a décidé de
// la comparaison — le premier qui diffère dans l'ordre de priorité, celui-là
// même qui a tranché. C'est vrai par construction, pas approché.
// ============================================================

import type { CalendrierResolu, PlanningPartiel, VetEngineNormalise, AttributionGarde } from '../types'
import type { StructureConfig } from '../structure-config'
import type { EquityWeights } from '../equity-weights'
import {
  scorerPlanning, comparerScores, Etage, ORDRE_COMPARAISON, type VecteurScore,
} from '../score-lexicographique'
import { poser } from './echanges'
import type { MouvementPossible } from './mouvements'

/** L'effet d'un mouvement sur le planning. Informatif — jamais décisionnaire. */
export type SensEffet = 'ameliore' | 'egal' | 'degrade'

export interface EffetMouvement {
  sens: SensEffet
  /**
   * Ce que le mouvement change, en français — « un déséquilibre important »,
   * « une règle que le cabinet a posée en sauf-crise ». Absent quand le
   * mouvement ne change rien au score (`sens === 'egal'`).
   */
  surQuoi?: string
}

/**
 * Le nom PARLANT de chaque étage.
 *
 * Ces phrases partent dans le dossier de Filou, et de là dans ce qu'il dira à
 * l'administratrice. Elles sont donc écrites pour elle : pas de code de règle,
 * pas de numéro d'étage. C'est la même exigence que `phraseRegle` côté règles.
 */
const NOM_ETAGE: Record<Etage, string> = {
  [Etage.INVARIANT_SYSTEME]: 'une règle que le planning ne peut pas enfreindre',
  [Etage.REGLEMENTAIRE]: 'une obligation réglementaire',
  [Etage.JAMAIS_USER]: 'une règle que le cabinet a posée en « jamais »',
  [Etage.SAUF_CRISE]: 'une règle que le cabinet a posée en « sauf en cas de crise »',
  [Etage.EQUITE_CRITIQUE]: 'un déséquilibre important entre les personnes',
  [Etage.EVITEE_AU_MAX]: 'une règle que le cabinet veut éviter au maximum',
  [Etage.SI_POSSIBLE]: 'une préférence « si possible »',
  [Etage.EQUITE]: 'l’équilibre général des charges',
}

/** Ce qu'il faut pour scorer un planning — les mêmes réglages que le moteur. */
export interface ContexteEffet {
  vets: VetEngineNormalise[]
  saison: 'ete' | 'hiver'
  weights?: EquityWeights
  structureConfig?: StructureConfig
  roleAvantageFinancier?: string | null
  calendrier?: CalendrierResolu
  contexteAnterieur?: AttributionGarde[]
}

function scorer(planning: PlanningPartiel, ctx: ContexteEffet): VecteurScore {
  return scorerPlanning(
    planning, ctx.vets, ctx.saison, ctx.weights, ctx.structureConfig,
    ctx.roleAvantageFinancier, ctx.calendrier, ctx.contexteAnterieur,
  )
}

/**
 * L'étage qui a DÉCIDÉ de la comparaison : le premier, dans l'ordre de
 * priorité, où les deux vecteurs diffèrent. C'est exactement celui sur lequel
 * `comparerScores` s'est arrêté — on ne redevine pas, on refait son parcours.
 */
function etageDecisif(avant: VecteurScore, apres: VecteurScore): Etage | null {
  for (const etage of ORDRE_COMPARAISON) {
    if ((avant.etages[etage] ?? 0) !== (apres.etages[etage] ?? 0)) return etage
  }
  return null
}

/** Le planning tel qu'il serait après application du mouvement. */
export function planningApres(
  planning: PlanningPartiel, mouvement: MouvementPossible,
): PlanningPartiel {
  let out = planning
  for (const a of mouvement.affectations) out = poser(out, a, a.vetId)
  return out
}

/**
 * L'effet de chaque mouvement, mesuré sur le planning entier.
 *
 * Le score du planning ACTUEL n'est calculé qu'une fois — il ne dépend pas des
 * mouvements. Sans cette précaution on le recalculerait à chaque ligne, et ce
 * scoreur parcourt toutes les attributions et toutes les règles.
 */
export function effetsDesMouvements(
  planning: PlanningPartiel,
  mouvements: readonly MouvementPossible[],
  ctx: ContexteEffet,
): EffetMouvement[] {
  const avant = scorer(planning, ctx)

  return mouvements.map((m) => {
    const apres = scorer(planningApres(planning, m), ctx)
    const cmp = comparerScores(apres, avant)
    if (cmp === 0) return { sens: 'egal' as const }

    const etage = etageDecisif(avant, apres)
    return {
      sens: cmp < 0 ? ('ameliore' as const) : ('degrade' as const),
      surQuoi: etage === null ? undefined : NOM_ETAGE[etage],
    }
  })
}
