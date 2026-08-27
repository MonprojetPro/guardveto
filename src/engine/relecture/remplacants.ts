// ============================================================
// GUARDVETO — QUI POURRAIT TENIR CHAQUE PLACE (B-075)
// ============================================================
// MiKL, le 27/08, après avoir lu une relecture riche en constats et vide en
// actions : « je ne comprends pas qu'à partir de ces constats il n'y ait pas
// de changements appliqués... il n'avait aucune idée de comment faire pour
// changer au mieux ? **Je trouve actuellement comme c'est que ça ne sert à
// rien.** »
//
// ── LE DIAGNOSTIC ───────────────────────────────────────────────────────────
//
// Il avait raison, et sur la cause aussi. Filou recevait le planning, les
// compteurs, les absences et les règles — mais **jamais qui pouvait aller où**.
// Il devait deviner si un échange passerait, et devant l'incertitude il
// s'abstenait : 6 constats sur 7 sont ressortis « il ne voit pas de correction
// automatique ». Son unique proposition a d'ailleurs été refusée parce qu'il
// ignorait que le vendredi soir et le week-end forment un bloc indissociable.
//
// Un observateur qui ne peut rien vérifier ne propose rien. Ce module lui rend
// cette information — calculée par le MOTEUR, donc juste par construction.
//
// ── POURQUOI C'EST LE MOTEUR QUI RÉPOND ─────────────────────────────────────
//
// On aurait pu décrire les règles à Filou et le laisser raisonner. C'est
// exactement ce qu'on ne veut pas : il se tromperait, et ses propositions
// seraient refusées une fois sur deux. `isValid` est le gardien que le solver
// consulte à chaque pose — la même fonction, sur les mêmes données. Ce que ce
// module renvoie n'est donc pas une opinion sur ce qui est possible : c'est ce
// qui est possible.
// ============================================================

import type {
  AttributionGarde, CalendrierResolu, PlanningPartiel, VetEngine,
} from '../types'
import type { CreneauModele } from '../creneau-modele'
import type { StructureConfig } from '../structure-config'
import { normaliserContraintesVets } from '../normaliserContraintes'
import { isValid } from '../rules/hard-constraints'
import { genererSteps } from '../solver'

export interface OptionsRemplacants {
  vets: VetEngine[]
  dateDebut: string
  dateFin: string
  saison: 'ete' | 'hiver'
  calendrier?: CalendrierResolu
  nbVetosSemaineSoir?: number
  structureConfig?: StructureConfig
  creneaux?: CreneauModele[]
  contexteAnterieur?: AttributionGarde[]
}

/** Clé d'une place : date, créneau, rôle. */
function cle(date: string, type: string, role: string): string {
  return `${date}|${type}|${role}`
}

/**
 * Pour chaque place du planning, la liste des identifiants qui pourraient la
 * tenir — la personne déjà en poste exclue.
 *
 * ⚠️ Le test se fait sur un planning où la place est VIDÉE. Sans ça, la
 * personne en poste bloquerait tous les autres candidats par les règles
 * « une seule garde par jour » et « rôles distincts » — on répondrait
 * « personne ne peut la remplacer » sur chaque place occupée du planning, ce
 * qui est faux et exactement l'inverse de ce qu'on cherche.
 */
export function remplacantsPossibles(
  planning: PlanningPartiel,
  options: OptionsRemplacants,
): Map<string, string[]> {
  const vets = normaliserContraintesVets(options.vets)

  const steps = genererSteps(
    options.dateDebut,
    options.dateFin,
    options.saison,
    options.nbVetosSemaineSoir,
    options.creneaux,
  )

  // Index (date|type) → attribution, pour retrouver une place en O(1).
  const parCreneau = new Map<string, AttributionGarde>()
  for (const a of planning.attributions) {
    parCreneau.set(`${a.date}|${a.type}`, a)
  }

  const resultat = new Map<string, string[]>()

  for (const step of steps) {
    const attribution = parCreneau.get(`${step.date}|${step.type}`)
    if (!attribution) continue

    const index = attribution.placements.findIndex((p) => p.role === step.role)
    if (index === -1) continue

    const occupant = attribution.placements[index].vetId

    // Le planning SANS cette place — c'est la situation dans laquelle un
    // remplaçant arriverait.
    const sansLaPlace: PlanningPartiel = {
      attributions: planning.attributions.map((a) =>
        a.date === step.date && a.type === step.type
          ? {
              ...a,
              placements: a.placements.map((p, i) =>
                i === index ? { ...p, vetId: null } : p,
              ),
            }
          : a,
      ),
    }

    const possibles: string[] = []
    for (const vet of vets) {
      if (vet.id === occupant) continue
      // Un « dernier recours » n'est pas proposé spontanément — c'est le
      // réglage du cabinet, pas un oubli. L'admin peut toujours le poser à la
      // main depuis le planning.
      if (vet.dernier_recours) continue

      const verdict = isValid(
        step,
        vet,
        step.role,
        vets,
        sansLaPlace,
        options.calendrier,
        options.structureConfig,
        options.contexteAnterieur,
      )
      if (verdict.valid) possibles.push(vet.id)
    }

    resultat.set(cle(step.date, step.type, step.role), possibles)
  }

  return resultat
}
