// ============================================================
// GUARDVETO — Helpers de forme sur AttributionGarde (modèle « placements »)
// ============================================================
// Accesseurs PURS sur la forme de données `AttributionGarde` (liste de placements).
// AUCUNE logique de contrainte ici — uniquement lire/écrire des places. C'est le
// pendant, côté MOTEUR, du modèle P3a. Le validateur INDÉPENDANT ré-implémente ses
// propres accesseurs (il ne partage jamais de logique avec le solver — cf. en-tête
// de validation/validerPlanning.ts).
//
// Immutabilité : le solver repose sur des plannings immuables entre branches de
// backtracking. `avecVet` et `clonerAttribution` créent donc TOUJOURS de nouveaux
// objets — jamais de mutation en place.
// ============================================================

import type { AttributionGarde, CodeCreneau, RoleGarde } from './types'

/** Véto d'une place (par label de rôle), ou null si la place est absente/non pourvue. */
export function vetPourRole(attr: AttributionGarde, role: RoleGarde): string | null {
  return attr.placements.find((p) => p.role === role)?.vetId ?? null
}

/** Véto de la place 'premier' (compat historique). */
export function premierId(attr: AttributionGarde): string | null {
  return vetPourRole(attr, 'premier')
}

/** Véto de la place 'second' (compat historique). */
export function secondId(attr: AttributionGarde): string | null {
  return vetPourRole(attr, 'second')
}

/** Le véto occupe-t-il l'une des places de ce créneau ? (généralise premier_id===v || second_id===v) */
export function estAttribue(attr: AttributionGarde, vetId: string): boolean {
  return attr.placements.some((p) => p.vetId === vetId)
}

/** Label du rôle occupé par `vetId` sur cette attribution, ou null s'il n'y figure pas. */
export function roleDuVet(attr: AttributionGarde, vetId: string): string | null {
  return attr.placements.find((p) => p.vetId === vetId)?.role ?? null
}

/** Ids des vétos effectivement placés (places non pourvues ignorées). */
export function vetsAttribues(attr: AttributionGarde): string[] {
  return attr.placements.map((p) => p.vetId).filter((v): v is string => v !== null)
}

/**
 * Attribution vide : places déclarées (par label) mais non pourvues.
 * Défaut ['premier', 'second'] → miroir exact de { premier_id: null, second_id: null }.
 */
export function attributionVide(
  date: string,
  type: CodeCreneau,
  roles: RoleGarde[] = ['premier', 'second'],
): AttributionGarde {
  return { date, type, placements: roles.map((role) => ({ role, vetId: null })) }
}

/**
 * Copie IMMUABLE de `attr` avec la place `role` = `vetId` (crée la place si absente).
 * Ne mute jamais l'entrée — sûr pour le backtracking.
 */
export function avecVet(attr: AttributionGarde, role: RoleGarde, vetId: string | null): AttributionGarde {
  const existe = attr.placements.some((p) => p.role === role)
  const placements = existe
    ? attr.placements.map((p) => (p.role === role ? { ...p, vetId } : { ...p }))
    : [...attr.placements.map((p) => ({ ...p })), { role, vetId }]
  return { ...attr, placements }
}

/** Copie profonde (immutabilité défensive). */
export function clonerAttribution(attr: AttributionGarde): AttributionGarde {
  return { ...attr, placements: attr.placements.map((p) => ({ ...p })) }
}
