// ============================================================
// GUARDVETO — LES PRÉFÉRENCES QUE LE PLANNING ENFREINT (B-096)
// ============================================================
// MiKL, le 2026-09-02 : Antoine faisait un week-end sur deux, quatre fois de
// suite. Le cabinet a pourtant réglé « au moins 3 semaines entre deux
// week-ends » — en « sauf en cas de crise », donc une préférence, pas une
// interdiction. Le planning l'enfreignait HUIT fois.
//
// Filou n'en a rien dit, et il ne pouvait pas : rien ne le lui disait. Pour le
// découvrir, il aurait dû soustraire des dates de tête sur 118 lignes —
// exactement ce qu'un modèle rate. Le moteur, lui, le savait : il a payé ces
// huit pénalités en construisant le planning.
//
// ── COMMENT ON LES OBTIENT SANS ÉCRIRE UNE SECONDE DÉTECTION ───────────────
//
// `validerPlanning` sait déjà repérer ces situations — c'est le même code qui
// juge la version DURE de chaque règle. Il les écarte simplement, sept fois
// dans le fichier, par un `if (etage > 2) continue` : souple = préférence, donc
// pas une violation. Il a raison de le faire ; ce n'est pas son travail.
//
// On ne le modifie donc pas — c'est un gardien, et le toucher pour un besoin
// d'affichage serait exactement le genre de changement qui se paie six mois
// plus tard. On lui pose la question AUTREMENT : une seconde passe sur les
// mêmes règles, déclarées fermes le temps du calcul. Ce qu'il rend alors, moins
// ce qu'il rend normalement, ce sont précisément les préférences enfreintes.
//
// Une seule détection, deux questions. Écrire ici un second détecteur des
// week-ends trop rapprochés aurait marché le premier jour, et divergé au
// premier réglage ajouté — le projet a déjà payé ce prix.
//
// ── CE QUE ÇA NE COUVRE PAS, ET SE DIT ──────────────────────────────────────
//
// Les pénalités CÂBLÉES du moteur (deux week-ends consécutifs, week-end avant
// des vacances, fête de fin d'année, inversion d'un férié) ne sont pas des
// règles de vétérinaire : elles n'ont pas de `force` à requalifier et ne
// remontent donc pas ici. Le besoin mesuré porte sur les règles que le CABINET
// a réglées lui-même, et ce sont celles-là que l'administratrice reconnaîtra.
// ============================================================

import type { CreneauModele } from '../creneau-modele'
import type { StructureConfig } from '../structure-config'
import type {
  AttributionGarde, CalendrierResolu, ContrainteEngine, PlanningPartiel, VetEngine,
} from '../types'
import { validerPlanning, type Violation } from '../validation/validerPlanning'

/** Une préférence du cabinet que le planning n'a pas pu respecter. */
export interface PreferenceEnfreinte {
  /** La date du créneau concerné. */
  date: string
  /** Qui, si la règle désigne quelqu'un. */
  vetId?: string
  /** La phrase du validateur, déjà écrite pour être lue. */
  detail: string
}

export interface OptionsPreferences {
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

/** L'étage au-delà duquel une règle n'est plus appliquée en dur. */
const ETAGE_DUR_MAX = 2

/** Une contrainte est-elle réglée en préférence (étage > 2) ? */
function estPreference(c: ContrainteEngine): boolean {
  const f = (c.config as Record<string, unknown> | undefined)?.force
  return typeof f === 'number' && f > ETAGE_DUR_MAX
}

/**
 * Les mêmes vétérinaires, leurs PRÉFÉRENCES requalifiées en règles fermes.
 *
 * Copie intégrale : on ne touche pas aux objets d'origine. Le validateur reçoit
 * ces vétos-ci, le reste du produit continue de voir les vrais — une mutation
 * en place ferait basculer en dur des règles que le cabinet a voulues souples,
 * partout ailleurs, et personne ne saurait pourquoi.
 */
function avecPreferencesFermes(vets: VetEngine[]): VetEngine[] {
  return vets.map((v) => ({
    ...v,
    contraintes: v.contraintes.map((c) =>
      estPreference(c)
        ? { ...c, config: { ...(c.config as Record<string, unknown>), force: ETAGE_DUR_MAX } }
        : c,
    ),
  }))
}

/** Ce qui identifie une violation, pour pouvoir soustraire les deux passes. */
function cle(v: Violation): string {
  return `${v.regle}|${v.date}|${v.type}|${v.vetId ?? ''}|${v.detail}`
}

/**
 * Les préférences du cabinet que ce planning n'a pas pu respecter.
 *
 * Deux passes du validateur, et la différence. La passe normale sert de témoin :
 * sans elle, on remonterait aussi les violations DURES — qui sont un autre
 * sujet, autrement plus grave, et que le produit signale déjà ailleurs.
 */
export function preferencesEnfreintes(
  planning: PlanningPartiel,
  options: OptionsPreferences,
): PreferenceEnfreinte[] {
  const commun = {
    dateDebut: options.dateDebut,
    dateFin: options.dateFin,
    saison: options.saison,
    calendrier: options.calendrier,
    nbVetosSemaineSoir: options.nbVetosSemaineSoir,
    structureConfig: options.structureConfig,
    creneaux: options.creneaux,
    contexteAnterieur: options.contexteAnterieur,
  }

  const dures = validerPlanning(planning, { ...commun, vets: options.vets })
  const duresEtPreferences = validerPlanning(planning, {
    ...commun,
    vets: avecPreferencesFermes(options.vets),
  })

  const dejaVues = new Set(dures.map(cle))
  return duresEtPreferences
    .filter((v) => !dejaVues.has(cle(v)))
    .map((v) => ({ date: v.date, vetId: v.vetId, detail: v.detail }))
}
