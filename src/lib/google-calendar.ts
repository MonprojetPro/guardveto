// ============================================================
// GUARDVETO — Wrapper Google Calendar API
// ============================================================
// Utilise un Service Account Google pour créer, mettre à jour
// et supprimer des événements dans le Google Agenda du cabinet.
//
// Variables d'environnement requises :
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  — email du Service Account
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — clé privée (avec \n)
//   GOOGLE_CALENDAR_ID            — agenda de repli, pour UN SEUL cabinet
//   GOOGLE_CALENDAR_CABINET_ID    — (facultatif) le cabinet qui en bénéficie ;
//                                   à défaut, le cabinet pilote
//
// #10b (multi-cabinet) — le calendarId est porté PAR CABINET (colonne
// cabinets.google_calendar_id) et passé en argument.
//
// T-001 (2026-08-26) — LE REPLI EST NOMINATIF, PLUS UNIVERSEL. Il était accordé
// à tout cabinet dont la colonne était vide : commode avec un seul cabinet,
// mais au deuxième c'est un cabinet qui déverse ses gardes dans l'agenda d'un
// autre, sans erreur ni alerte. Désormais un cabinet non désigné dont l'agenda
// n'est pas renseigné n'a PAS d'agenda — la synchronisation le dit et n'écrit
// nulle part. Ne rien faire est le seul comportement sûr quand on ne sait pas
// où écrire.
//
// Pour sortir définitivement du repli : renseigner `cabinets.google_calendar_id`
// pour le cabinet pilote, et l'env devient inutile.
// ============================================================

import { google } from 'googleapis'
import { horairesResolus, type StructureCreneauxResolue } from '@/engine/structure-creneaux'
import { ordonnerSourceLiee, COUPLE_HISTORIQUE } from '@/engine/aval/resoudrePlanningAffichage'
import { RELATIONS_STRUCTURE_DEFAUT, type RelationStructure } from '@/engine/structure-config'
import { libelleGarde } from '@/lib/agenda/libelle'
import { estColorIdValide } from '@/lib/agenda/couleurs-google'
// Le libellé de place est celui de TOUTE l'application (« 1er », « 2e »…).
// S'en inventer un deuxième pour l'agenda, c'est le vocabulaire à deux vitesses
// que ce projet paie déjà ailleurs.
import { roleParDefaut } from '@/lib/gardes/places'

// ── Types internes ───────────────────────────────────────────
//
// `GardeEventData` vivait ici : il décrivait UN événement couvrant toute une
// garde, avec ses prénoms et sa description de bloc. Supprimé le 2026-08-27 avec
// le chemin qu'il servait (B-079) — l'agenda porte désormais un événement par
// personne et par jour, décrit par `GardeAPlanifier` plus bas.

/** Décale une date ISO de n jours (UTC, pur) — pour les jours du bloc. */
function decalerJour(dateISO: string, n: number): string {
  const d = new Date(dateISO + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// ── Initialisation du client Google ─────────────────────────

/**
 * Le cabinet pilote, seul bénéficiaire historique de l'agenda global.
 *
 * Cet UUID n'est pas une donnée client : c'est la constante de seed posée par
 * `20260616150000_bootstrap_cabinet_pilote.sql`. `GOOGLE_CALENDAR_CABINET_ID`
 * permet de désigner un autre bénéficiaire sans toucher au code.
 */
const CABINET_PILOTE = '00000000-0000-0000-0000-000000000001'

/**
 * L'agenda de repli, et POUR QUI il est valable.
 *
 * T-001 — jusqu'ici le repli était universel : tout cabinet dont la colonne
 * `cabinets.google_calendar_id` était vide écrivait dans l'agenda désigné par
 * `GOOGLE_CALENDAR_ID`. Avec un seul cabinet configuré ainsi, c'était un
 * raccourci commode ; au deuxième, c'est un cabinet qui déverse ses gardes dans
 * l'agenda d'un autre — sans erreur, sans alerte, et découvert par le client.
 *
 * Le repli est donc NOMINATIF. Un cabinet non désigné dont l'agenda n'est pas
 * renseigné n'a pas d'agenda : la synchronisation dit « aucun agenda configuré »
 * et n'écrit nulle part. Ne rien faire est le seul comportement sûr quand on ne
 * sait pas où écrire.
 */
export function agendaDeRepliPour(cabinetId?: string | null): string | null {
  const repli = process.env.GOOGLE_CALENDAR_ID?.trim()
  if (!repli || !cabinetId) return null
  const beneficiaire = process.env.GOOGLE_CALENDAR_CABINET_ID?.trim() || CABINET_PILOTE
  return cabinetId === beneficiaire ? repli : null
}

/**
 * Résout le calendarId effectif.
 *
 * Ne replie PLUS sur l'environnement : le repli exige de savoir DE QUEL cabinet
 * il s'agit, information que cette couche n'a pas. Il est donc appliqué un cran
 * plus haut, par `agendaDeRepliPour`, là où le cabinet est connu.
 */
function resoudreCalendarId(calendarIdCabinet?: string | null): string | null {
  return calendarIdCabinet?.trim() || null
}

function getCalendarClient(calendarIdCabinet?: string | null) {
  // .trim() : protège contre les retours à la ligne / espaces parasites
  // ajoutés en collant les valeurs dans Vercel (sinon : "account not found").
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim().replace(/\\n/g, '\n')
  const calendarId = resoudreCalendarId(calendarIdCabinet)

  if (!email || !key || !calendarId) {
    return null
  }

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })

  return {
    client: google.calendar({ version: 'v3', auth }),
    calendarId,
  }
}

// ── Calcul des horaires selon le type de garde ───────────────
// Horaires lus à la SOURCE UNIQUE (structure-creneaux). Avant A0, ce fichier
// codait 18h00/08h00 en dur — décalés de 30 min par rapport à la base
// (18h30/08h30) : c'était le bug de désynchronisation de l'agenda. Une seule
// vérité désormais.
//
// B-078 (2026-08-27) — ⚠️ LE FUSEAU DU SERVEUR N'A PLUS AUCUNE INFLUENCE.
// Constat de la cliente (Val d'Allier) : `creneau_modele` porte
// semaine_soir 18:00 → 08:00 (+1), son agenda Google affichait 20:00 → 10:00.
// Exactement +2 h, soit le décalage UTC→Europe/Paris en heure d'été.
//
// Cause, mesurée avant correctif : on construisait `new Date(date + 'T00:00:00')`
// puis `setHours()`. Ces deux opérations se lisent dans le fuseau du PROCESSUS.
// En local il vaut Europe/Paris et tout tombait juste ; sur Vercel il vaut UTC.
// Le `.toISOString()` qui suivait produisait alors un instant ABSOLU (suffixe
// `Z`) — et dès qu'un instant absolu est fourni, le `timeZone: 'Europe/Paris'`
// posé à côté dans le requestBody est purement IGNORÉ par Google. Le bug était
// donc invisible sur la machine de dev et systématique en production.
//
// Sonde exécutée le 27/08 sur le calcul d'alors, garde du 29/09 à 18:30 :
//   TZ=Europe/Paris → start 2026-09-29T16:30:00.000Z → affiché 18:30  ✅
//   TZ=UTC          → start 2026-09-29T18:30:00.000Z → affiché 20:30  ❌
//
// Parade : on n'envoie plus jamais d'instant absolu. Google accepte un
// `dateTime` SANS suffixe de fuseau — `2026-09-29T18:30:00` — accompagné de
// `timeZone`. C'est alors Google qui situe l'heure, à partir du fuseau du
// cabinet. Corollaire : plus une seule construction de `Date` locale ici, tout
// se calcule en TEXTE (les jours via `decalerJour`, ancré à midi UTC).

/** Le fuseau du cabinet, tant que personne n'en fournit un autre. */
export const FUSEAU_PAR_DEFAUT = 'Europe/Paris'

/**
 * Comment la garde occupe la grille Google.
 *
 * `journee` — bandeau fin en haut de la grille (`start.date` / `end.date`).
 * `horaire` — bloc posé sur les heures réelles (`start.dateTime`).
 *
 * MiKL, 2026-08-27 : des blocs de 14 h rendaient l'agenda du cabinet
 * inutilisable — la colonne du jour était entièrement mangée par la garde, on
 * ne voyait plus les rendez-vous. D'où le défaut `journee`. C'est un PARAMÈTRE
 * et non une constante : un cabinet qui tient à voir les heures pourra
 * demander l'inverse.
 */
export type ModeEvenementAgenda = 'journee' | 'horaire'

export interface OptionsEvenementAgenda {
  /** Défaut : 'journee'. */
  mode?: ModeEvenementAgenda
  /** Défaut : 'Europe/Paris' (le cabinet le porte en base, `cabinets.timezone`). */
  fuseau?: string
}

/** Le fragment `start`/`end` du requestBody Google, prêt à être envoyé. */
export interface PeriodeEvenementGoogle {
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
}

/** 'HH:MM' → minutes depuis minuit. Sert à comparer deux heures, sans Date. */
function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 'HH:MM' → 'HH:MM:00', normalisé sur deux chiffres ('8:5' → '08:05:00'). */
function secondes(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

/**
 * Les quatre bornes de la garde, en TEXTE : jour et heure de début, jour et
 * heure de fin. Rien d'autre dans ce fichier ne décide où commence et où finit
 * une garde — les deux modes d'affichage en dérivent.
 */
function bornesGarde(
  date: string,
  type: string,
  structure?: StructureCreneauxResolue,
): { jourDebut: string; heureDebut: string; jourFin: string; heureFin: string } {
  if (type === 'weekend') {
    // L'événement agenda regroupe le vendredi soir + le week-end en UN seul
    // bloc (lisibilité côté cabinet). Début = prise du vendredi soir (veille
    // du samedi), fin = fin du week-end. `date` est le samedi.
    const ven = horairesResolus(structure, 'vendredi_soir')
    const we = horairesResolus(structure, 'weekend')
    return {
      jourDebut: decalerJour(date, -1),
      heureDebut: ven.heureDebut,
      jourFin: decalerJour(date, we.offsetJoursFin),
      heureFin: we.heureFin,
    }
  }

  // semaine → semaine_soir ; ferie → ferie ; type SUR-MESURE (P3b) → ses
  // propres horaires, lus du catalogue par code (chargerStructureProfil les
  // inclut désormais). Fini l'horodatage « soir de semaine » par défaut.
  const code = type === 'ferie' ? 'ferie' : type === 'semaine' ? 'semaine_soir' : type
  const h = horairesResolus(structure, code)
  return {
    jourDebut: date,
    heureDebut: h.heureDebut,
    jourFin: decalerJour(date, h.offsetJoursFin),
    heureFin: h.heureFin,
  }
}

/**
 * Les jours que la garde OCCUPE RÉELLEMENT, du premier au dernier, inclus.
 *
 * ⚠️ Le dernier jour d'une garde de nuit n'en est pas un. Une garde de semaine
 * va du lundi 18:30 au mardi 08:30 : elle occupe le lundi, pas le mardi — on
 * rend la garde au matin. Un week-end finit le lundi 08:30 : vendredi, samedi,
 * dimanche. Peindre un bandeau sur le mardi (ou le lundi) ferait croire à une
 * garde qui n'a pas lieu, ce qui est pire que pas de bandeau du tout.
 *
 * La règle, unique et sans cas particulier : on retire le jour de fin quand
 * l'heure de fin ne dépasse pas l'heure de début, c'est-à-dire quand la garde
 * s'achève au matin. Elle tombe juste sur les quatre créneaux du catalogue —
 * semaine_soir et vendredi_soir (18:30→08:30), weekend (→ lundi 08:30), ferie
 * (08:30→08:30) — et laisse intact un créneau sur-mesure de journée
 * (08:30→18:30, même jour). On ne descend jamais sous le jour de début : une
 * garde occupe au minimum un jour.
 *
 * Exportée à dessein : le lot « un événement par personne et par jour » aura
 * besoin de cette liste, et il ne doit pas la recalculer de son côté.
 */
export function joursCouvertsParGarde(
  date: string,
  type: string,
  structure?: StructureCreneauxResolue,
): string[] {
  const b = bornesGarde(date, type, structure)
  const finMatinale = minutes(b.heureFin) <= minutes(b.heureDebut)
  const dernier = finMatinale ? decalerJour(b.jourFin, -1) : b.jourFin

  const jours: string[] = []
  let courant = b.jourDebut
  // Garde-fou : le jour de début est toujours du voyage, même si le retrait
  // ci-dessus l'a fait passer avant lui (créneau dégénéré, offset 0 + fin
  // matinale). Une boucle sans borne haute ne doit jamais pouvoir s'emballer.
  while (courant <= dernier || jours.length === 0) {
    jours.push(courant)
    courant = decalerJour(courant, 1)
  }
  return jours
}

/**
 * Un événement « journée entière » couvrant les jours donnés.
 *
 * ⚠️ PIÈGE GOOGLE : `end.date` est EXCLUSIVE. Un événement d'un seul jour le
 * 29/09 s'écrit start 2026-09-29 / end 2026-09-30. Mettre la même date des
 * deux côtés produit un événement de durée nulle, que Google n'affiche pas ;
 * mettre le dernier jour réel décale tout d'un jour, et c'est l'erreur qui ne
 * se voit qu'une fois chez le client.
 */
function periodeJourneeEntiere(jours: string[]): PeriodeEvenementGoogle {
  return {
    start: { date: jours[0] },
    end: { date: decalerJour(jours[jours.length - 1], 1) },
  }
}

/**
 * Ce que Google recevra comme `start`/`end`, sans appeler Google.
 *
 * Observable à dessein : c'est la seule façon d'écrire un test sur le sujet
 * plutôt que de découvrir le décalage dans l'agenda de la cliente, en
 * production — ce qui est exactement ce qui s'est produit (B-078).
 */
export function construirePeriodeEvenement(
  date: string,
  type: string,
  structure?: StructureCreneauxResolue,
  options?: OptionsEvenementAgenda,
): PeriodeEvenementGoogle {
  const mode = options?.mode ?? 'journee'
  if (mode === 'journee') {
    return periodeJourneeEntiere(joursCouvertsParGarde(date, type, structure))
  }

  const b = bornesGarde(date, type, structure)
  const fuseau = options?.fuseau ?? FUSEAU_PAR_DEFAUT
  // Pas de suffixe de fuseau : c'est `timeZone` qui situe l'heure, jamais le
  // fuseau du processus. Voir le commentaire B-078 en tête de section.
  return {
    start: { dateTime: `${b.jourDebut}T${secondes(b.heureDebut)}`, timeZone: fuseau },
    end: { dateTime: `${b.jourFin}T${secondes(b.heureFin)}`, timeZone: fuseau },
  }
}

// ============================================================
// UN ÉVÉNEMENT PAR PERSONNE ET PAR JOUR (B-079)
// ============================================================
// Décision de MiKL, 2026-08-27, avec ses deux raisons.
//
// ① UN ÉVÉNEMENT NE PORTE QU'UNE COULEUR. Victor 1er en bleu et Fanny 2nde en
//    orange le même soir, c'est deux événements côte à côte — un seul, bicolore,
//    n'existe pas dans Google Agenda.
//
// ② CHAQUE JOUR EST INDIVIDUEL, samedi et dimanche compris, quitte à répéter.
//    Le vendredi et le week-end ont les rôles INVERSÉS (relations de structure),
//    et un remplacement exceptionnel peut ne valoir qu'un seul jour du bloc. Un
//    bloc de trois jours ne sait dire ni l'un ni l'autre : il l'écrivait dans sa
//    description, que personne n'ouvre.
//
// Cette section ne fait que DÉCIDER quels événements existent. Elle n'appelle
// pas Google et ne lit pas la base : c'est ce qui la rend testable, et c'est là
// que se jouent les erreurs coûteuses (un jour de trop, un nom de remplaçant à
// la mauvaise place, une couleur qui suit le titulaire au lieu du remplaçant).

/** Une personne occupant une place, telle que l'agenda doit la montrer. */
export interface OccupantPlace {
  vetId: string
  /** Ce qui s'affiche : `veterinaires.libelle_agenda`, sinon ses initiales. */
  libelle: string
  /** `colorId` Google ('1'..'11'), ou null = couleur par défaut de l'agenda. */
  couleurGoogle?: string | null
}

/**
 * Un jour du bloc où quelqu'un d'autre tient la place (backlog 8 bis).
 *
 * `occupant: null` = place laissée VACANTE ce jour-là. Elle ne produit alors
 * AUCUN événement — mettre le nom du titulaire sur un jour qu'on lui a retiré
 * est le seul résultat vraiment inacceptable ici : il organiserait sa journée
 * sur une garde qui ne lui appartient plus.
 */
export interface ExceptionJour {
  date: string
  role: 'premier' | 'second'
  occupant: OccupantPlace | null
}

export interface GardeAPlanifier {
  date: string
  type: string
  /** Occupants par place NATIVE : 0 = premier, 1 = second, 2+ suivants. */
  places: Array<OccupantPlace | null>
  exceptions?: ExceptionJour[]
  /** Base du titre quand le créneau du jour n'en fournit pas. */
  base?: string
}

export interface EvenementPlanifie {
  jour: string
  /**
   * La place TELLE QU'ELLE S'AFFICHE ce jour-là, pas la place native.
   *
   * Sur un vendredi aux rôles inversés, l'index 0 désigne donc le second du
   * week-end. C'est volontaire et c'est la seule convention cohérente : le
   * titre dit « 1er », l'index doit dire la même chose, sinon la clé
   * `(garde, jour, place)` de `garde_evenements` ne désignerait pas ce que
   * l'événement montre.
   */
  placeIndex: number
  titre: string
  /** Absent = l'événement prend la couleur par défaut de l'agenda. */
  colorId?: string
  start: PeriodeEvenementGoogle['start']
  end: PeriodeEvenementGoogle['end']
}

export interface OptionsPlanification extends OptionsEvenementAgenda {
  /** `cabinets.agenda_afficher_horaires`. Aucun défaut ici : il vit en base. */
  afficherHoraires: boolean
  relations?: readonly RelationStructure[]
  structure?: StructureCreneauxResolue
  /**
   * La base du titre POUR LE CRÉNEAU DU JOUR, pas pour la garde.
   *
   * Le vendredi d'un week-end relève de `vendredi_soir` : lui coller la base du
   * week-end ferait lire « week-end » sur un vendredi soir. Le titre doit dire
   * le créneau réellement tenu ce jour-là.
   */
  baseParCode?: (code: string) => string | undefined
  /** Rôles nommés par le cabinet (`creneau_modele.roles`), par index de place. */
  rolesParCode?: (code: string) => readonly string[] | undefined
}

/** 'garde' — quand le créneau ne fournit ni libellé d'agenda ni nom. */
const BASE_TITRE_DEFAUT = 'garde'

/** « 18:30 » → « 18h30 » · « 08:00 » → « 08h ». Compact : le titre est court. */
function heureCompacte(hhmm: string): string {
  const [h, m] = hhmm.split(':')
  return Number(m ?? 0) === 0 ? `${h}h` : `${h}h${m}`
}

/**
 * Le créneau qui s'applique à UN jour donné du bloc.
 *
 * Un week-end n'a pas les mêmes horaires tous les jours : le vendredi relève de
 * `vendredi_soir` (18h30 → 08h30), le samedi et le dimanche de `weekend`.
 * Afficher les horaires du week-end sur le vendredi serait faux, et c'est
 * précisément le genre d'écart que la cliente relève dans son agenda.
 */
function codeCreneauDuJour(garde: { date: string; type: string }, jour: string): string {
  if (garde.type === 'weekend') {
    return jour === decalerJour(garde.date, -1) ? 'vendredi_soir' : 'weekend'
  }
  return garde.type === 'ferie' ? 'ferie' : garde.type === 'semaine' ? 'semaine_soir' : garde.type
}

/**
 * Les occupants tels qu'ils s'affichent UN jour donné : ordre du jour d'abord,
 * exceptions ensuite.
 *
 * ⚠️ L'ORDRE DE CES DEUX OPÉRATIONS EST UN PIÈGE DÉJÀ PAYÉ (backlog 8 bis, test
 * `google-calendar-exceptions`). Une exception vise le rôle TEL QU'IL S'AFFICHE
 * ce jour-là. Sur un vendredi aux rôles inversés, l'appliquer AVANT
 * l'ordonnancement remplacerait l'autre personne — silencieusement, et avec
 * l'air d'être juste.
 *
 * `null` (et non une liste vide) quand le vendredi n'est pas dérivable : un
 * cabinet qui a découplé ses créneaux (pas de `meme_binome`) tient son vendredi
 * dans sa propre garde, et le déduire du week-end inventerait des occupants.
 */
function occupantsDuJour(
  garde: GardeAPlanifier,
  jour: string,
  relations: readonly RelationStructure[],
): Array<OccupantPlace | null> | null {
  let ordre = [...garde.places]

  const estVendrediDuWeekEnd =
    garde.type === 'weekend' && jour === decalerJour(garde.date, -1)

  if (estVendrediDuWeekEnd) {
    const ordonnes = ordonnerSourceLiee(
      [garde.places[0] ?? null, garde.places[1] ?? null],
      relations,
      COUPLE_HISTORIQUE.source,
      COUPLE_HISTORIQUE.cible,
    )
    if (!ordonnes) return null
    ordre = [...ordonnes, ...garde.places.slice(2)]
  }

  // Les exceptions ne connaissent que 'premier' et 'second' : elles ne peuvent
  // donc toucher que les places 0 et 1. Une place 3 ou 4 n'a pas de vocabulaire
  // pour être remplacée — c'est une limite du modèle, pas un oubli d'ici.
  const exceptions = garde.exceptions ?? []
  return ordre.map((occ, index) => {
    const role = index === 0 ? 'premier' : index === 1 ? 'second' : null
    if (!role) return occ
    const e = exceptions.find((x) => x.date === jour && x.role === role)
    return e ? e.occupant : occ
  })
}

/**
 * TOUS les événements Google d'une garde : un par jour et par place pourvue.
 *
 * Fonction pure — ni base, ni réseau. C'est elle qui décide, et c'est sur elle
 * que portent les tests ; la synchronisation ne fait qu'exécuter sa sortie.
 */
export function planifierEvenementsGarde(
  garde: GardeAPlanifier,
  options: OptionsPlanification,
): EvenementPlanifie[] {
  const relations = options.relations ?? RELATIONS_STRUCTURE_DEFAUT
  const baseRepli = (garde.base ?? '').trim() || BASE_TITRE_DEFAUT
  const mode = options.mode ?? 'journee'
  const fuseau = options.fuseau ?? FUSEAU_PAR_DEFAUT

  const evenements: EvenementPlanifie[] = []

  for (const jour of joursCouvertsParGarde(garde.date, garde.type, options.structure)) {
    const occupants = occupantsDuJour(garde, jour, relations)
    if (!occupants) continue

    const code = codeCreneauDuJour(garde, jour)
    const h = horairesResolus(options.structure, code)
    const base = (options.baseParCode?.(code) ?? '').trim() || baseRepli
    const roles = options.rolesParCode?.(code)

    // Chaque jour est un événement à lui seul : le bloc de trois jours a
    // disparu, donc les bornes se calculent SUR CE JOUR. En mode horaire, un
    // créneau de nuit déborde sur le lendemain — c'est `offsetJoursFin` qui le
    // dit, et le fuseau reste hors du calcul (B-078).
    const periode: PeriodeEvenementGoogle = mode === 'journee'
      ? { start: { date: jour }, end: { date: decalerJour(jour, 1) } }
      : {
          start: { dateTime: `${jour}T${secondes(h.heureDebut)}`, timeZone: fuseau },
          end: {
            dateTime: `${decalerJour(jour, h.offsetJoursFin)}T${secondes(h.heureFin)}`,
            timeZone: fuseau,
          },
        }

    occupants.forEach((occ, placeIndex) => {
      // Place vacante ce jour-là (ou jamais pourvue) : aucun événement. Un
      // événement au nom de quelqu'un qui ne sera pas là est pire qu'un trou
      // dans l'agenda — le trou, au moins, se voit.
      if (!occ) return

      evenements.push({
        jour,
        placeIndex,
        titre: libelleGarde({
          base,
          nom: occ.libelle,
          // Le rôle nommé par le cabinet s'il en a nommé un, sinon celui de
          // toute l'application. Le rôle DOIT toujours apparaître : sans lui,
          // les deux événements du même jour sont indiscernables dans la grille.
          role: (roles?.[placeIndex] ?? '').trim() || roleParDefaut(placeIndex),
          horaires: { debut: heureCompacte(h.heureDebut), fin: heureCompacte(h.heureFin) },
          afficherHoraires: options.afficherHoraires,
        }),
        // La couleur suit la personne RÉELLEMENT présente ce jour-là, donc le
        // remplaçant et non le titulaire : sinon un œil qui balaie l'agenda par
        // couleurs — c'est l'usage même de la fonctionnalité — verrait encore
        // celle du titulaire sur un jour qui ne lui appartient plus.
        ...(estColorIdValide(occ.couleurGoogle) ? { colorId: occ.couleurGoogle as string } : {}),
        start: periode.start,
        end: periode.end,
      })
    })
  }

  return evenements
}

// ── L'écriture d'un événement PLANIFIÉ (B-079) ───────────────
// SEUL chemin d'écriture vers Google. Le couple `createGardeEvent` /
// `updateGardeEvent`, qui écrivait UN événement par garde avec sa description
// de bloc, a été supprimé le 2026-08-27 : plus aucun appelant après la bascule.
// Le garder « au cas où » aurait laissé dans le fichier un second chemin
// d'écriture que personne n'emprunte — et ce projet a déjà payé un correctif
// posé dans du code que plus rien n'exécutait.
//
// Les deux fonctions ci-dessous écrivent l'événement d'UNE personne pour UN
// jour, tel que `planifierEvenementsGarde` l'a décidé.

/** Le requestBody d'un événement planifié — titre, couleur, bornes. */
function corpsEvenementPlanifie(ev: EvenementPlanifie) {
  return {
    summary: ev.titre,
    // Basculer d'un format à l'autre exige d'EFFACER l'ancien : Google garde
    // `dateTime` si on se contente d'ajouter `date`, et refuse la mise à jour.
    start: { dateTime: null, date: null, ...ev.start },
    end: { dateTime: null, date: null, ...ev.end },
    // `null` remet explicitement la couleur par défaut de l'agenda. Omettre le
    // champ laisserait la couleur précédente en place sur une mise à jour —
    // un véto dont on retire la couleur la garderait indéfiniment.
    colorId: ev.colorId ?? null,
  }
}

/** Crée l'événement d'une personne pour un jour. Null si Google non configuré. */
export async function creerEvenementPlanifie(
  ev: EvenementPlanifie,
  calendarIdCabinet?: string | null,
): Promise<string | null> {
  const ctx = getCalendarClient(calendarIdCabinet)
  if (!ctx) return null

  const res = await ctx.client.events.insert({
    calendarId: ctx.calendarId,
    requestBody: corpsEvenementPlanifie(ev),
  })
  return res.data.id ?? null
}

/** Met à jour l'événement d'une personne pour un jour. No-op si non configuré. */
export async function majEvenementPlanifie(
  eventId: string,
  ev: EvenementPlanifie,
  calendarIdCabinet?: string | null,
): Promise<void> {
  const ctx = getCalendarClient(calendarIdCabinet)
  if (!ctx) return

  await ctx.client.events.update({
    calendarId: ctx.calendarId,
    eventId,
    requestBody: corpsEvenementPlanifie(ev),
  })
}

/**
 * Supprime un événement Google Agenda.
 * No-op si Google n'est pas configuré.
 */
export async function deleteGardeEvent(
  eventId: string,
  calendarIdCabinet?: string | null,
): Promise<void> {
  const ctx = getCalendarClient(calendarIdCabinet)
  if (!ctx) return

  await ctx.client.events.delete({
    calendarId: ctx.calendarId,
    eventId,
  })
}

/**
 * Vérifie si Google Calendar est configuré (credentials présents ET un
 * calendarId résoluble — celui du cabinet, sinon l'env globale).
 *
 * @param calendarIdCabinet calendarId propre au cabinet (colonne
 *   cabinets.google_calendar_id) ; si absent, on retombe sur GOOGLE_CALENDAR_ID.
 */
export function isGoogleCalendarConfigured(calendarIdCabinet?: string | null): boolean {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    resoudreCalendarId(calendarIdCabinet)
  )
}

/**
 * Le NOM de l'agenda tel que Google l'affiche — « gardes véto », et non
 * `b69598ef…@group.calendar.google.com`.
 *
 * Un agenda secondaire Google a pour identifiant une suite de 64 caractères
 * hexadécimaux. C'est une adresse technique, jamais montrée par Google
 * lui-même, et l'afficher telle quelle dans un écran de réglages ne renseigne
 * personne : on ne peut ni la lire, ni la reconnaître, ni vérifier qu'on parle
 * du bon agenda. Le nom, lui, est celui que le cabinet voit dans sa propre
 * interface Google — c'est le seul repère commun.
 *
 * Renvoie null si l'agenda est injoignable : mieux vaut ne rien annoncer que
 * de nommer un agenda auquel on n'a peut-être plus accès.
 */
export async function nomLisibleAgenda(
  calendarIdCabinet?: string | null,
): Promise<string | null> {
  const cal = getCalendarClient(calendarIdCabinet)
  if (!cal) return null

  try {
    const r = await cal.client.calendars.get({ calendarId: cal.calendarId })
    return r.data.summary?.trim() || null
  } catch (err) {
    // Injoignable : identifiant erroné, partage retiré, quota. Ce n'est pas
    // bloquant — l'écran retombera sur une formulation générique.
    console.error('[google-calendar] nom de l’agenda illisible :', err instanceof Error ? err.message : err)
    return null
  }
}
