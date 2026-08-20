// ============================================================
// GUARDVETO — Ce qui est DIFFUSÉ, et à qui
// ============================================================
// Un planning a deux vies : celle où l'administratrice le prépare, et celle
// où l'équipe le connaît. Le passage de l'une à l'autre porte un nom en base
// — `publie_at` — et rien d'autre ne fait foi.
//
// ⚠️ LE CRITÈRE EST `publie_at`, JAMAIS LE STATUT.
// Une période peut être « verrouillée » sans avoir jamais été diffusée : c'est
// exactement le cas d'un historique amorcé en base pour démarrer un cabinet.
// Filtrer sur `statut !== 'brouillon'` laisserait donc passer ce passé-là, et
// le même raisonnement a déjà coûté 38 événements de brouillon dans l'agenda
// Google d'un client (cf. `lib/sync-calendrier.ts`, « UN BROUILLON NE SORT PAS
// DU LOGICIEL »).
//
// Ce module existe pour que ce critère ne soit écrit qu'UNE fois : un état
// interne n'a de valeur que si TOUS les canaux sortants le respectent, et un
// canal qui réécrit le test à sa façon finit toujours par le réécrire de
// travers.
// ============================================================

/** Le seul test qui dit si un planning est sorti du logiciel. */
export function estDiffusee(periode: { publie_at?: string | null } | null | undefined): boolean {
  return Boolean(periode?.publie_at)
}

/**
 * Les périodes qu'une personne a le droit de voir.
 *
 * L'administratrice voit tout — c'est elle qui prépare. Un vétérinaire ne voit
 * QUE ce qui lui a été diffusé : un brouillon qu'il consulterait deviendrait
 * une promesse, et il organiserait sa vie dessus avant qu'elle ne soit tenue.
 */
export function periodesVisibles<T extends { publie_at?: string | null }>(
  periodes: T[],
  estAdmin: boolean,
): T[] {
  return estAdmin ? periodes : periodes.filter(estDiffusee)
}

/**
 * Filtre des lignes rattachées à une période (gardes, compteurs, exceptions…)
 * sur les seules périodes visibles.
 *
 * Le filtre porte sur `periode_id` et non sur une quelconque colonne d'état :
 * les vues d'affichage (`planning_semaine`) n'exposent pas `publie_at`, et
 * relire le statut depuis la vue reviendrait à retomber dans le piège
 * ci-dessus.
 */
export function lignesDesPeriodes<T extends { periode_id: string }>(
  lignes: T[],
  periodes: { id: string }[],
): T[] {
  const autorisees = new Set(periodes.map((p) => p.id))
  return lignes.filter((l) => autorisees.has(l.periode_id))
}
