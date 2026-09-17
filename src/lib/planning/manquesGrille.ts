// ============================================================
// GUARDVETO — Les places qui manquent, vues de la GRILLE (B-125)
// ============================================================
// MiKL, le 17/09, après avoir durci « 1 week-end sur 3 » et récupéré trois
// week-ends incomplets : *« il faudrait que les jours où il manque quelqu'un ça
// apparaisse visuellement sur le planning pour ne pas chercher inutilement. »*
//
// Il a tranché en même temps que les trous sont ASSUMÉS : Anne-Catherine
// n'intervient que sur ordre de l'admin, et l'admin comble à la main. Un trou
// n'est donc pas une erreur à corriger automatiquement — c'est un travail qui
// l'attend, et qu'il faut pouvoir trouver sans balayer douze semaines à l'œil.
//
// ── POURQUOI LA GRILLE NE LES MONTRAIT PAS ─────────────────────────────────
//
// `placesDeGarde` ne renvoie que les places POURVUES, et son commentaire dit
// pourquoi : « on ne sait pas ici combien de places le créneau compte, et
// dessiner un "à pourvoir" sur un créneau à une seule place inventerait un trou
// qui n'existe pas ». La prudence était juste ; il manquait simplement
// l'information.
//
// Elle existe pourtant, et elle est déjà testée : `placesAttendues` la calcule
// pour Filou depuis B-053. La grille était le seul écran à ne pas l'appeler.
//
// ⚠️ `null` EST UNE RÉPONSE, PAS UN ÉCHEC. Quand l'attendu est indéterminé
// (catalogue muet, ou profils en désaccord sur le code), on n'affiche RIEN.
// Se taire est toujours préférable à afficher un trou imaginaire : une case
// « à pourvoir » qui n'a pas lieu d'être enverrait l'admin chercher un
// remplaçant pour une garde déjà complète.
// ============================================================

import {
  placesAttendues,
  manqueSurGarde,
  type PlacesParCode,
  type PeriodeEffectif,
  type ProfilEffectif,
} from './placesAttendues'

/** Une garde telle que la grille la connaît, réduite à ce qui sert au calcul. */
export interface GardePourManque {
  id: string
  date: string
  type: string
  /** Nombre de places réellement pourvues — compté par `placesDeGarde`. */
  pourvues: number
}

/**
 * Combien de personnes manquent sur chaque garde, par identifiant de garde.
 *
 * Les gardes complètes et celles dont l'attendu est indéterminé sont absentes
 * du résultat : la grille n'a rien à dessiner pour elles, et une entrée à zéro
 * inviterait un appelant distrait à afficher « 0 place à pourvoir ».
 */
export function calculerManques(
  gardes: readonly GardePourManque[],
  contexte: {
    catalogue: PlacesParCode
    periodes: readonly PeriodeEffectif[]
    profils: ReadonlyMap<string, ProfilEffectif>
  },
): Record<string, number> {
  const manques: Record<string, number> = {}

  for (const g of gardes) {
    const attendues = placesAttendues({
      typePlanning: g.type,
      date: g.date,
      catalogue: contexte.catalogue,
      periodes: contexte.periodes,
      profils: contexte.profils,
    })
    const manque = manqueSurGarde(attendues, g.pourvues)
    if (manque !== null && manque > 0) manques[g.id] = manque
  }

  return manques
}
