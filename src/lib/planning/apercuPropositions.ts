// ============================================================
// GUARDVETO — Ce qu'une proposition CHANGE sur la grille (B-123, refait)
// ============================================================
// MiKL, le 17/09, en recette : « je ne vois rien qui indique visuellement un
// quelconque changement, mis à part un petit encart pointillé discret sur
// Anne-Sophie le 1er décembre. Si c'est ça, ce n'est pas du tout ce que je
// demandais. »
//
// ── LE DÉFAUT DE LA PREMIÈRE VERSION, MESURÉ SUR LES VRAIES DONNÉES ─────────
//
// La v1 rendait `Record<date, Record<vetId, propId>>` : « ce vétérinaire
// ARRIVERAIT ce jour-là ». `PlanningV2` s'en servait ainsi :
//
//     const propositionId = p.vetId ? apercuDate?.[p.vetId] : undefined
//
// où `p.vetId` est la personne **actuellement** sur la place. Une case n'était
// donc marquée que si la personne qui doit ARRIVER y était **déjà** — c'est-à-
// dire exactement là où il n'y a rien à montrer.
//
// Mesuré sur la proposition F1 du 17/09 (`propositions_relecture`) : 6 places
// touchées sur 5 dates, toutes avec un `vetId`. Une seule case entourée à
// l'écran — Anne-Sophie le 1er décembre, la seule qui était déjà présente ce
// jour-là (en 2e, la proposition la veut en 1er). Les 5 autres faisaient
// arriver quelqu'un d'absent de la case : invisibles.
//
// Le test de la v1 passait pourtant au vert : il vérifiait la table
// intermédiaire, jamais sa confrontation à l'état réel de la grille.
//
// ── LA MÉTHODE RETENUE : COMPARER DEUX ENSEMBLES DE PERSONNES ───────────────
//
// On identifie un créneau par (date, type) — **jamais par rôle** — puis on
// compare l'ensemble des personnes qui l'occupent aujourd'hui à l'ensemble de
// celles que la proposition y met. D'où :
//
//     sortants = occupants actuels \ occupants proposés
//     entrants = occupants proposés \ occupants actuels
//
// ⚠️ POURQUOI LE RÔLE EST EXCLU DE L'IDENTIFICATION, ET PAS PAR PRUDENCE : la
// ligne du vendredi inverse rôles ET personnes entre le moteur et la vue
// (`resoudrePlanningAffichage`, couple `vendredi_soir → weekend`). C'est ce qui
// a fait échouer le cadenas le 04/09 (B-111) : comparer par libellé de rôle
// désignait la mauvaise personne un jour sur trois. Un ensemble de personnes
// sur un créneau, lui, ne s'inverse jamais — l'inversion permute les rôles À
// L'INTÉRIEUR du créneau, elle ne fait entrer ni sortir personne.
//
// ✅ Effet de bord voulu : une place qui se VIDE (`vetId: null`) devient enfin
// affichable. La v1 l'abandonnait faute de savoir qui l'occupait ; ici, la
// personne qui part sort naturellement de la différence d'ensembles, puisqu'on
// lit les occupants actuels.
// ============================================================

import type { ChangementPropose } from '@/engine/relecture/arbitrer'

export interface PropositionPourApercu {
  id: string
  changement: ChangementPropose
}

/**
 * Une place que la proposition veut occuper, à plat et sérialisable — ce qui
 * traverse la frontière serveur/client vers `PlanningV2`.
 */
export interface PlaceProposee {
  date: string
  type: string
  /** Rôle de DONNÉES visé par la proposition (`'premier'`, `'second'`…). */
  role: string
  /** `null` = la proposition VIDE cette place. */
  vetId: string | null
  propositionId: string
}

/** Une personne en place, avec le rôle de DONNÉES de sa place. */
export interface OccupantActuel {
  vetId: string | null
  /** `'premier'` / `'second'` — `null` au-delà de la 2e place. */
  role: string | null
}

/** Un créneau tel que la grille l'affiche réellement, occupants compris. */
export interface CreneauActuel {
  date: string
  type: string
  occupants: readonly OccupantActuel[]
}

/**
 * Le rôle permet-il de dire QUI part, sur ce type de créneau ?
 *
 * ⚠️ NON sur le vendredi soir, et c'est tout le piège de B-111. La ligne du
 * vendredi n'existe pas en base : elle est DÉRIVÉE du week-end par
 * `resoudrePlanningAffichage`, qui inverse rôles ET personnes. Le « premier »
 * affiché n'y est donc pas le « premier » que la proposition désigne, et
 * apparier les deux accuserait la mauvaise personne un jour sur trois — le
 * défaut exact payé le 04/09 sur les cadenas.
 *
 * Sur ce créneau-là on ne barre personne : on montre qui arrive, et on se tait
 * sur qui part. Mieux vaut ne rien dire que désigner quelqu'un à tort.
 */
function roleFiable(type: string): boolean {
  return type !== 'vendredi_soir'
}

/** Ce que la grille doit dessiner sur un créneau donné. */
export interface ApercuCreneau {
  /** La proposition à ouvrir si on clique une de ces cases. */
  propositionId: string
  /** Personnes qui quittent ce créneau — leur case actuelle est barrée. */
  sortants: string[]
  /** Personnes qui arrivent — dessinées en plus, en fantôme. */
  entrants: string[]
}

/**
 * Clé d'un créneau. Le rôle n'y entre pas : voir l'en-tête.
 *
 * ⚠️ LE TYPE EST NORMALISÉ, et sans ça l'appariement rate. Recette MiKL du
 * 20/09 : *« Filou propose de changer le week-end du 4, alors pourquoi le
 * vendredi 4 n'est pas lui aussi entouré ? »*. La proposition disait
 * `vendredi_soir` ; la grille affiche ce même jour avec le type `weekend`
 * (vérifié en base) — deux noms pour un seul créneau, donc deux clés qui ne se
 * rencontraient jamais. Le vendredi soir est la première soirée du week-end :
 * on les range sous le même toit.
 */
export function cleCreneau(date: string, type: string): string {
  return `${date}|${typeNormalise(type)}`
}

/** `vendredi_soir` et `weekend` désignent le même créneau — cf. `cleCreneau`. */
function typeNormalise(type: string): string {
  return type === 'vendredi_soir' ? 'weekend' : type
}

/**
 * Met les affectations de chaque proposition à plat. Sérialisable tel quel :
 * ce module tourne côté serveur, le résultat traverse vers le client.
 */
export function calculerPlacesProposees(
  propositions: readonly PropositionPourApercu[],
): PlaceProposee[] {
  return propositions.flatMap((p) =>
    p.changement.affectations.map((a) => ({
      date: a.date,
      type: a.type,
      role: a.role,
      vetId: a.vetId,
      propositionId: p.id,
    })),
  )
}

/**
 * Confronte les places proposées à l'état réel de la grille.
 *
 * Un créneau proposé que la grille n'affiche pas (hors du mois visible, par
 * exemple) est ignoré : on ne peut pas dessiner une case qui n'est pas là.
 * Un créneau dont les occupants ne changent pas — la proposition ne fait que
 * permuter les rôles — n'est pas retenu non plus : il n'y a rien à montrer.
 */
export function calculerApercuCreneaux(
  placesProposees: readonly PlaceProposee[],
  creneauxActuels: readonly CreneauActuel[],
): Record<string, ApercuCreneau> {
  // Les places que la proposition occupe sur chaque créneau — avec leur rôle,
  // parce qu'une proposition ne décrit QUE ce qu'elle change.
  const proposeParCle = new Map<string, { places: PlaceProposee[]; propositionId: string }>()
  for (const place of placesProposees) {
    const cle = cleCreneau(place.date, place.type)
    const entree = proposeParCle.get(cle)
    if (entree) entree.places.push(place)
    else proposeParCle.set(cle, { places: [place], propositionId: place.propositionId })
  }

  const apercu: Record<string, ApercuCreneau> = {}

  for (const creneau of creneauxActuels) {
    const cle = cleCreneau(creneau.date, creneau.type)
    const propose = proposeParCle.get(cle)
    if (!propose) continue

    const vetsProposes = new Set(
      propose.places.map((p) => p.vetId).filter((v): v is string => Boolean(v)),
    )
    const vetsActuels = new Set(
      creneau.occupants.map((o) => o.vetId).filter((v): v is string => Boolean(v)),
    )

    // Les ARRIVANTS sont certains : quelqu'un que la proposition met ici et qui
    // n'y est pas encore. Aucun appariement de rôle n'est nécessaire.
    const entrants = [...vetsProposes].filter((v) => !vetsActuels.has(v))

    // ── LES SORTANTS, ET LE DÉFAUT QUE CE BLOC CORRIGE ────────────────────
    //
    // Recetté par MiKL le 17/09 : sur le week-end du 5 décembre, la grille
    // barrait Antoine ET Victor pour faire entrer Fanny. Or la proposition ne
    // portait qu'UNE affectation (`premier: Fanny`) — Victor, en second, ne
    // bougeait pas. La v1 comparait l'ensemble proposé à l'ensemble actuel et
    // en déduisait que tout occupant non mentionné partait.
    //
    // ⚠️ UNE PROPOSITION NE DÉCRIT QUE CE QU'ELLE CHANGE, jamais l'état complet
    // du créneau. Une place qu'elle ne mentionne pas reste telle quelle.
    // On apparie donc PLACE À PLACE, par rôle de données.
    const sortants: string[] = []
    for (const place of propose.places) {
      // ⚠️ La fiabilité se juge sur le type de la PLACE PROPOSÉE, pas sur celui
      // du créneau affiché. Depuis que `vendredi_soir` et `weekend` partagent
      // une clé, un créneau `weekend` peut porter une place proposée en
      // `vendredi_soir` — dont le rôle, lui, reste inversé.
      if (!roleFiable(place.type)) continue
      const occupant = creneau.occupants.find((o) => o.role === place.role)
      if (!occupant?.vetId) continue
      // Cette personne reste sur le créneau si la proposition la replace
      // ailleurs dessus : c'est une permutation de rôles, pas un départ.
      if (vetsProposes.has(occupant.vetId)) continue
      if (!sortants.includes(occupant.vetId)) sortants.push(occupant.vetId)
    }

    // Permutation de rôles pure : mêmes personnes avant et après. Rien à
    // signaler — et surtout pas une case marquée « ça change » qui, une fois
    // ouverte, ne montrerait aucune différence.
    if (sortants.length === 0 && entrants.length === 0) continue

    apercu[cle] = { propositionId: propose.propositionId, sortants, entrants }
  }

  return etendreAuxBlocsWeekend(apercu, creneauxActuels)
}

/**
 * Un week-end est UN créneau pour Filou, TROIS lignes sur la grille.
 *
 * Recette MiKL du 20/09 : *« le dimanche 6 n'est même pas dans la liste »*. La
 * proposition ne nomme que le samedi ; le vendredi et le dimanche font pourtant
 * partie du même bloc, et le duo qui le tient est le même du vendredi soir au
 * dimanche — seuls les rôles s'inversent le vendredi. Marquer le seul samedi
 * laissait donc deux tiers du changement invisibles.
 *
 * On propage en PERSONNES, ce qui reste vrai malgré l'inversion : elle permute
 * les rôles à l'intérieur du bloc, elle n'en fait sortir ni entrer personne.
 */
function etendreAuxBlocsWeekend(
  apercu: Record<string, ApercuCreneau>,
  creneauxActuels: readonly CreneauActuel[],
): Record<string, ApercuCreneau> {
  const weekends = creneauxActuels
    .filter((c) => typeNormalise(c.type) === 'weekend')
    .sort((a, b) => a.date.localeCompare(b.date))
  if (weekends.length === 0) return apercu

  // Regroupe les jours de week-end qui se suivent — un bloc par week-end.
  const blocs: CreneauActuel[][] = []
  for (const c of weekends) {
    const dernier = blocs[blocs.length - 1]
    const veille = dernier?.[dernier.length - 1]
    if (veille && joursConsecutifs(veille.date, c.date)) dernier.push(c)
    else blocs.push([c])
  }

  for (const bloc of blocs) {
    const marques = bloc
      .map((c) => apercu[cleCreneau(c.date, c.type)])
      .filter((a): a is ApercuCreneau => Boolean(a))
    if (marques.length === 0 || marques.length === bloc.length) continue

    const fusion: ApercuCreneau = {
      propositionId: marques[0].propositionId,
      sortants: [...new Set(marques.flatMap((m) => m.sortants))],
      entrants: [...new Set(marques.flatMap((m) => m.entrants))],
    }
    for (const c of bloc) apercu[cleCreneau(c.date, c.type)] = fusion
  }

  return apercu
}

/** `b` est-il le lendemain de `a` ? Dates ISO, comparées en UTC. */
function joursConsecutifs(a: string, b: string): boolean {
  const lendemain = new Date(`${a}T12:00:00Z`)
  lendemain.setUTCDate(lendemain.getUTCDate() + 1)
  return lendemain.toISOString().slice(0, 10) === b
}
