// ============================================================
// GUARDVETO — Le gabarit du titre d'un événement Google Agenda
// ============================================================
// Décidé par MiKL, séparateur tiret : base - nom - rôle [- horaires].
// Exemples : « garde-ACB-1er » · « garde-ACB-1er-18h/08h ».
//
// Le rôle DOIT toujours apparaître : sans lui, les deux événements du même
// jour (1er et 2nd de garde) sont indiscernables dans l'agenda.
//
// ⚠️ Cette fonction est PURE : elle reçoit tout en paramètre (base, nom,
// rôle, horaires, option) et ne recalcule ni ne décale jamais les horaires
// qu'on lui donne. Un bug distinct de production affiche 20h/10h au lieu de
// 18h/08h — c'est le calcul EN AMONT qui est fautif, pas ce gabarit ; le
// reproduire ici referait la même erreur une deuxième fois.
// ============================================================

export interface HorairesGarde {
  debut: string
  fin: string
}

export interface OptionsLibelleGarde {
  base: string
  nom: string
  role: string
  /** Horaires réels, ou absents. Ignorés si `afficherHoraires` est faux. */
  horaires?: HorairesGarde | null
  /** Coché par le cabinet dans sa config — voir `couverture-produit.ts`. */
  afficherHoraires: boolean
}

/**
 * Compose le titre. Chaque segment vide est simplement omis — jamais de
 * tiret orphelin en fin de chaîne, jamais de double tiret pour un segment
 * manquant au milieu (nom vide entre base et rôle, par exemple).
 */
export function libelleGarde({
  base,
  nom,
  role,
  horaires,
  afficherHoraires,
}: OptionsLibelleGarde): string {
  const segments: string[] = []

  const baseTrim = base.trim()
  if (baseTrim) segments.push(baseTrim)

  const nomTrim = nom.trim()
  if (nomTrim) segments.push(nomTrim)

  const roleTrim = role.trim()
  if (roleTrim) segments.push(roleTrim)

  // L'option est cochée mais les horaires manquent (garde non encore
  // chiffrée, période sans créneau standard) : on omet le segment plutôt
  // que d'afficher un trou ou une valeur inventée.
  if (afficherHoraires && horaires) {
    const debut = horaires.debut.trim()
    const fin = horaires.fin.trim()
    if (debut && fin) segments.push(`${debut}/${fin}`)
  }

  return segments.join('-')
}
