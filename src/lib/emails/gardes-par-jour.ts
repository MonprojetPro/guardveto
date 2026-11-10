// ============================================================
// Ce qu'un mail dit des gardes d'une personne — JOUR PAR JOUR
// ============================================================
// B-197 (10/11/2026). Le mail « Nouveau planning » listait les LIGNES de la
// table `gardes`. Une ligne week-end couvre trois jours (vendredi, samedi,
// dimanche) et peut porter un remplaçant différent sur un seul d'entre eux
// (B-061 : Noël, Jour de l'an). Le mail savait que la personne était concernée
// par la ligne, puis lui affichait la ligne ENTIÈRE : date du samedi,
// « Week-end », binôme du samedi.
//
// Résultat payé chez le premier client : Manon, qui tient le seul 25/12, a
// reçu « samedi 26 décembre — Week-end, avec Victor ». Six mails faux sur sept.
//
// Règle portée ici : une personne reçoit les JOURS qu'elle tient réellement,
// avec le binôme RÉEL de chacun de ces jours. Des jours consécutifs d'une même
// garde, avec le même binôme, sont regroupés en une ligne ; dès que le binôme
// change ou qu'un jour ne lui appartient pas, la ligne se coupe.
// ============================================================

import { occupantReel, type GardeTitulaires } from '@/lib/gardes/exceptions-jour'
import { datesCouvertesParGardeV1 } from '@/engine/utils'

/** Une garde telle que le mail la lit : ses titulaires et son type. */
export interface GardeAvecType extends GardeTitulaires {
  id: string
  type: string
}

/** Une ligne du mail : un ou plusieurs jours consécutifs d'une même garde. */
export interface LigneGardeMail {
  gardeId: string
  type: string
  /** Les jours tenus, dans l'ordre. Jamais vide. */
  jours: string[]
  /** Tous les jours que couvre la garde (3 pour un week-end, 1 sinon). */
  joursDeLaGarde: string[]
  /** L'autre personne de garde ces jours-là, `null` = seul ou place vide. */
  binomeId: string | null
}

/** Le rôle tenu par `vetId` ce jour-là, et l'occupant de l'autre place. */
function placeDuJour(
  garde: GardeAvecType,
  index: Map<string, string | null>,
  jour: string,
  vetId: string,
): { binomeId: string | null } | null {
  const premier = occupantReel(garde, index, jour, 'premier')
  const second = occupantReel(garde, index, jour, 'second')
  if (premier === vetId) return { binomeId: second === vetId ? null : second }
  if (second === vetId) return { binomeId: premier }
  return null
}

/**
 * Les lignes du mail de `vetId`, triées par date.
 *
 * ⚠️ Places 3 et au-delà (`garde_placements`) non couvertes : elles n'acceptent
 *    pas de remplacement ponctuel, et les mails ne les ont jamais listées.
 *    Limite écrite, reprise de `rolesTenusParVeto`.
 */
export function lignesGardesDuVeto(
  gardes: readonly GardeAvecType[],
  index: Map<string, string | null>,
  vetId: string,
): LigneGardeMail[] {
  const lignes: LigneGardeMail[] = []

  for (const garde of gardes) {
    const joursDeLaGarde = datesCouvertesParGardeV1(garde.date, garde.type)
    let courante: LigneGardeMail | null = null

    for (const jour of joursDeLaGarde) {
      const place = placeDuJour(garde, index, jour, vetId)
      if (!place) {
        courante = null // un jour qui n'est pas à elle coupe la ligne
        continue
      }
      if (courante && courante.binomeId === place.binomeId) {
        courante.jours.push(jour)
        continue
      }
      courante = {
        gardeId: garde.id,
        type: garde.type,
        jours: [jour],
        joursDeLaGarde,
        binomeId: place.binomeId,
      }
      lignes.push(courante)
    }
  }

  return lignes.sort((a, b) => a.jours[0].localeCompare(b.jours[0]))
}

/** Vrai si la ligne ne porte qu'une partie de la garde (ex. le seul vendredi). */
export function ligneEstPartielle(ligne: LigneGardeMail): boolean {
  return ligne.jours.length < ligne.joursDeLaGarde.length
}

/** « vendredi », « samedi et dimanche » — les jours d'une ligne partielle. */
export function nomsDesJours(jours: readonly string[]): string {
  const noms = jours.map((j) =>
    new Date(j + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'UTC' }),
  )
  if (noms.length <= 1) return noms.join('')
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`
}
