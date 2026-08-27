// ============================================================
// GUARDVETO — ARBITRAGE des propositions de Filou (B-062, lot 1)
// ============================================================
// Ce module est le GARDIEN de la relecture. Filou propose une autre façon de
// voir le planning ; c'est ici qu'on regarde si le moteur est d'accord.
//
// ── LA RÈGLE POSÉE PAR MiKL LE 27/08 ────────────────────────────────────────
//
//   « Filou propose une autre façon de voir le planning au moteur, qui vérifie
//    que ses propositions sont bien en accord avec les règles. Si c'est le cas,
//    l'IA a le dernier mot et on suit ses recommandations. Dans le cas où elle
//    recommande quelque chose et que le moteur n'est pas d'accord car cela
//    enfreint une règle, cela sera proposé à l'admin lors du rapport de fin de
//    génération avec le pourquoi de Filou et ce que dit le moteur, et comme ça
//    l'admin tranchera. »
//
// Deux conséquences, écrites ici parce que c'est ici qu'elles s'appliquent :
//
//  ① SEULE LA LÉGALITÉ FAIT VETO. Le score se calcule et s'affiche, il ne
//     refuse rien. C'est un renversement volontaire par rapport au moteur, et
//     il tient à la NATURE de Filou dans ce rôle (MiKL, 27/08) : « un
//     observateur indépendant qui se rapproche plus de la doctrine humaine
//     (repos, épuisement, équilibre global) que celle d'un moteur
//     algorithmique ». S'il juge sur des critères que le score n'exprime pas,
//     alors un score qui baisse ne prouve pas que c'est pire — il prouve que le
//     score ne sait pas mesurer ce que Filou a vu. On le montre, on ne s'en
//     sert pas pour trancher.
//
//  ② LE CONTRÔLE EST CUMULATIF. Chaque changement retenu modifie le planning
//     sur lequel le suivant est jugé. Arbitrer chaque proposition contre le
//     planning d'origine laisserait passer deux changements légaux séparément
//     et contradictoires ensemble (deux personnes envoyées sur la même place).
//
// ⚠️ Ce module n'écrit RIEN en base et n'appelle AUCUN modèle. Il prend un
//    planning et des propositions, il rend un verdict. C'est ce qui le rend
//    testable sans réseau — et c'est ce qui fait qu'un test peut prouver qu'une
//    proposition illégale est bien refusée.
// ============================================================

import type {
  AttributionGarde, CalendrierResolu, PlanningPartiel, VetEngine,
} from '../types'
import { validerPlanning, type Violation } from '../validation/validerPlanning'
import { normaliserContraintesVets } from '../normaliserContraintes'
import {
  scorerPlanning, comparerScores, type VecteurScore,
} from '../score-lexicographique'
import type { EquityWeights } from '../equity-weights'
import type { StructureConfig } from '../structure-config'

// ── Ce que Filou peut demander ───────────────────────────────

/** Une place précise du planning : une date, un créneau, un rôle. */
export interface PlacePlanning {
  date: string
  type: string
  role: string
}

/**
 * Une place et qui doit s'y trouver. `vetId: null` vide la place.
 *
 * Tout ce que Filou sait demander s'exprime ainsi : un échange est une liste de
 * deux affectations, un remplacement une seule, pourvoir une case vide une
 * seule aussi. Un vocabulaire unique plutôt que trois verbes — sinon chaque
 * nouveau geste demanderait un nouveau contrôle, et c'est celui qu'on oublie
 * qui passe sans être vérifié.
 */
export interface AffectationVoulue extends PlacePlanning {
  vetId: string | null
}

/** Un changement proposé par Filou, avec le pourquoi qui l'accompagne. */
export interface ChangementPropose {
  /** Identifiant court, pour que le rapport et l'écran parlent du même. */
  id: string
  /** Le POURQUOI de Filou, en français, tel qu'il sera montré à l'admin. */
  motif: string
  /** La clé du critère humain visé (cf. `lib/planning/criteres-humains`). */
  critere: string
  affectations: AffectationVoulue[]
}

// ── Ce que le moteur en dit ──────────────────────────────────

export type VerdictChangement =
  /** Aucune règle enfreinte : appliqué. Filou a le dernier mot. */
  | 'applique'
  /** Le moteur refuse : une règle dure est enfreinte. L'admin tranchera. */
  | 'refuse'
  /** La demande ne correspond à rien dans ce planning (place inexistante). */
  | 'sans_objet'

/** L'effet du changement sur le score — informatif, jamais décisionnaire. */
export type EffetScore = 'ameliore' | 'egal' | 'degrade'

export interface ChangementArbitre {
  changement: ChangementPropose
  verdict: VerdictChangement
  /** Ce que dit le moteur quand il refuse. Vide sur `applique`. */
  violations: Violation[]
  /**
   * L'effet mesuré sur le score du planning. Absent sur `sans_objet` (rien n'a
   * pu être simulé) et sur `refuse` (le planning refusé n'a pas de score qu'on
   * ait le droit de présenter comme un résultat).
   */
  effetScore?: EffetScore
  /**
   * Ce que la place contenait AVANT, place par place. Sert au rapport : « Fanny
   * remplace Antoine » se dit mal sans savoir qui y était.
   */
  avant: AffectationVoulue[]
}

export interface ResultatArbitrage {
  /** Le planning après application des seuls changements acceptés. */
  planning: PlanningPartiel
  arbitrages: ChangementArbitre[]
  /** Vrai si au moins un changement a été appliqué (donc s'il faut persister). */
  modifie: boolean
}

export interface OptionsArbitrage {
  vets: VetEngine[]
  dateDebut: string
  dateFin: string
  saison: 'ete' | 'hiver'
  calendrier?: CalendrierResolu
  nbVetosSemaineSoir?: number
  structureConfig?: StructureConfig
  creneaux?: Parameters<typeof validerPlanning>[1]['creneaux']
  contexteAnterieur?: AttributionGarde[]
  weights?: EquityWeights
  roleAvantageFinancier?: string | null
}

// ── Application d'un changement sur une copie ────────────────

/** Copie profonde du strict nécessaire : les placements sont réécrits. */
function copier(planning: PlanningPartiel): PlanningPartiel {
  return {
    attributions: planning.attributions.map((a) => ({
      ...a,
      placements: a.placements.map((p) => ({ ...p })),
    })),
  }
}

function trouverPlace(
  planning: PlanningPartiel,
  place: PlacePlanning,
): { attribution: AttributionGarde; index: number } | null {
  const attribution = planning.attributions.find(
    (a) => a.date === place.date && a.type === place.type,
  )
  if (!attribution) return null
  const index = attribution.placements.findIndex((p) => p.role === place.role)
  if (index === -1) return null
  return { attribution, index }
}

/**
 * Applique les affectations sur une COPIE, et rend aussi l'état d'avant.
 *
 * Rend `null` dès qu'une seule place est introuvable : un changement est un
 * TOUT. Appliquer la moitié d'un échange laisserait une personne sur deux
 * places et l'autre nulle part — un planning cassé qu'aucune règle dure
 * n'attraperait forcément, donc exactement le genre de dégât qui passe.
 */
function appliquer(
  planning: PlanningPartiel,
  affectations: AffectationVoulue[],
): { planning: PlanningPartiel; avant: AffectationVoulue[] } | null {
  const copie = copier(planning)
  const avant: AffectationVoulue[] = []

  for (const voulue of affectations) {
    const cible = trouverPlace(copie, voulue)
    if (!cible) return null
    avant.push({
      date: voulue.date,
      type: voulue.type,
      role: voulue.role,
      vetId: cible.attribution.placements[cible.index].vetId,
    })
  }

  // Écriture en second temps : lire d'abord TOUTES les places d'avant, puis
  // écrire. Un échange écrit place par place lirait, pour sa seconde place,
  // une valeur déjà écrasée par la première.
  for (const voulue of affectations) {
    const cible = trouverPlace(copie, voulue)!
    cible.attribution.placements[cible.index] = {
      role: voulue.role,
      vetId: voulue.vetId,
    }
  }

  return { planning: copie, avant }
}

// ── Le contrôle lui-même ─────────────────────────────────────

/**
 * Identité d'une violation — ce qui permet de dire « c'est LA MÊME qu'avant ».
 *
 * On ne compte pas les violations, on les NOMME. Un décompte laisserait passer
 * le cas où une disparaît pendant qu'une autre apparaît : le total ne bouge
 * pas, et une nouvelle faute entre dans le planning sans que rien ne le dise.
 */
function identite(v: Violation): string {
  return [v.regle, v.date, v.type, v.role ?? '', v.vetId ?? ''].join('|')
}

/**
 * Passe chaque proposition de Filou devant le moteur, dans l'ordre.
 *
 * ── LE CRITÈRE DE REFUS, ET POURQUOI CE N'EST PAS « ZÉRO VIOLATION » ─────────
 *
 * Un changement est refusé s'il fait APPARAÎTRE une violation qui n'existait
 * pas avant. Pas « s'il en reste une ».
 *
 * La première version de ce module exigeait zéro violation après. C'était
 * rassurant et c'était faux, mesuré le 27/08 : un planning PARTIEL — celui que
 * le moteur rend depuis B-053, avec ses cases à pourvoir — porte déjà une
 * violation `R18` par case vide (« garde de semaine sans second »). Exiger
 * zéro aurait donc refusé TOUS les changements sur un planning troué, y
 * compris celui qui bouche le trou : la fonction serait morte exactement là où
 * elle sert le plus (critère `cases_vides`).
 *
 * Une case vide n'est pas une faute, c'est un état documenté du produit. Une
 * garde illégale, si. Comparer par identité distingue les deux, et un test
 * (`relecture-arbitrer.test.ts`) fige les deux cas.
 */
export function arbitrerChangements(
  planningInitial: PlanningPartiel,
  changements: ChangementPropose[],
  options: OptionsArbitrage,
): ResultatArbitrage {
  const vetsNorm = normaliserContraintesVets(options.vets)

  const entreeValidation = {
    dateDebut: options.dateDebut,
    dateFin: options.dateFin,
    saison: options.saison,
    vets: options.vets,
    calendrier: options.calendrier,
    nbVetosSemaineSoir: options.nbVetosSemaineSoir,
    structureConfig: options.structureConfig,
    creneaux: options.creneaux,
    contexteAnterieur: options.contexteAnterieur,
  }

  const scoreDe = (p: PlanningPartiel): VecteurScore =>
    scorerPlanning(
      p, vetsNorm, options.saison, options.weights, options.structureConfig,
      options.roleAvantageFinancier, options.calendrier, options.contexteAnterieur,
    )

  let courant = planningInitial
  let scoreCourant = scoreDe(courant)
  // Les violations que le planning porte DÉJÀ — typiquement une par case vide
  // sur un planning partiel. Elles ne sont imputables à aucune proposition.
  let dejaLa = new Set(validerPlanning(courant, entreeValidation).map(identite))
  const arbitrages: ChangementArbitre[] = []
  let modifie = false

  for (const changement of changements) {
    const applique = appliquer(courant, changement.affectations)

    if (!applique) {
      arbitrages.push({
        changement, verdict: 'sans_objet', violations: [], avant: [],
      })
      continue
    }

    const apres = validerPlanning(applique.planning, entreeValidation)
    const nouvelles = apres.filter((v) => !dejaLa.has(identite(v)))

    if (nouvelles.length > 0) {
      arbitrages.push({
        // On ne montre à l'admin QUE ce que ce changement-là a causé. Lui
        // servir les violations préexistantes ferait porter à Filou des
        // fautes qui ne sont pas les siennes.
        changement, verdict: 'refuse', violations: nouvelles, avant: applique.avant,
      })
      continue
    }

    // Légal : Filou a le dernier mot. On mesure quand même, pour le dire.
    const scoreApres = scoreDe(applique.planning)
    // `comparerScores` rend < 0 quand le premier est MEILLEUR (ordre du solver).
    const comparaison = comparerScores(scoreApres, scoreCourant)

    arbitrages.push({
      changement,
      verdict: 'applique',
      violations: [],
      effetScore: comparaison < 0 ? 'ameliore' : comparaison > 0 ? 'degrade' : 'egal',
      avant: applique.avant,
    })

    courant = applique.planning
    scoreCourant = scoreApres
    // Le socle suit le planning : si le changement a BOUCHÉ une case vide, la
    // violation R18 correspondante a disparu et ne doit plus servir de
    // laissez-passer au changement suivant.
    dejaLa = new Set(apres.map(identite))
    modifie = true
  }

  return { planning: courant, arbitrages, modifie }
}
