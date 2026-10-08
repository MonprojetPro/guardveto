// ============================================================
// GUARDVETO — La grille en SEMAINES : ce que chaque ligne porte
// ============================================================
// B-145 lots 2b+2c, fusionnés par MiKL le 07/10 (« option A »). Portage du
// concept 3a arrêté avec Claude Design : la grille cesse d'être 42 cases
// indépendantes pour devenir 6 rangées-semaine, chacune repliable. Dépliée, une
// semaine montre UNE LIGNE PAR VÉTÉRINAIRE, alignée sur une marge de 84 px qui
// porte les prénoms.
//
// ⚠️ TOUTE LA DÉCISION EST ICI, EN FONCTIONS PURES, et c'est la seule raison
//    pour laquelle elle est vérifiable : aucun test de ce projet ne monte un
//    composant React (B-144b). Une règle d'affichage laissée dans le JSX n'est
//    jamais testée — c'est ce qui a laissé le cadenas dessiné « ouvert » sur une
//    base qui enregistrait parfaitement (04/09).
//
// ── CE QUI TIENT L'ALIGNEMENT, ET QUI EST FRAGILE ───────────────────────────
//
// La marge des prénoms et les 7 cases du jour sont des colonnes SŒURS d'une même
// grille CSS. Pour qu'un prénom tombe en face de sa ligne, chaque case doit
// porter EXACTEMENT les mêmes lignes, dans le MÊME ordre, y compris quand la
// personne ne travaille pas ce jour-là. D'où `lignesDeLaSemaine` : elle rend des
// lignes vides plutôt que de les omettre. Omettre une ligne vide décalerait tout
// le reste de la colonne d'un cran — et un planning décalé d'un cran est pire
// qu'un planning absent, parce qu'il se lit sans qu'on le soupçonne.
// ============================================================

import type { JourneeAffichee, PresenceAffichee } from './presencesDuJour'

/** Une personne de l'équipe, telle que la marge la dessine. */
export interface PersonneGrille {
  id: string
  prenom: string
  couleur: string | null
}

/** Une place de garde déjà mise en forme par `placesDeGarde`. */
export interface PlaceGrille {
  vetId: string | null
  prenom: string | null
  couleur: string | null
  role: string
  index: number
}

/** Une garde du jour, réduite à ce que la grille dessine. */
export interface GardeGrille {
  id: string
  type: string
  places: PlaceGrille[]
  /** B-125 — combien de places restent à pourvoir sur ce créneau. */
  manque: number
}

/** Un congé ou souhait couvrant ce jour. */
export interface AbsenceGrille {
  vetId: string | null
  prenom: string
  /** `valide` = congé accordé · `souhait` = demande non tranchée. */
  statut: string
}

/** Les bornes horaires du rail « journée ». */
export interface RailBornes {
  /** Minutes depuis minuit. */
  debut: number
  fin: number
}

/** 8h → 480. Rend `null` si la valeur est illisible. */
export function enMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time ?? '')
  if (!m) return null
  const h = Number(m[1])
  const mn = Number(m[2])
  if (Number.isNaN(h) || Number.isNaN(mn)) return null
  return h * 60 + mn
}

/** Le repli du rail quand aucune tranche n'est lisible : la journée de bureau. */
export const RAIL_DEFAUT: RailBornes = { debut: 8 * 60, fin: 18 * 60 }

/**
 * Les bornes du rail, DÉDUITES des tranches réelles du cabinet.
 *
 * ⚠️ PAS 8h–18h EN DUR, malgré le prototype. B-144 vient d'établir qu'une
 *    tranche peut couvrir autre chose que ce que son nom annonce (en base,
 *    « Matin » va de 8h à 18h chez ce cabinet). Un rail figé ferait déborder
 *    toute tranche qui sort de la fourchette — la barre sortirait de sa piste,
 *    ou serait tronquée sans le dire. On prend donc l'amplitude réelle.
 */
export function bornesRail(
  tranches: readonly { debut: string; fin: string }[],
): RailBornes {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const t of tranches) {
    const d = enMinutes(t.debut)
    const f = enMinutes(t.fin)
    if (d === null || f === null || f <= d) continue
    if (d < min) min = d
    if (f > max) max = f
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return RAIL_DEFAUT
  return { debut: min, fin: max }
}

/** Où poser une barre sur le rail, en pourcentage. */
export interface PositionRail {
  gauche: number
  largeur: number
}

/**
 * La position d'une tranche sur le rail.
 *
 * Bornée à [0, 100] : une tranche hors du rail ne doit pas dessiner une barre
 * qui déborde de sa case. Rend `null` quand il n'y a rien à dessiner — plutôt
 * qu'une barre de largeur nulle, invisible mais présente dans le DOM.
 */
export function positionSurRail(
  debut: string,
  fin: string,
  rail: RailBornes,
): PositionRail | null {
  const d = enMinutes(debut)
  const f = enMinutes(fin)
  if (d === null || f === null) return null

  const amplitude = rail.fin - rail.debut
  if (amplitude <= 0) return null

  const g = Math.max(0, Math.min(100, ((d - rail.debut) / amplitude) * 100))
  const dr = Math.max(0, Math.min(100, ((f - rail.debut) / amplitude) * 100))
  const largeur = dr - g
  if (largeur <= 0) return null

  return { gauche: Math.round(g * 10) / 10, largeur: Math.round(largeur * 10) / 10 }
}

/** Ce qu'une ligne de vétérinaire porte, un jour donné. */
export interface LigneVetoJour {
  vetId: string
  /** Les présences de journée, posées sur le rail. */
  journee: {
    presence: PresenceAffichee
    position: PositionRail | null
  }[]
  /** La garde de nuit tenue ce jour-là, s'il y en a une. */
  nuit: { role: string; plusieursPlaces: boolean } | null
  /** `valide` = congé accordé · `souhait` = demande non tranchée · `null`. */
  absence: string | null
  /** Rien du tout ce jour-là — la ligne se dessine, en creux. */
  vide: boolean
}

/**
 * Compose les lignes d'UNE case dépliée : une par personne, dans l'ordre de
 * l'équipe, **même vides**.
 *
 * ⚠️ L'ORDRE ET LE NOMBRE SONT LE CONTRAT D'ALIGNEMENT avec la marge des
 *    prénoms. Filtrer les lignes vides « pour alléger » décalerait les prénoms
 *    d'un cran dès qu'une personne ne travaille pas — voir l'en-tête du fichier.
 */
export function lignesDeLaSemaine(
  equipe: readonly PersonneGrille[],
  jour: {
    gardes: readonly GardeGrille[]
    journee?: JourneeAffichee
    absences: readonly AbsenceGrille[]
  },
  rail: RailBornes,
  options: { gardesVisibles: boolean; journeeVisible: boolean } = {
    gardesVisibles: true,
    journeeVisible: true,
  },
): LigneVetoJour[] {
  return equipe.map((v) => {
    const presences = options.journeeVisible
      ? (jour.journee?.presences ?? []).filter((p) => p.vetId === v.id)
      : []

    // Les heures viennent de la présence elle-même (`debut`/`fin` bruts) : une
    // seule source, pas de seconde recherche par identifiant de tranche.
    const journee = presences.map((presence) => ({
      presence,
      position:
        presence.debut && presence.fin
          ? positionSurRail(presence.debut, presence.fin, rail)
          : null,
    }))

    // La garde : on cherche la PERSONNE, jamais le rôle. La ligne du vendredi
    // inverse les rôles (B-111, payé le 04/09) ; un identifiant ne s'inverse pas.
    let nuit: LigneVetoJour['nuit'] = null
    if (options.gardesVisibles) {
      for (const g of jour.gardes) {
        const place = g.places.find((p) => p.vetId === v.id)
        if (place) {
          nuit = { role: place.role, plusieursPlaces: g.places.length > 1 }
          break
        }
      }
    }

    const abs = jour.absences.find((a) => a.vetId === v.id)
    const absence = abs ? abs.statut : null

    return {
      vetId: v.id,
      journee,
      nuit,
      absence,
      vide: journee.length === 0 && nuit === null && absence === null,
    }
  })
}

/** Une ligne compacte de case REPLIÉE. */
export interface LigneRepliee {
  /** `presents` · `absents` · `nuit` · `pourvoir` — pilote le style. */
  genre: 'presents' | 'absents' | 'nuit' | 'pourvoir'
  /** Le libellé court à gauche (« Nuit », « Abs. »), ou une chaîne vide. */
  etiquette: string
  /** Les pastilles : un prénom, une couleur. */
  pastilles: { texte: string; couleur: string | null; creux: boolean }[]
  /** Le gros chiffre, pour la ligne « présents » uniquement. */
  nombre: number | null
}

/**
 * Ce qu'une case REPLIÉE affiche — le dessin du concept 3a, ligne par ligne.
 *
 * ⚠️ UN NOMBRE POUR LA JOURNÉE, DES NOMS POUR LA NUIT, et ce n'est pas une
 *    inégalité de traitement : une case repliée fait 96 px pour 4 lignes, et
 *    écrire les présents par tranche demanderait jusqu'à 21 lignes (3 tranches
 *    x 7 personnes, relevé le 02/10). C'est très exactement ce qui a fait
 *    rejeter la première maquette. Les noms de la journée vivent dans la case
 *    DÉPLIÉE et dans la fenêtre de détail.
 *
 * ⚠️ AUCUN MINIMUM D'EFFECTIF : écarté par MiKL le 06/10, et la donnée n'existe
 *    nulle part au schéma. Le chiffre informe, il ne juge pas.
 */
export function lignesCaseRepliee(
  jour: {
    gardes: readonly GardeGrille[]
    journee?: JourneeAffichee
    absences: readonly AbsenceGrille[]
  },
  options: { gardesVisibles: boolean; journeeVisible: boolean },
  /** Au-delà, on résume par « +N » : la case ne grandit pas. */
  maxPastilles = 3,
): LigneRepliee[] {
  const lignes: LigneRepliee[] = []

  if (options.journeeVisible && (jour.journee?.personnes ?? 0) > 0) {
    lignes.push({
      genre: 'presents',
      etiquette: '',
      pastilles: [],
      nombre: jour.journee?.personnes ?? 0,
    })
  }

  if (jour.absences.length > 0) {
    lignes.push({
      genre: 'absents',
      etiquette: 'Abs.',
      pastilles: limiter(
        jour.absences.map((a) => ({
          texte: a.statut === 'souhait' ? `${a.prenom} ?` : a.prenom,
          couleur: null,
          creux: a.statut === 'souhait',
        })),
        maxPastilles,
      ),
      nombre: null,
    })
  }

  if (options.gardesVisibles) {
    const tenues: LigneRepliee['pastilles'] = []
    let aPourvoir = 0
    for (const g of jour.gardes) {
      for (const p of g.places) {
        if (p.prenom) tenues.push({ texte: p.prenom, couleur: p.couleur, creux: false })
      }
      aPourvoir += g.manque
    }
    if (tenues.length > 0) {
      lignes.push({
        genre: 'nuit',
        etiquette: 'Nuit',
        pastilles: limiter(tenues, maxPastilles),
        nombre: null,
      })
    }
    if (aPourvoir > 0) {
      lignes.push({
        genre: 'pourvoir',
        etiquette: '',
        pastilles: [{ texte: 'à pourvoir', couleur: null, creux: true }],
        nombre: aPourvoir,
      })
    }
  }

  return lignes
}

/** « +N » plutôt que de laisser la case grandir. */
function limiter(
  liste: LigneRepliee['pastilles'],
  max: number,
): LigneRepliee['pastilles'] {
  if (liste.length <= max) return liste
  const gardees = liste.slice(0, max - 1)
  gardees.push({ texte: `+${liste.length - (max - 1)}`, couleur: null, creux: true })
  return gardees
}

/** Découpe la grille en semaines pleines. */
export function decouperEnSemaines(grille: readonly string[]): string[][] {
  const semaines: string[][] = []
  for (let i = 0; i < grille.length; i += 7) semaines.push(grille.slice(i, i + 7))
  return semaines
}

/**
 * Y a-t-il quelque chose à signaler dans cette semaine ?
 *
 * Sert la pastille de la marge, qui est le SEUL repère d'une semaine repliée.
 * Sans elle, replier le mois reviendrait à cacher les trous — et une semaine
 * repliée se lirait « rien à voir » au lieu de « non déplié ».
 */
export function semaineASignaler(
  jours: readonly { gardes: readonly GardeGrille[] }[],
  gardesVisibles: boolean,
): number {
  if (!gardesVisibles) return 0
  let n = 0
  for (const j of jours) for (const g of j.gardes) n += g.manque
  return n
}

// ── Les deux axes d'affichage ───────────────────────────────────────────────

/** Ce que la grille montre : les gardes, la journée, ou les deux. */
export type AxeContenu = 'gardes' | 'journee' | 'les-deux'
/** Jusqu'où : une semaine dépliée, ou le mois entier. */
export type AxeEtendue = 'semaine' | 'mois'

/**
 * Les choix de contenu réellement proposables, selon les modules du cabinet.
 *
 * MiKL, le 06/10 : « que l'option affichage permette d'afficher le planning
 * garde, ou journée ou les 2 **déjà en fonction de ce que le cabinet aura
 * choisi** ». Un cabinet « gardes seules » ne doit pas voir le choix
 * « journée » — ce serait lui montrer une porte vers un module qu'il n'a pas.
 *
 * ⚠️ UN SEUL MODULE ACTIF ⇒ AUCUN SÉLECTEUR. Proposer un choix unique est un
 *    bouton qui ne fait rien, et le produit en a déjà payé le prix.
 */
export function choixContenu(modules: readonly string[]): AxeContenu[] {
  const gardes = modules.includes('gardes')
  const journee = modules.includes('planning-journee')
  if (gardes && journee) return ['gardes', 'journee', 'les-deux']
  if (journee) return ['journee']
  // Repli FERMANT : sans information, on montre les gardes — le socle. Jamais
  // « tout allumé », même grammaire que `modulesDuCabinet`.
  return ['gardes']
}

/** Le choix par défaut : tout ce que le cabinet possède. */
export function contenuParDefaut(modules: readonly string[]): AxeContenu {
  const choix = choixContenu(modules)
  return choix.includes('les-deux') ? 'les-deux' : choix[0]
}

/** Ce que l'axe de contenu rend visible. */
export function visibilite(contenu: AxeContenu): {
  gardesVisibles: boolean
  journeeVisible: boolean
} {
  return {
    gardesVisibles: contenu !== 'journee',
    journeeVisible: contenu !== 'gardes',
  }
}

// ── B-153 lot 1 — LES EFFECTIFS PAR DEMI-JOURNÉE ────────────────────────────

/** Combien de personnes sont là le matin, et combien l'après-midi. */
export interface EffectifsDemiJournee {
  matin: number
  apresMidi: number
}

/**
 * Les effectifs de chaque demi-journée, pour la ligne « Présents » du bas de
 * case dépliée (design « Planning Cabinet V2 »).
 *
 * ⚠️ DES PERSONNES, PAS DES PRÉSENCES. Quelqu'un inscrit matin ET après-midi
 *    compte une fois dans chaque colonne, jamais deux dans la même — c'est la
 *    même exigence que `JourneeAffichee.personnes`, et l'erreur inverse
 *    afficherait un effectif supérieur à l'équipe.
 *
 * ⚠️ LA COUPURE EST CELLE DU RAIL, pas 12h en dur. Le rail prend l'amplitude
 *    RÉELLE des tranches du cabinet (B-144 : « Matin » va de 8h à 18h chez
 *    certains) ; une coupure en dur ferait un compte faux dès que le cabinet
 *    sort de la journée de bureau. On raisonne donc en pourcentage de rail,
 *    exactement comme la barre qui est dessinée.
 *
 * 🔴 AUCUN MINIMUM N'EST CALCULÉ ICI, ET C'EST VOLONTAIRE. Le prototype montre
 *    « 5 présents » et « mat. 2/3 » en rouge — mais la donnée « effectif
 *    minimum » N'EXISTE NULLE PART au schéma, et MiKL l'a explicitement écartée
 *    le 06/10. Afficher un seuil inventé serait très exactement « afficher un
 *    paramètre que le moteur n'évalue pas ». Le chiffre informe, il ne juge pas.
 */
export function effectifsDemiJournee(
  lignes: readonly LigneVetoJour[],
): EffectifsDemiJournee {
  const matin = new Set<string>()
  const apresMidi = new Set<string>()

  for (const ligne of lignes) {
    for (const { position } of ligne.journee) {
      if (!position) continue
      const debut = position.gauche
      const fin = position.gauche + position.largeur
      // Strictement : une tranche qui finit pile à la mi-journée ne « déborde »
      // pas sur l'après-midi, et l'inverse pour une qui y commence.
      if (debut < 50) matin.add(ligne.vetId)
      if (fin > 50) apresMidi.add(ligne.vetId)
    }
  }

  return { matin: matin.size, apresMidi: apresMidi.size }
}
