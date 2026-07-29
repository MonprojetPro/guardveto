// ============================================================
// GUARDVETO — Les places d'une garde, en une seule liste
// ============================================================
// Une garde peut compter jusqu'à 4 places (N_PLACES_MAX du catalogue), mais
// la table `gardes` n'en porte que deux : `premier_id` et `second_id`. Les
// suivantes vivent dans le miroir `garde_placements`, exposé par la vue
// `planning_semaine` sous forme de `places_sup`.
//
// Ce module est la SOURCE UNIQUE qui recolle les deux : tout ce qui affiche,
// exporte ou notifie les vétérinaires d'une garde doit passer par ici, sinon
// il oubliera les places 3 et 4 — en silence, ce qui est le pire des cas
// (un vétérinaire de garde qui n'apparaît nulle part).
// ============================================================

import type { GardeDenormalisee, PlaceSupplementaire } from '@/types'

/** Une place pourvue ou vide, dans l'ordre du créneau. */
export interface PlaceGarde {
  /** 0 = première place, 1 = deuxième, etc. */
  index: number
  /** Libellé du rôle : « 1er », « 2e », ou le rôle sur-mesure du catalogue. */
  role: string
  vetId: string | null
  prenom: string | null
  nom: string | null
  couleur: string | null
}

/** Rôle par défaut d'une place, quand le catalogue n'en fournit pas. */
export function roleParDefaut(index: number): string {
  if (index === 0) return '1er'
  return `${index + 1}e`
}

/**
 * placesDeGarde — toutes les places POURVUES d'une garde, dans l'ordre.
 *
 * Les places 0 et 1 viennent des colonnes `premier_` et `second_` : ce sont
 * elles qui portent l'inversion du vendredi, il ne faut donc jamais les
 * relire depuis le miroir.
 * Les suivantes viennent de `places_sup`.
 *
 * Une place vide n'est pas renvoyée : on ne sait pas ici combien de places le
 * créneau compte (c'est le catalogue qui le dit), et dessiner un « à pourvoir »
 * sur un créneau à une seule place inventerait un trou qui n'existe pas.
 */
export function placesDeGarde(garde: {
  premier_id?: string | null
  premier_prenom?: string | null
  premier_nom?: string | null
  premier_couleur?: string | null
  second_id?: string | null
  second_prenom?: string | null
  second_nom?: string | null
  second_couleur?: string | null
  places_sup?: PlaceSupplementaire[] | null
}): PlaceGarde[] {
  const places: PlaceGarde[] = []

  if (garde.premier_prenom || garde.premier_id) {
    places.push({
      index: 0,
      role: roleParDefaut(0),
      vetId: garde.premier_id ?? null,
      prenom: garde.premier_prenom ?? null,
      nom: garde.premier_nom ?? null,
      couleur: garde.premier_couleur ?? null,
    })
  }

  if (garde.second_prenom || garde.second_id) {
    places.push({
      index: 1,
      role: roleParDefaut(1),
      vetId: garde.second_id ?? null,
      prenom: garde.second_prenom ?? null,
      nom: garde.second_nom ?? null,
      couleur: garde.second_couleur ?? null,
    })
  }

  // Le miroir peut arriver dans le désordre selon la source : on trie ici
  // plutôt que de faire confiance à l'appelant.
  for (const p of [...(garde.places_sup ?? [])].sort((a, b) => a.place_index - b.place_index)) {
    if (p.place_index < 2) continue // déjà couvert par premier_/second_
    places.push({
      index: p.place_index,
      role: p.role || roleParDefaut(p.place_index),
      vetId: p.id,
      prenom: p.prenom,
      nom: p.nom,
      couleur: p.couleur,
    })
  }

  return places
}

/** Tous les vétérinaires de garde, sans doublon — pour notifier ou compter. */
export function vetsDeGarde(garde: Parameters<typeof placesDeGarde>[0]): string[] {
  const ids = placesDeGarde(garde)
    .map((p) => p.vetId)
    .filter((id): id is string => Boolean(id))
  return [...new Set(ids)]
}

/**
 * La garde compte-t-elle des places que les colonnes V1 ne portent pas ?
 * Sert aux écrans qui savent encore n'en montrer que deux : ils peuvent le
 * DIRE au lieu de laisser croire que la garde est complète.
 */
export function aDesPlacesSupplementaires(garde: { places_sup?: PlaceSupplementaire[] | null }): boolean {
  return (garde.places_sup ?? []).some((p) => p.place_index >= 2)
}
