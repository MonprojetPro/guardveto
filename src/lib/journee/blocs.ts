// ============================================================
// GUARDVETO — Ce qui fait une tranche horaire valide
// ============================================================
// B-120 chantier 2. La validation vit ICI, dans une fonction pure, et pas
// dans l'action serveur ni dans le formulaire — pour trois raisons qui ont
// toutes été payées sur ce projet :
//
// ① Elle est testable sans base ni réseau. Une validation qui n'est testable
//    qu'en cliquant n'est jamais testée.
// ② Le formulaire ET l'action l'appellent. Un contrôle posé seulement dans
//    l'écran est un contrôle que l'URL contourne (« trois chemins d'écriture,
//    deux gardiens », 22/08).
// ③ Les messages sont écrits en français lisible, à un seul endroit. La modale
//    de refus reprend les messages serveur mot pour mot — c'est donc ici que
//    la traduction doit avoir lieu.
//
// ⚠️ LA BASE GARDE AUSSI. Les mêmes règles sont des CHECK dans la migration
//    20261001120000. Ce n'est pas une redondance inutile : si un jour une
//    écriture arrive par un chemin qu'on n'a pas prévu, c'est la base qui
//    refuse. Les deux gardiens disent la même chose, délibérément.
// ============================================================

import type { CreneauBlocJournee } from '@/types'

/** Les créneaux d'absence auxquels un bloc peut se rattacher. */
export const CRENEAUX_BLOC: readonly CreneauBlocJournee[] = [
  'matin',
  'apres-midi',
  'journee',
] as const

/** Le libellé lisible d'un créneau, pour l'écran. Source unique. */
export const LIBELLE_CRENEAU: Record<CreneauBlocJournee, string> = {
  matin: 'Matin',
  'apres-midi': 'Après-midi',
  journee: 'Journée entière',
}

/** Ce qu'un formulaire envoie, avant toute confiance. */
export interface SaisieBloc {
  nom: string
  debut: string
  fin: string
  creneau: string
}

/** Une saisie acceptée, normalisée, prête pour la base. */
export interface BlocValide {
  nom: string
  debut: string
  fin: string
  creneau: CreneauBlocJournee
}

export type Validation =
  | { ok: true; valeur: BlocValide }
  /** Le message est DÉJÀ en français, affichable tel quel. */
  | { ok: false; probleme: string }

/** `HH:MM` ou `HH:MM:SS`, bornes réelles sur les heures et les minutes. */
const FORME_HEURE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/

/**
 * Normalise une heure en `HH:MM`.
 *
 * Postgres rend `08:00:00` pour un `time`, un `<input type="time">` envoie
 * `08:00`. Sans ce passage obligé, comparer les deux formes aurait produit des
 * faux écarts à l'affichage — le genre de différence invisible qui fait dire
 * « ça n'a pas enregistré » alors que tout est en place.
 */
export function normaliserHeure(brut: string): string | null {
  const t = (brut ?? '').trim()
  if (!FORME_HEURE.test(t)) return null
  return t.slice(0, 5)
}

/** Les minutes depuis minuit. Sert à comparer deux heures sans objet Date. */
function minutes(heure: string): number {
  const [h, m] = heure.split(':').map(Number)
  return h * 60 + m
}

/**
 * Une saisie de bloc est-elle acceptable ?
 *
 * ⚠️ CE QU'ON NE REFUSE PAS, DÉLIBÉRÉMENT : le CHEVAUCHEMENT avec un autre
 *    bloc. « Journée complète » 8h→18h recouvre par construction « Matin » et
 *    « Après-midi » — c'est le cas d'usage principal décrit par MiKL, pas une
 *    erreur de saisie. Les blocs sont un vocabulaire de tranches proposées,
 *    jamais un découpage exclusif de la journée.
 *
 * ⚠️ On ne refuse pas non plus un bloc « à cheval » (12h→14h) : son créneau de
 *    rattachement est choisi par l'admin. Deviner à sa place aurait inventé
 *    une règle que personne n'a demandée.
 */
export function validerBloc(saisie: SaisieBloc): Validation {
  const nom = (saisie.nom ?? '').trim()
  if (!nom) {
    return { ok: false, probleme: 'Donnez un nom à cette tranche horaire.' }
  }
  if (nom.length > 40) {
    return {
      ok: false,
      probleme: 'Ce nom est trop long pour la grille (40 caractères au maximum).',
    }
  }

  const debut = normaliserHeure(saisie.debut)
  if (!debut) {
    return { ok: false, probleme: "L'heure de début n'est pas une heure valide." }
  }
  const fin = normaliserHeure(saisie.fin)
  if (!fin) {
    return { ok: false, probleme: "L'heure de fin n'est pas une heure valide." }
  }
  if (minutes(fin) <= minutes(debut)) {
    return {
      ok: false,
      probleme: `La fin (${fin}) doit être après le début (${debut}).`,
    }
  }

  const creneau = saisie.creneau as CreneauBlocJournee
  if (!CRENEAUX_BLOC.includes(creneau)) {
    // Le cas le plus probable est 'soiree', et il mérite son explication :
    // refuser sans dire pourquoi aurait renvoyé l'admin à essayer autrement.
    return {
      ok: false,
      probleme:
        saisie.creneau === 'soiree'
          ? 'Le soir est géré par le planning de gardes, pas par le planning de journée.'
          : 'Indiquez à quel moment de la journée cette tranche se rattache.',
    }
  }

  return { ok: true, valeur: { nom, debut, fin, creneau } }
}

/**
 * Deux blocs portent-ils le même nom ? (casse et espaces de bord ignorés)
 *
 * La base le refuse déjà par un index unique. On le redemande ici pour une
 * raison d'usage, pas de sécurité : un refus de contrainte Postgres remonte
 * un message technique que personne ne comprend, là où l'écran peut dire
 * « vous avez déjà une tranche qui s'appelle Matin ».
 */
export function nomDejaPris(
  nom: string,
  existants: readonly { id: string; nom: string }[],
  sauf?: string,
): boolean {
  const cible = nom.trim().toLowerCase()
  return existants.some((b) => b.id !== sauf && b.nom.trim().toLowerCase() === cible)
}

/** L'affichage d'une plage, tel qu'on l'écrit partout : « 8h → 12h ». */
export function plageLisible(debut: string, fin: string): string {
  const lisible = (h: string) => {
    const [hh, mm] = h.slice(0, 5).split(':')
    const heure = Number(hh)
    return mm === '00' ? `${heure}h` : `${heure}h${mm}`
  }
  return `${lisible(debut)} → ${lisible(fin)}`
}
