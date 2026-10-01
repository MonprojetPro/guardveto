// ============================================================
// GUARDVETO — Ce qui fait une tranche horaire valide
// ============================================================
// B-120 chantier 2. La validation vit ICI, dans une fonction pure, et pas
// dans l'action serveur ni dans le formulaire — pour trois raisons qui ont
// toutes été payées sur ce projet :
//
// ① Elle est testable sans base ni réseau. Une validation qui n'est testable
//    qu'en cliquant n'est jamais testée.
// ② Le formulaire ET l'action l'appellent. Un contrôle posé seulement dans
//    l'écran est un contrôle que l'URL contourne (« trois chemins d'écriture,
//    deux gardiens », 22/08).
// ③ Les messages sont écrits en français lisible, à un seul endroit. La modale
//    de refus reprend les messages serveur mot pour mot — c'est donc ici que
//    la traduction doit avoir lieu.
//
// ⚠️ LA BASE GARDE AUSSI. Les mêmes règles sont des CHECK dans la migration
//    20261001120000. Ce n'est pas une redondance inutile : si un jour une
//    écriture arrive par un chemin qu'on n'a pas prévu, c'est la base qui
//    refuse. Les deux gardiens disent la même chose, délibérément.
// ============================================================

import type { CreneauBlocJournee } from '@/types'

/** Les créneaux d'absence auxquels un bloc peut se rattacher. */
export const CRENEAUX_BLOC: readonly CreneauBlocJournee[] = [
  'matin',
  'apres-midi',
  'journee',
] as const

/** Le libellé lisible d'un créneau, pour l'écran. Source unique. */
export const LIBELLE_CRENEAU: Record<CreneauBlocJournee, string> = {
  matin: 'Matin',
  'apres-midi': 'Après-midi',
  journee: 'Journée entière',
}

/** Ce qu'un formulaire envoie, avant toute confiance. */
export interface SaisieBloc {
  nom: string
  debut: string
  fin: string
  creneau: string
}

/** Une saisie acceptée, normalisée, prête pour la base. */
export interface BlocValide {
  nom: string
  debut: string
  fin: string
  creneau: CreneauBlocJournee
}

export type Validation =
  | { ok: true; valeur: BlocValide }
  /** Le message est DÉJÀ en français, affichable tel quel. */
  | { ok: false; probleme: string }

/** `HH:MM` ou `HH:MM:SS`, bornes réelles sur les heures et les minutes. */
const FORME_HEURE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/

/**
 * Normalise une heure en `HH:MM`.
 *
 * Postgres rend `08:00:00` pour un `time`, un `<input type="time">` envoie
 * `08:00`. Sans ce passage obligé, comparer les deux formes aurait produit des
 * faux écarts à l'affichage — le genre de différence invisible qui fait dire
 * « ça n'a pas enregistré » alors que tout est en place.
 */
export function normaliserHeure(brut: string): string | null {
  const t = (brut ?? '').trim()
  if (!FORME_HEURE.test(t)) return null
  return t.slice(0, 5)
}

/** Les minutes depuis minuit. Sert à comparer deux heures sans objet Date. */
function minutes(heure: string): number {
  const [h, m] = heure.split(':').map(Number)
  return h * 60 + m
}

/**
 * Une saisie de bloc est-elle acceptable ?
 *
 * ⚠️ CE QU'ON NE REFUSE PAS, DÉLIBÉRÉMENT : le CHEVAUCHEMENT avec un autre
 *    bloc. « Journée complète » 8h→18h recouvre par construction « Matin » et
 *    « Après-midi » — c'est le cas d'usage principal décrit par MiKL, pas une
 *    erreur de saisie. Les blocs sont un vocabulaire de tranches proposées,
 *    jamais un découpage exclusif de la journée.
 *
 * ⚠️ On ne refuse pas non plus un bloc « à cheval » (12h→14h) : son créneau de
 *    rattachement est choisi par l'admin. Deviner à sa place aurait inventé
 *    une règle que personne n'a demandée.
 *
 * ⚠️ CE QU'ON NE REFUSE PAS N'EST PAS CE QU'ON TAIT — B-144. Une tranche dont
 *    la durée contredit son rattachement passe ici, et c'est voulu ; elle est
 *    SIGNALÉE par `avertissementsBloc` plus bas. Cette fonction dit ce qui est
 *    impossible, l'autre dit ce qui est douteux.
 */
export function validerBloc(saisie: SaisieBloc): Validation {
  const nom = (saisie.nom ?? '').trim()
  if (!nom) {
    return { ok: false, probleme: 'Donnez un nom à cette tranche horaire.' }
  }
  if (nom.length > 40) {
    return {
      ok: false,
      probleme: 'Ce nom est trop long pour la grille (40 caractères au maximum).',
    }
  }

  const debut = normaliserHeure(saisie.debut)
  if (!debut) {
    return { ok: false, probleme: "L'heure de début n'est pas une heure valide." }
  }
  const fin = normaliserHeure(saisie.fin)
  if (!fin) {
    return { ok: false, probleme: "L'heure de fin n'est pas une heure valide." }
  }
  if (minutes(fin) <= minutes(debut)) {
    return {
      ok: false,
      probleme: `La fin (${fin}) doit être après le début (${debut}).`,
    }
  }

  const creneau = saisie.creneau as CreneauBlocJournee
  if (!CRENEAUX_BLOC.includes(creneau)) {
    // Le cas le plus probable est 'soiree', et il mérite son explication :
    // refuser sans dire pourquoi aurait renvoyé l'admin à essayer autrement.
    return {
      ok: false,
      probleme:
        saisie.creneau === 'soiree'
          ? 'Le soir est géré par le planning de gardes, pas par le planning de journée.'
          : 'Indiquez à quel moment de la journée cette tranche se rattache.',
    }
  }

  return { ok: true, valeur: { nom, debut, fin, creneau } }
}

/**
 * Deux blocs portent-ils le même nom ? (casse et espaces de bord ignorés)
 *
 * La base le refuse déjà par un index unique. On le redemande ici pour une
 * raison d'usage, pas de sécurité : un refus de contrainte Postgres remonte
 * un message technique que personne ne comprend, là où l'écran peut dire
 * « vous avez déjà une tranche qui s'appelle Matin ».
 */
export function nomDejaPris(
  nom: string,
  existants: readonly { id: string; nom: string }[],
  sauf?: string,
): boolean {
  const cible = nom.trim().toLowerCase()
  return existants.some((b) => b.id !== sauf && b.nom.trim().toLowerCase() === cible)
}

// ============================================================
// B-144 — CE QU'UNE TRANCHE PEUT TAIRE SUR ELLE-MÊME
// ============================================================
// Trouvé par MiKL le 01/10 en recettant le chantier 2 : il a passé « Matin »
// de 8h-12h à 8h → 18h, et rien ne l'a signalé. Une tranche de dix heures
// déclarée « compte comme : Matin » n'est pas une erreur de saisie — c'est une
// bombe pour le chantier 3, où un congé posé sur le matin retirera une présence
// qui couvre aussi tout l'après-midi. La personne disparaîtra de la journée
// entière pour une demi-journée d'absence, et personne ne pourra relier l'effet
// à sa cause.
//
// ⚠️ ON AVERTIT, ON N'INTERDIT PAS — et c'est une décision, pas une facilité.
//    Le principe maison est « le système INFORME, il n'interdit pas », et la
//    décision « blocs libres » du 01/10 laisse le rattachement à l'admin. Un
//    refus dur casserait le cas explicitement voulu : une garde de midi
//    12h→14h rattachée à l'après-midi.
//
// ⚠️ POURQUOI CE N'EST PAS DANS `validerBloc` : un avertissement et un refus ne
//    sont pas le même objet. Les mélanger aurait obligé l'appelant à trier un
//    `probleme` qui bloque d'un `probleme` qui informe — et le premier qui se
//    serait trompé aurait rendu l'un des deux muet.
// ============================================================

/**
 * Au-delà de cette heure, une tranche ne couvre plus seulement le matin.
 *
 * ⚠️ EN DUR, DÉLIBÉRÉMENT. Ce n'est PAS une règle métier : le moteur ne
 *    l'évalue pas, elle ne change aucun planning, elle ne décide de rien. La
 *    rendre réglable aurait affiché un paramètre que rien n'exécute — exactement
 *    ce que la leçon « ne jamais afficher un paramètre que le moteur n'évalue
 *    pas » interdit. 13h laisse passer la pause de midi sans crier.
 */
const FIN_RAISONNABLE_MATIN = '13:00'

/** Avant cette heure, une tranche mord sur le matin. Même raison qu'au-dessus. */
const DEBUT_RAISONNABLE_APRESMIDI = '12:00'

export interface AvertissementBloc {
  /** Clé stable — les tests s'y accrochent, jamais au texte français. */
  code: 'couvre-plus' | 'couvre-moins' | 'memes-horaires'
  /** Déjà en français, affichable tel quel. Aucune reformulation à l'écran. */
  texte: string
}

/** Ce qu'il faut savoir d'une tranche pour la juger. L'id est absent à l'ajout. */
export interface BlocAJuger {
  debut: string
  fin: string
  creneau: string
}

/**
 * Ce que cette tranche tait sur elle-même. Liste vide = rien à signaler.
 *
 * Trois silences, tous nés du même geste :
 *
 * ① `couvre-plus` — rattachée au matin et finissant l'après-midi (ou l'inverse).
 *    C'est le danger du board : la durée contredit le rattachement.
 * ② `couvre-moins` — le cas symétrique, que le board ne mentionne pas : une
 *    tranche « Journée entière » qui ne va que de 8h à 12h. Un congé du matin
 *    ne la retirera PAS, alors qu'elle ne contient que du matin. Même silence,
 *    dans l'autre sens.
 * ③ `memes-horaires` — deux tranches aux horaires strictement identiques. Le
 *    chevauchement est autorisé (une journée complète recouvre le matin, c'est
 *    le cas d'usage), mais deux tranches au MÊME horaire ne sont plus un
 *    chevauchement : ce sont deux noms pour la même chose.
 *
 * @param autres Les tranches existantes. Seules les ACTIVES comptent pour ③ :
 *               une tranche retirée n'est plus proposée, la confusion n'a pas
 *               lieu. On ne crie pas sur un choix qui n'existe plus.
 * @param sauf   L'id de la tranche en cours de modification, pour qu'elle ne se
 *               prenne pas elle-même pour son propre doublon.
 */
export function avertissementsBloc(
  bloc: BlocAJuger,
  autres: readonly { id: string; nom: string; debut: string; fin: string; actif: boolean }[] = [],
  sauf?: string,
): AvertissementBloc[] {
  const debut = normaliserHeure(bloc.debut)
  const fin = normaliserHeure(bloc.fin)
  // Une saisie en cours de frappe n'a pas encore d'heures lisibles. Se taire ici
  // n'est pas une tolérance : `validerBloc` refusera, et deux messages pour un
  // seul défaut se contredisent à l'écran.
  if (!debut || !fin || minutes(fin) <= minutes(debut)) return []

  const avis: AvertissementBloc[] = []
  const toucheMatin = minutes(debut) < minutes(DEBUT_RAISONNABLE_APRESMIDI)
  const toucheApresMidi = minutes(fin) > minutes(FIN_RAISONNABLE_MATIN)

  if (bloc.creneau === 'matin' && toucheApresMidi) {
    avis.push({
      code: 'couvre-plus',
      texte:
        'Cette tranche couvre plus que le matin — un congé du matin la retirera en entier, après-midi compris.',
    })
  }

  if (bloc.creneau === 'apres-midi' && toucheMatin) {
    avis.push({
      code: 'couvre-plus',
      texte:
        'Cette tranche commence avant l’après-midi — un congé de l’après-midi la retirera en entier, matin compris.',
    })
  }

  if (bloc.creneau === 'journee' && !(toucheMatin && toucheApresMidi)) {
    avis.push({
      code: 'couvre-moins',
      texte:
        'Cette tranche ne couvre qu’une partie de la journée — un congé d’une demi-journée ne la retirera pas.',
    })
  }

  const jumelle = autres.find(
    (a) =>
      a.actif &&
      a.id !== sauf &&
      normaliserHeure(a.debut) === debut &&
      normaliserHeure(a.fin) === fin,
  )
  if (jumelle) {
    avis.push({
      code: 'memes-horaires',
      texte: `« ${jumelle.nom} » couvre déjà exactement ${plageLisible(debut, fin)}. Deux tranches aux mêmes horaires sont deux noms pour la même chose.`,
    })
  }

  return avis
}

/** L'affichage d'une plage, tel qu'on l'écrit partout : « 8h → 12h ». */
export function plageLisible(debut: string, fin: string): string {
  const lisible = (h: string) => {
    const [hh, mm] = h.slice(0, 5).split(':')
    const heure = Number(hh)
    return mm === '00' ? `${heure}h` : `${heure}h${mm}`
  }
  return `${lisible(debut)} → ${lisible(fin)}`
}
