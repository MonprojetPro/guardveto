// ============================================================
// GUARDVETO — Ce qu'une proposition CHANGE sur la grille (B-123, refait)
// ============================================================
// MiKL, le 17/09, en recette : « je ne vois rien qui indique visuellement un
// quelconque changement, mis à part un petit encart pointillé discret sur
// Anne-Sophie le 1er décembre. Si c'est ça, ce n'est pas du tout ce que je
// demandais. »
//
// ── LE DÉFAUT DE LA PREMIÈRE VERSION, MESURÉ SUR LES VRAIES DONNÉES ─────────
//
// La v1 rendait `Record<date, Record<vetId, propId>>` : « ce vétérinaire
// ARRIVERAIT ce jour-là ». `PlanningV2` s'en servait ainsi :
//
//     const propositionId = p.vetId ? apercuDate?.[p.vetId] : undefined
//
// où `p.vetId` est la personne **actuellement** sur la place. Une case n'était
// donc marquée que si la personne qui doit ARRIVER y était **déjà** — c'est-à-
// dire exactement là où il n'y a rien à montrer.
//
// Mesuré sur la proposition F1 du 17/09 (`propositions_relecture`) : 6 places
// touchées sur 5 dates, toutes avec un `vetId`. Une seule case entourée à
// l'écran — Anne-Sophie le 1er décembre, la seule qui était déjà présente ce
// jour-là (en 2e, la proposition la veut en 1er). Les 5 autres faisaient
// arriver quelqu'un d'absent de la case : invisibles.
//
// Le test de la v1 passait pourtant au vert : il vérifiait la table
// intermédiaire, jamais sa confrontation à l'état réel de la grille.
//
// ── LA MÉTHODE RETENUE : COMPARER DEUX ENSEMBLES DE PERSONNES ───────────────
//
// On identifie un créneau par (date, type) — **jamais par rôle** — puis on
// compare l'ensemble des personnes qui l'occupent aujourd'hui à l'ensemble de
// celles que la proposition y met. D'où :
//
//     sortants = occupants actuels \ occupants proposés
//     entrants = occupants proposés \ occupants actuels
//
// ⚠️ POURQUOI LE RÔLE EST EXCLU DE L'IDENTIFICATION, ET PAS PAR PRUDENCE : la
// ligne du vendredi inverse rôles ET personnes entre le moteur et la vue
// (`resoudrePlanningAffichage`, couple `vendredi_soir → weekend`). C'est ce qui
// a fait échouer le cadenas le 04/09 (B-111) : comparer par libellé de rôle
// désignait la mauvaise personne un jour sur trois. Un ensemble de personnes
// sur un créneau, lui, ne s'inverse jamais — l'inversion permute les rôles À
// L'INTÉRIEUR du créneau, elle ne fait entrer ni sortir personne.
//
// ✅ Effet de bord voulu : une place qui se VIDE (`vetId: null`) devient enfin
// affichable. La v1 l'abandonnait faute de savoir qui l'occupait ; ici, la
// personne qui part sort naturellement de la différence d'ensembles, puisqu'on
// lit les occupants actuels.
// ============================================================

import type { ChangementPropose } from '@/engine/relecture/arbitrer'

export interface PropositionPourApercu {
  id: string
  changement: ChangementPropose
}

/**
 * Une place que la proposition veut occuper, à plat et sérialisable — ce qui
 * traverse la frontière serveur/client vers `PlanningV2`.
 */
export interface PlaceProposee {
  date: string
  type: string
  /** `null` = la proposition VIDE cette place. */
  vetId: string | null
  propositionId: string
}

/** Un créneau tel que la grille l'affiche réellement, occupants compris. */
export interface CreneauActuel {
  date: string
  type: string
  occupants: readonly (string | null)[]
}

/** Ce que la grille doit dessiner sur un créneau donné. */
export interface ApercuCreneau {
  /** La proposition à ouvrir si on clique une de ces cases. */
  propositionId: string
  /** Personnes qui quittent ce créneau — leur case actuelle est barrée. */
  sortants: string[]
  /** Personnes qui arrivent — dessinées en plus, en fantôme. */
  entrants: string[]
}

/** Clé d'un créneau. Le rôle n'y entre pas : voir l'en-tête. */
export function cleCreneau(date: string, type: string): string {
  return `${date}|${type}`
}

/**
 * Met les affectations de chaque proposition à plat. Sérialisable tel quel :
 * ce module tourne côté serveur, le résultat traverse vers le client.
 */
export function calculerPlacesProposees(
  propositions: readonly PropositionPourApercu[],
): PlaceProposee[] {
  return propositions.flatMap((p) =>
    p.changement.affectations.map((a) => ({
      date: a.date,
      type: a.type,
      vetId: a.vetId,
      propositionId: p.id,
    })),
  )
}

/**
 * Confronte les places proposées à l'état réel de la grille.
 *
 * Un créneau proposé que la grille n'affiche pas (hors du mois visible, par
 * exemple) est ignoré : on ne peut pas dessiner une case qui n'est pas là.
 * Un créneau dont les occupants ne changent pas — la proposition ne fait que
 * permuter les rôles — n'est pas retenu non plus : il n'y a rien à montrer.
 */
export function calculerApercuCreneaux(
  placesProposees: readonly PlaceProposee[],
  creneauxActuels: readonly CreneauActuel[],
): Record<string, ApercuCreneau> {
  // Ce que chaque créneau contiendrait après application.
  const proposeParCle = new Map<string, { vets: Set<string>; propositionId: string }>()
  for (const place of placesProposees) {
    const cle = cleCreneau(place.date, place.type)
    let entree = proposeParCle.get(cle)
    if (!entree) {
      entree = { vets: new Set(), propositionId: place.propositionId }
      proposeParCle.set(cle, entree)
    }
    // `vetId: null` vide la place : elle ne met donc personne dans l'ensemble
    // proposé. La personne qui l'occupait ressortira en `sortants`.
    if (place.vetId) entree.vets.add(place.vetId)
  }

  const apercu: Record<string, ApercuCreneau> = {}

  for (const creneau of creneauxActuels) {
    const cle = cleCreneau(creneau.date, creneau.type)
    const propose = proposeParCle.get(cle)
    if (!propose) continue

    const actuels = new Set(creneau.occupants.filter((v): v is string => Boolean(v)))

    const sortants = [...actuels].filter((v) => !propose.vets.has(v))
    const entrants = [...propose.vets].filter((v) => !actuels.has(v))

    // Permutation de rôles pure : mêmes personnes avant et après. Rien à
    // signaler — et surtout pas une case marquée « ça change » qui, une fois
    // ouverte, ne montrerait aucune différence.
    if (sortants.length === 0 && entrants.length === 0) continue

    apercu[cle] = { propositionId: propose.propositionId, sortants, entrants }
  }

  return apercu
}
