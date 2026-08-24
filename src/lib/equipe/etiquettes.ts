// ============================================================
// GUARDVETO — Le jumeau orthographique d'une étiquette
// ============================================================
// Les étiquettes (« junior », « senior », « mi-temps »…) ne sont pas des
// décorations : les règles de composition du cabinet portent dessus, à la
// lettre près. `regles/actions.ts` refuse d'ailleurs une règle sur une
// étiquette que personne ne porte.
//
// Le danger n'est donc PAS l'étiquette inventée — en créer une nouvelle est
// parfaitement légitime, et le cabinet a le droit d'enrichir son vocabulaire.
// Le danger est le JUMEAU : écrire « séniors » là où l'équipe dit « senior ».
// Le geste réussit, la fiche affiche la nouvelle étiquette, l'admin voit que ça
// a marché — et les règles portant sur « senior » cessent d'atteindre cette
// personne, sans un mot. Le contrôle des règles ne rattrape rien : l'étiquette
// fautive est désormais portée, donc valide à ses yeux.
//
// D'où ce module : purement comparatif, il ne décide rien. Il dit « ça
// ressemble à ce qui existe déjà » et laisse l'appelant poser la question.
// ============================================================

/** Les signes diacritiques, écrits en échappements : la classe de caractères
 *  saisie littéralement est invisible à la relecture et facile à casser. */
const DIACRITIQUES = /[̀-ͯ]/g

/**
 * La forme sur laquelle on compare : minuscules, sans accents, sans espaces
 * en bordure. On garde volontairement les tirets et les espaces internes —
 * « mi-temps » et « mi temps » DOIVENT rester deux écritures distinctes qu'on
 * signale l'une à l'autre, pas deux formes qu'on confond en silence.
 */
export function clefEtiquette(etiquette: string): string {
  return etiquette.normalize('NFD').replace(DIACRITIQUES, '').trim().toLowerCase()
}

/**
 * Distance d'édition, plafonnée. Au-delà du plafond on rend `plafond + 1` :
 * on n'a pas besoin de savoir de combien deux mots diffèrent quand ils
 * diffèrent trop.
 *
 * Le plafond de 1 n'est pas une frilosité, c'est ce qui sépare le jumeau du
 * faux positif : « senior » et « seniors » sont à 1, « senior » et « junior »
 * sont à 2. Élargir attraperait des étiquettes réellement différentes et
 * ferait poser une question absurde à chaque fois.
 */
export function distanceEdition(a: string, b: string, plafond = 1): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > plafond) return plafond + 1

  let precedente = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const courante = [i, ...new Array<number>(b.length).fill(0)]
    let meilleureDeLaLigne = i
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1
      courante[j] = Math.min(courante[j - 1] + 1, precedente[j] + 1, precedente[j - 1] + cout)
      if (courante[j] < meilleureDeLaLigne) meilleureDeLaLigne = courante[j]
    }
    // Toute la ligne dépasse déjà le plafond : la suite ne peut que grandir.
    if (meilleureDeLaLigne > plafond) return plafond + 1
    precedente = courante
  }
  const d = precedente[b.length]
  return d > plafond ? plafond + 1 : d
}

/** Une étiquette demandée qui n'existe pas encore, et ce à quoi elle ressemble. */
export interface ProximiteEtiquette {
  /** L'étiquette telle qu'elle a été demandée, normalisée (minuscules, trimée). */
  demandee: string
  /** Les étiquettes DÉJÀ en usage dont elle est à un cheveu. Jamais vide. */
  proches: string[]
}

/**
 * Confronte des étiquettes demandées au vocabulaire réellement en usage.
 *
 * Ne rend QUE les cas ambigus : une étiquette déjà en usage ne remonte pas
 * (rien à demander), une étiquette franchement nouvelle non plus (« astreinte »
 * quand le cabinet dit « junior » et « senior » — c'est une création, pas une
 * faute de frappe).
 */
export function etiquettesProches(
  demandees: readonly string[],
  enUsage: readonly string[],
): ProximiteEtiquette[] {
  const vocabulaire = [
    ...new Map(
      enUsage
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t !== '')
        .map((t) => [t, t] as const),
    ).values(),
  ]

  const dejaVues = new Set<string>()
  const resultats: ProximiteEtiquette[] = []

  for (const brute of demandees) {
    if (typeof brute !== 'string') continue
    const demandee = brute.trim().toLowerCase()
    if (demandee === '' || dejaVues.has(demandee)) continue
    dejaVues.add(demandee)

    // Déjà dans le vocabulaire : c'est le cas normal, rien à signaler.
    if (vocabulaire.includes(demandee)) continue

    const clef = clefEtiquette(demandee)
    const proches = vocabulaire.filter((existante) => {
      const clefExistante = clefEtiquette(existante)
      // Même clef = même mot à l'accent près (« sénior » ↔ « senior ») ;
      // distance 1 = une lettre d'écart (« seniors » ↔ « senior »).
      return clefExistante === clef || distanceEdition(clef, clefExistante) <= 1
    })

    if (proches.length > 0) resultats.push({ demandee, proches })
  }

  return resultats
}
