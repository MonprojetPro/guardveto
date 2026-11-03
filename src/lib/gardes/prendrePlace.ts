// ============================================================
// GUARDVETO — Prendre soi-même une place vide (B-179c)
// ============================================================
// Décisions de MiKL (02/11) :
//   • n'importe quelle place PRÉVUE par le cabinet pour ce créneau (3e et 4e
//     comprises, selon le catalogue et l'effectif de la période) ;
//   • les RÈGLES ne bloquent jamais : ce que le moteur juge illégal devient un
//     avertissement, le vétérinaire peut accepter quand même, une trace reste
//     pour l'administratrice ;
//   • prise immédiate, administratrice prévenue ;
//   • planning publié, à partir de demain.
//
// Ce fichier porte les contrôles qui NE sont PAS des règles de planning — ceux
// sans lesquels le geste n'a pas de sens (une place qui n'existe pas, déjà
// prise, une garde passée). Eux bloquent. Pur, testé par
// `tests/lib/prendre-place.test.ts`.
// ============================================================

export interface RefusPrise {
  status: number
  error: string
}

export function controlerPrisePlace(args: {
  /** Aujourd'hui, heure de Paris, « AAAA-MM-JJ ». */
  aujourdhui: string
  /** Date de la garde. */
  date: string
  /** La période a été diffusée à l'équipe (`publie_at` posé). */
  periodePubliee: boolean
  /** Index 0-based de la place demandée. */
  placeIndex: number
  /** Places attendues pour ce créneau (`placesAttendues`), `null` = inconnu. */
  attendues: number | null
  /** Qui occupe chaque place, par index (absent = vide). */
  occupants: ReadonlyMap<number, string>
  moiVetId: string
}): RefusPrise | null {
  const { aujourdhui, date, placeIndex, attendues, occupants, moiVetId } = args

  if (!args.periodePubliee) {
    return { status: 403, error: 'Ce planning n’a pas encore été diffusé à l’équipe.' }
  }
  // « À partir de demain » : la garde du jour se règle avec l'administratrice,
  // pas par un clic la veille au soir dont personne ne serait prévenu à temps.
  if (date <= aujourdhui) {
    return { status: 422, error: 'On ne prend plus une place le jour même ni après : voyez avec l’administratrice.' }
  }
  if (!Number.isInteger(placeIndex) || placeIndex < 0) {
    return { status: 400, error: 'Place inconnue.' }
  }
  // Sans le nombre de places, on ne sait pas si la place existe : se taire vaut
  // mieux que laisser prendre une place que le cabinet n'a jamais prévue.
  if (attendues === null) {
    return { status: 422, error: 'Le nombre de places de ce créneau n’est pas connu : impossible de savoir si cette place existe.' }
  }
  if (placeIndex >= attendues) {
    return { status: 422, error: 'Ce créneau ne prévoit pas cette place.' }
  }
  for (const vet of occupants.values()) {
    if (vet === moiVetId) return { status: 409, error: 'Vous êtes déjà de garde sur ce créneau.' }
  }
  if (occupants.has(placeIndex)) {
    return { status: 409, error: 'Cette place vient d’être prise par quelqu’un d’autre.' }
  }
  return null
}

/**
 * B-179e — l'avertissement du moteur, dit à la personne qui prend la place.
 * `libelle` = SA règle (« Fanny ne fait pas de garde le mardi »), ou `null`
 * quand le moteur ne sait pas la nommer : alors une phrase générique, jamais
 * les règles des collègues.
 */
export function phraseMoteur(libelle: string | null): string {
  return libelle
    ? `Le moteur du planning ne vous aurait pas placé ici : ${libelle}.`
    : 'Le moteur du planning ne vous aurait pas placé ici : une règle de planning s’y oppose (repos, rythme ou binôme).'
}

/**
 * Côté écran : la première place vide d'une garde, d'après ce que la grille
 * sait déjà (places pourvues + manque calculé par `calculerManques`). Le
 * serveur refait le calcul de son côté — l'écran ne décide de rien, il évite
 * seulement d'offrir un bouton que le serveur refuserait à coup sûr.
 */
export function placeAPrendre(args: {
  indicesOccupes: readonly number[]
  vetIdsOccupants: readonly (string | null)[]
  manque: number
  moiVetId: string
  date: string
  aujourdhui: string
  publie: boolean
}): number | null {
  if (!args.moiVetId || !args.publie || args.manque <= 0) return null
  if (args.date <= args.aujourdhui) return null
  if (args.vetIdsOccupants.includes(args.moiVetId)) return null
  const occupes = new Set(args.indicesOccupes)
  const attendues = occupes.size + args.manque
  for (let i = 0; i < attendues; i++) if (!occupes.has(i)) return i
  return null
}

/** Le premier index vide parmi les places attendues, ou `null`. */
export function premierePlaceVide(attendues: number | null, occupants: ReadonlyMap<number, string>): number | null {
  if (attendues === null) return null
  for (let i = 0; i < attendues; i++) if (!occupants.has(i)) return i
  return null
}
