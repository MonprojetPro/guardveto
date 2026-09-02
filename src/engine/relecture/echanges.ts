// ============================================================
// GUARDVETO — QUELLES PLACES PEUVENT S'ÉCHANGER (B-093)
// ============================================================
// MiKL, le 2026-09-01, devant une relecture où les SEPT constats de Filou
// portaient la mention « il ne voit pas de correction automatique » :
//   « Filou annonce ça dans son rapport, mais pourquoi il n'agit pas ? »
//
// ── LE DIAGNOSTIC ───────────────────────────────────────────────────────────
//
// Ce n'était pas un manque d'outil : `arbitrer.ts` sait déjà appliquer un
// échange à deux places, et Filou sait déjà le demander. C'est ce qu'on lui
// DONNE qui l'en empêchait.
//
// `remplacantsPossibles` ne répond qu'à une question : « qui pourrait prendre
// cette place si on ne libère QUE celle-là ? ». Tout le reste du planning
// restant figé, un candidat déjà de garde à côté est refusé par l'espacement.
// Et le prompt lui disait, en toutes lettres :
//
//     « Si la liste est vide, personne d'autre ne peut prendre cette place. »
//
// Phrase VRAIE pour un remplacement, FAUSSE pour un échange. Filou la lisait
// comme « rien n'est possible ici » et s'abstenait — correctement, vu ce qu'on
// lui avait dit.
//
// ── LA MESURE QUI L'A PROUVÉ (2026-09-01, sur Hiver P2 régénéré) ────────────
//
// Sur 118 places occupées, 53 n'ont AUCUN remplaçant simple possible, et là où
// il y en a, c'est 1,18 en moyenne. Et encore : borne haute, calculée sur le
// seul espacement et les congés, sans les repos fixes ni les duos interdits.
//
// C'est mécanique : Filou relit un planning que le moteur vient d'optimiser.
// Les places où l'on peut poser quelqu'un d'autre SANS RIEN BOUGER D'AUTRE
// n'améliorent rien — sinon le moteur les aurait déjà prises. Ce qui reste,
// ce sont les échanges.
//
// ── POURQUOI C'EST ENCORE LE MOTEUR QUI RÉPOND ──────────────────────────────
//
// Même raison que pour les remplaçants, et elle vaut double ici : un échange se
// juge sur DEUX places à la fois, et l'erreur est facile. Elle a d'ailleurs été
// commise le 2026-09-01 par l'assistant lui-même, qui a proposé à MiKL de
// déplacer Antoine du lundi au mardi en vérifiant l'écart avec sa garde
// PRÉCÉDENTE et en oubliant la SUIVANTE — le moteur l'aurait refusé.
//
// On ne demande donc pas à Filou de deviner : on lui donne les échanges que
// `isValid` accepte, sur le planning où les DEUX mouvements ont été appliqués.
// ============================================================

import type {
  AttributionGarde, CalendrierResolu, PlanningPartiel, VetEngine,
} from '../types'
import type { CreneauModele } from '../creneau-modele'
import type { StructureConfig } from '../structure-config'
import { normaliserContraintesVets } from '../normaliserContraintes'
import { isValid } from '../rules/hard-constraints'
import { genererSteps } from '../solver'

export interface OptionsEchanges {
  vets: VetEngine[]
  dateDebut: string
  dateFin: string
  saison: 'ete' | 'hiver'
  calendrier?: CalendrierResolu
  nbVetosSemaineSoir?: number
  structureConfig?: StructureConfig
  creneaux?: CreneauModele[]
  contexteAnterieur?: AttributionGarde[]
  /**
   * Ne calculer que les échanges impliquant AU MOINS un de ces vétérinaires.
   *
   * Sans filtre, 118 places donnent ~6 900 paires : le calcul tient, mais le
   * dossier envoyé au modèle exploserait et noierait le signal. L'appelant
   * passe donc les personnes aux extrêmes (les plus chargées, les moins
   * servies) — ce sont les seules dont un échange change quelque chose.
   * Absent → toutes les paires.
   */
  vetsCibles?: string[]
}

/** Une place du planning : date, créneau, rôle, et qui l'occupe. */
export interface PlaceOccupee {
  date: string
  type: string
  role: string
  vetId: string
}

/** Deux places dont les occupants peuvent permuter sans enfreindre de règle. */
export interface EchangePossible {
  a: PlaceOccupee
  b: PlaceOccupee
}

/** Clé stable d'une place, pour l'indexation par l'appelant. */
export function clePlace(date: string, type: string, role: string): string {
  return `${date}|${type}|${role}`
}

/**
 * Le planning où les deux places de l'échange sont VIDÉES.
 *
 * Les deux, pas une : c'est la situation dans laquelle chaque arrivant doit
 * être jugé. Ne vider que la sienne laisserait l'autre en poste et le ferait
 * refuser par « une seule garde par jour » ou par l'espacement — on répondrait
 * « aucun échange possible » sur presque tout, exactement le défaut qu'on
 * corrige (même précaution que dans `remplacants.ts`).
 */
function sansLesDeuxPlaces(
  planning: PlanningPartiel, a: PlaceOccupee, b: PlaceOccupee,
): PlanningPartiel {
  return {
    attributions: planning.attributions.map((attr) => {
      const toucheA = attr.date === a.date && attr.type === a.type
      const toucheB = attr.date === b.date && attr.type === b.type
      if (!toucheA && !toucheB) return attr
      return {
        ...attr,
        placements: attr.placements.map((p) => {
          if (toucheA && p.role === a.role) return { ...p, vetId: null }
          if (toucheB && p.role === b.role) return { ...p, vetId: null }
          return p
        }),
      }
    }),
  }
}

/**
 * Pose `vetId` sur une place précise.
 *
 * Exportée pour `mouvements.ts` (B-096), qui compose des mouvements à plus de
 * deux places. Une seconde implémentation de la même mécanique de pose est
 * exactement ce qui finit par diverger — leçon B-087.
 */
export function poser(
  planning: PlanningPartiel, place: PlaceOccupee, vetId: string,
): PlanningPartiel {
  return {
    attributions: planning.attributions.map((attr) =>
      attr.date === place.date && attr.type === place.type
        ? {
            ...attr,
            placements: attr.placements.map((p) =>
              p.role === place.role ? { ...p, vetId } : p,
            ),
          }
        : attr,
    ),
  }
}

/** Ce qu'il faut pour juger une pose — regroupé pour ne pas repasser six
 *  paramètres identiques à chaque appel. */
interface ContexteJugement {
  vets: ReturnType<typeof normaliserContraintesVets>
  parStep: Map<string, ReturnType<typeof genererSteps>[number]>
  /** Le planning avec les DEUX places de l'échange vidées. */
  base: PlanningPartiel
  options: OptionsEchanges
}

/**
 * L'échange tient-il si l'on pose `premiere` avant `seconde` ?
 *
 * `arrivantPremiere` prend la place `premiere`, `arrivantSeconde` prend
 * `seconde`. La seconde pose est jugée sur le planning où la première est déjà
 * faite — c'est le contrôle cumulatif.
 */
function poseeDansCetOrdre(
  ctx: ContexteJugement,
  premiere: PlaceOccupee, arrivantPremiere: VetEngine,
  seconde: PlaceOccupee, arrivantSeconde: VetEngine,
): boolean {
  const stepPremiere = ctx.parStep.get(clePlace(premiere.date, premiere.type, premiere.role))
  const stepSeconde = ctx.parStep.get(clePlace(seconde.date, seconde.type, seconde.role))
  if (!stepPremiere || !stepSeconde) return false

  const vetPremiere = ctx.vets.find((v) => v.id === arrivantPremiere.id)
  const vetSeconde = ctx.vets.find((v) => v.id === arrivantSeconde.id)
  if (!vetPremiere || !vetSeconde) return false

  const ok1 = isValid(
    stepPremiere, vetPremiere, premiere.role, ctx.vets, ctx.base,
    ctx.options.calendrier, ctx.options.structureConfig, ctx.options.contexteAnterieur,
  )
  if (!ok1.valid) return false

  const ok2 = isValid(
    stepSeconde, vetSeconde, seconde.role, ctx.vets,
    poser(ctx.base, premiere, vetPremiere.id),
    ctx.options.calendrier, ctx.options.structureConfig, ctx.options.contexteAnterieur,
  )
  return ok2.valid
}

/**
 * Toutes les paires de places dont les occupants peuvent permuter légalement.
 *
 * Le contrat est le même que celui de `remplacantsPossibles` : ce n'est pas une
 * estimation, c'est ce que le moteur accepte. Si une paire figure ici, appliquer
 * l'échange respecte toutes les règles dures.
 */
export function echangesPossibles(
  planning: PlanningPartiel,
  options: OptionsEchanges,
): EchangePossible[] {
  const vets = normaliserContraintesVets(options.vets)
  const parId = new Map(vets.map((v) => [v.id, v]))

  const steps = genererSteps(
    options.dateDebut,
    options.dateFin,
    options.saison,
    options.nbVetosSemaineSoir,
    options.creneaux,
  )
  const parStep = new Map(steps.map((s) => [clePlace(s.date, s.type, s.role), s]))

  const parCreneau = new Map<string, AttributionGarde>()
  for (const a of planning.attributions) parCreneau.set(`${a.date}|${a.type}`, a)

  // Les places OCCUPÉES, dans l'ordre des steps (déterminisme).
  const places: PlaceOccupee[] = []
  for (const step of steps) {
    const attr = parCreneau.get(`${step.date}|${step.type}`)
    if (!attr) continue
    const p = attr.placements.find((x) => x.role === step.role)
    if (!p?.vetId) continue // place vide → relève des remplaçants, pas des échanges
    places.push({ date: step.date, type: step.type, role: step.role, vetId: p.vetId })
  }

  const cibles = options.vetsCibles ? new Set(options.vetsCibles) : null
  const out: EchangePossible[] = []

  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      const a = places[i]
      const b = places[j]
      // Permuter quelqu'un avec lui-même ne change rien.
      if (a.vetId === b.vetId) continue
      if (cibles && !cibles.has(a.vetId) && !cibles.has(b.vetId)) continue

      const vetA = parId.get(a.vetId)
      const vetB = parId.get(b.vetId)
      if (!vetA || !vetB) continue

      // Contrôle CUMULATIF, comme dans `arbitrer.ts` : le second mouvement est
      // jugé sur le planning où le premier est DÉJÀ posé. Les juger tous deux
      // sur la même base laisserait passer une paire légale séparément et
      // contradictoire ensemble — deux personnes envoyées le même soir alors
      // que la composition d'équipe l'interdit, par exemple.
      const base = sansLesDeuxPlaces(planning, a, b)

      // ⚠️ LES DEUX ORDRES DE POSE SONT ESSAYÉS, un seul suffit.
      //
      // Certaines règles portent sur l'ORDRE DE CONSTRUCTION du solver, pas sur
      // le planning fini : R18 et R19 refusent de désigner le 2ᵉ avant le 1ᵉʳ.
      // En permutant deux rôles d'un même soir on vide les deux places puis on
      // repose — commencer par le 2ᵉ faisait refuser un échange parfaitement
      // valide. Le refus portait sur l'ordre dans lequel on écrivait, pas sur ce
      // qu'on écrivait. (Trouvé par un test, le 2026-09-01.)
      //
      // Le planning FINAL est identique dans les deux ordres : qu'un seul passe
      // suffit donc à prouver sa légalité.
      const ctx = { vets, parStep, base, options }
      if (poseeDansCetOrdre(ctx, a, vetB, b, vetA)
        || poseeDansCetOrdre(ctx, b, vetA, a, vetB)) {
        out.push({ a, b })
      }
    }
  }

  return out
}
