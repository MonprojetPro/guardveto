// ============================================================
// GUARDVETO — REFAIRE UNE PORTION DE PLANNING SOUS CONTRAINTE (B-101)
// ============================================================
// MiKL, le 2026-09-02, après cinq relectures qui n'ont pas allégé Antoine :
// « je ne sais pas quoi te dire de plus ». Il n'avait rien à dire de plus.
//
// ── CE QUE LA MESURE A ÉTABLI AVANT D'ÉCRIRE UNE LIGNE ─────────────────────
//
// Sur les cinq week-ends d'Antoine, AUCUN mouvement local ne peut le libérer,
// à aucune profondeur — remplacement direct, échange, chaîne à six places.
// La trace de relecture le dit noir sur blanc : `personnesAllegeables` ne le
// contient pas. La semaine du 19 au 25 octobre en donne la raison :
//
//   • Jean et Anne-Sophie sont en congé la semaine entière ;
//   • il reste QUATRE personnes pour douze places ;
//   • l'espacement de deux jours interdit deux soirs consécutifs.
//
// Tout candidat au week-end est de garde le jeudi, et déplacer ce jeudi bute
// sur le mercredi. Le nœud est fermé de partout.
//
// ── ET POURTANT LA SEMAINE A UNE AUTRE SOLUTION ────────────────────────────
//
// Elle existe, mais elle demande de bouger CINQ soirs d'un coup :
//
//     lun 19 : Manon + Fanny        (au lieu d'Antoine + Victor)
//     mar 20 : Antoine + Victor     (au lieu de Manon + Fanny)
//     mer 21 : Manon + Fanny        (au lieu d'Antoine + Victor)
//     jeu 22 : Antoine + Victor     (au lieu de Fanny + Manon)
//     w-e 24 : Manon + Fanny        (au lieu de Victor + Antoine)
//
// Antoine sort du week-end. Aucun mouvement à deux, quatre ou six places ne
// pouvait trouver ça : c'est une permutation de toute la semaine. D'où ce
// module — on ne déplace plus des personnes, on REFAIT une portion en disant
// au moteur ce qu'on ne veut plus.
//
// ── LE CONTRAT, LE MÊME QUE PARTOUT ICI ────────────────────────────────────
//
// Ce qui sort d'ici est ce que `isValid` accepte. Le reste du planning est
// GELÉ : on ne rebat que la fenêtre demandée, et les places hors fenêtre sont
// vues par les contrôles (une garde la veille du début compte toujours).
//
// ── CE QU'ON NE FAIT PAS, ET POURQUOI ──────────────────────────────────────
//
// On ne cherche pas la MEILLEURE reconstruction : on cherche une reconstruction
// LÉGALE qui respecte l'exclusion, en préférant à chaque pose le candidat que
// le moteur préfère déjà. Chercher l'optimum sur une fenêtre reviendrait à
// réécrire le solver, et le résultat serait jugé par le même scoreur de toute
// façon — c'est `effetsDesMouvements` qui dira si ça vaut le coup.
// ============================================================

import type {
  AttributionGarde, CalendrierResolu, PlanningPartiel, VetEngine,
} from '../types'
import type { CreneauModele } from '../creneau-modele'
import type { StructureConfig } from '../structure-config'
import type { EquityWeights } from '../equity-weights'
import { normaliserContraintesVets } from '../normaliserContraintes'
import { isValid } from '../rules/hard-constraints'
import { genererSteps, scorerCandidatLNS } from '../solver'
import { DEFAULT_EQUITY_WEIGHTS } from '../equity-weights'
import { clePlace } from './echanges'

export interface OptionsReconstruction {
  vets: VetEngine[]
  dateDebut: string
  dateFin: string
  saison: 'ete' | 'hiver'
  calendrier?: CalendrierResolu
  nbVetosSemaineSoir?: number
  structureConfig?: StructureConfig
  creneaux?: CreneauModele[]
  contexteAnterieur?: AttributionGarde[]
  equityWeights?: EquityWeights
  roleAvantageFinancier?: string | null
}

/** Ce qu'on demande au moteur de ne plus faire. */
export interface Exclusion {
  vetId: string
  /** Le créneau dont on veut le sortir. */
  date: string
  type: string
}

export interface DemandeReconstruction {
  /** Les bornes de la portion à refaire (incluses). */
  debut: string
  fin: string
  exclusion: Exclusion
}

/**
 * Le nombre de poses tentées avant d'abandonner.
 *
 * Le backtracking sur une semaine de douze places à six candidats explore vite.
 * Ce plafond n'est pas un réglage de qualité : c'est une garantie que la
 * relecture rend la main. Une fenêtre qui ne se résout pas sous cette limite se
 * traite comme « pas de solution » — et le produit le dit, il n'invente pas.
 */
const MAX_POSES = 200_000

/** Les places de la fenêtre, dans l'ordre où le solver les poserait. */
function placesDeLaFenetre(
  options: OptionsReconstruction,
  demande: DemandeReconstruction,
) {
  return genererSteps(
    options.dateDebut, options.dateFin, options.saison,
    options.nbVetosSemaineSoir, options.creneaux,
  ).filter((s) => s.date >= demande.debut && s.date <= demande.fin)
}

/**
 * Le planning avec toutes les places de la fenêtre RETIRÉES.
 *
 * ⚠️ RETIRÉES, pas mises à `null` — et c'est la différence entre un module qui
 * marche et un module qui refuse tout.
 *
 * `R9` (même binôme vendredi/week-end) demande à l'occurrence appariée si le
 * vétérinaire y figure. Une attribution laissée en place avec des `vetId: null`
 * EXISTE pour ce contrôle : elle répond « il n'y est pas », et la pose est
 * refusée. Toutes les poses le sont, dans tous les ordres, et la reconstruction
 * rend `null` sur une fenêtre qui a pourtant une solution.
 *
 * Le solver n'a jamais ce problème : il CONSTRUIT le planning, donc une
 * occurrence non encore posée n'existe pas du tout. On reproduit exactement cet
 * état de départ. (Même piège que sur les grappes, deux heures plus tôt — la
 * sémantique du planning partiel est « ce qui est posé », jamais « ce qui est
 * prévu ».)
 */
function fenetreVidee(planning: PlanningPartiel, aVider: Set<string>): PlanningPartiel {
  const attributions: AttributionGarde[] = []
  for (const attr of planning.attributions) {
    const restants = attr.placements.filter(
      (p) => !aVider.has(clePlace(attr.date, attr.type, p.role)),
    )
    if (restants.length === 0) continue // occurrence entièrement dans la fenêtre
    attributions.push(restants.length === attr.placements.length
      ? attr
      : { ...attr, placements: restants })
  }
  return { attributions }
}

/**
 * Pose un véto, en CRÉANT l'occurrence si elle n'existe pas encore.
 *
 * `poser` (echanges.ts) suppose la place déjà présente : elle sert à remplacer
 * quelqu'un. Ici on reconstruit depuis rien, donc la première pose d'un créneau
 * doit le faire naître — sinon elle serait silencieusement perdue et la
 * reconstruction rendrait un planning troué en croyant l'avoir rempli.
 */
function poserOuCreer(
  planning: PlanningPartiel,
  place: { date: string; type: string; role: string },
  vetId: string,
): PlanningPartiel {
  const existe = planning.attributions.some(
    (a) => a.date === place.date && a.type === place.type,
  )
  if (!existe) {
    return {
      attributions: [
        ...planning.attributions,
        { date: place.date, type: place.type, placements: [{ role: place.role, vetId }] },
      ],
    }
  }
  return {
    attributions: planning.attributions.map((a) => {
      if (a.date !== place.date || a.type !== place.type) return a
      return a.placements.some((p) => p.role === place.role)
        ? { ...a, placements: a.placements.map((p) => (p.role === place.role ? { ...p, vetId } : p)) }
        : { ...a, placements: [...a.placements, { role: place.role, vetId }] }
    }),
  }
}

/**
 * Refait la portion demandée en respectant l'exclusion.
 *
 * Renvoie le planning complet reconstruit, ou `null` si aucune solution
 * n'existe sous la contrainte — auquel cas il n'y a rien à proposer, et c'est
 * une réponse en soi.
 *
 * ⚠️ TOUTES les places de la fenêtre doivent être pourvues. Une reconstruction
 * qui laisserait un trou échangerait un problème d'équité contre une case vide,
 * ce qui est pire : l'équité se discute, une nuit sans vétérinaire non.
 */
export function reconstruireFenetre(
  planning: PlanningPartiel,
  options: OptionsReconstruction,
  demande: DemandeReconstruction,
): PlanningPartiel | null {
  const vets = normaliserContraintesVets(options.vets)
  const steps = placesDeLaFenetre(options, demande)
  if (steps.length === 0) return null

  const aVider = new Set(steps.map((s) => clePlace(s.date, s.type, s.role)))
  const depart = fenetreVidee(planning, aVider)

  let poses = 0

  /**
   * Pose les places à partir de `i`. Renvoie le planning complet, ou null.
   *
   * Les candidats sont triés par `scorerCandidat` — le MÊME classement que le
   * solver utilise pour construire. On ne réinvente pas une préférence : à
   * contrainte égale, la reconstruction ressemble à ce que le moteur aurait
   * fait, ce qui rend le résultat explicable à l'admin.
   */
  function poserDepuis(i: number, courant: PlanningPartiel): PlanningPartiel | null {
    if (i >= steps.length) return courant
    if (poses > MAX_POSES) return null

    const step = steps[i]
    const estLeCreneauExclu =
      step.date === demande.exclusion.date && step.type === demande.exclusion.type

    const candidats = vets
      .filter((v) => !(estLeCreneauExclu && v.id === demande.exclusion.vetId))
      .filter((v) => isValid(
        step, v, step.role, vets, courant,
        options.calendrier, options.structureConfig, options.contexteAnterieur,
      ).valid)
      .map((v) => ({
        v,
        score: scorerCandidatLNS(
          step, v, courant, vets,
          options.equityWeights ?? DEFAULT_EQUITY_WEIGHTS,
          options.calendrier,
          options.roleAvantageFinancier ?? null,
          undefined, undefined, undefined, undefined, undefined,
          options.contexteAnterieur,
        ),
      }))
      .sort((a, b) => a.score - b.score || (a.v.id < b.v.id ? -1 : 1))

    for (const { v } of candidats) {
      poses += 1
      if (poses > MAX_POSES) return null
      const suivant = poserOuCreer(
        courant, { date: step.date, type: step.type, role: step.role }, v.id,
      )
      const fini = poserDepuis(i + 1, suivant)
      if (fini) return fini
    }

    return null
  }

  return poserDepuis(0, depart)
}
