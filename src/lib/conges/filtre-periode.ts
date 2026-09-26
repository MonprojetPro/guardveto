// ============================================================
// B-131 — ne voir que les congés d'une période, ou d'une plage de dates
// ============================================================
// MiKL, le 26/09, retour de réunion client : « mettre un filtre dans congé pour
// trier les congés que pour une période, ou une zone de date particulière ». La
// liste montrait tout, sans moyen de se concentrer sur la période en cours de
// traitement — et c'est pourtant toujours sur UNE période qu'on travaille.
//
// ⚠️ LE CRITÈRE EST LE CHEVAUCHEMENT, PAS L'INCLUSION. C'est la seule décision
//    de ce module, et elle n'est pas neutre : un congé du 15 au 25 octobre
//    concerne bel et bien une période qui commence le 19. Exiger qu'il tienne
//    ENTIÈREMENT dans la fenêtre l'aurait fait disparaître de la liste au
//    moment précis où l'admin le cherche — un filtre qui cache ce qu'on cherche
//    est pire qu'aucun filtre, parce qu'il donne l'impression d'avoir regardé.
// ============================================================

/** Ce qu'une absence doit porter pour être filtrable : ses deux bornes. */
export interface AbsenceDatee {
  date_debut: string
  date_fin: string
}

/**
 * La fenêtre demandée. Les deux bornes sont FACULTATIVES et indépendantes :
 * « à partir du 1er novembre » et « jusqu'au 31 décembre » sont deux demandes
 * légitimes, et exiger les deux aurait obligé l'admin à inventer une date
 * qu'il n'a pas.
 */
export interface Fenetre {
  debut?: string | null
  fin?: string | null
}

/** Une date ISO exploitable — ni vide, ni un reste de champ à demi rempli. */
function borneUtile(v?: string | null): string | null {
  const s = (v ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/**
 * chevauche — l'absence touche-t-elle la fenêtre, même partiellement ?
 *
 * Comparaison sur les chaînes ISO : `AAAA-MM-JJ` s'ordonne lexicographiquement
 * comme chronologiquement, et on évite ainsi tout `new Date()` — donc tout
 * décalage de fuseau, qui sur ce projet a déjà fait glisser des dates d'un jour.
 *
 * Fenêtre sans aucune borne utile → tout passe. C'est volontaire : un champ de
 * date à moitié saisi ne doit pas vider la liste sous les doigts de l'admin,
 * qui croirait avoir zéro congé alors qu'il est en train de taper.
 */
export function chevauche(absence: AbsenceDatee, fenetre: Fenetre): boolean {
  const debut = borneUtile(fenetre.debut)
  const fin = borneUtile(fenetre.fin)
  // Bornes inversées (fin < début) : on ne « corrige » pas en silence, on ne
  // filtre pas. Réordonner ferait apparaître des résultats que personne n'a
  // demandés, et l'admin croirait sa saisie comprise.
  if (debut && fin && fin < debut) return false
  if (fin && absence.date_debut > fin) return false
  if (debut && absence.date_fin < debut) return false
  return true
}

/** Garde les absences qui touchent la fenêtre. */
export function filtrerParFenetre<T extends AbsenceDatee>(
  absences: readonly T[],
  fenetre: Fenetre,
): T[] {
  return absences.filter((a) => chevauche(a, fenetre))
}
