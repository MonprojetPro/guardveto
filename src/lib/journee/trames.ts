// ============================================================
// GUARDVETO — Les trames de présence de la journée
// ============================================================
// B-120 chantier 3, lot 1. Même découpage que `blocs.ts` du chantier 2 : la
// validation vit ICI, dans des fonctions pures, et pas dans l'action serveur ni
// dans le formulaire. Trois raisons, toutes payées sur ce projet :
//
// ① Testable sans base ni réseau. Une règle qui n'est testable qu'en cliquant
//    n'est jamais testée.
// ② Le formulaire ET l'action l'appellent. Un contrôle posé seulement dans
//    l'écran est un contrôle que l'URL contourne (« trois chemins d'écriture,
//    deux gardiens », 22/08).
// ③ Les messages sont en français lisible, à un seul endroit.
//
// ⚠️ LA BASE GARDE AUSSI (migration 20261002090000). Délibérément redondant.
// ============================================================

import type { JourTrame, PariteSemaine } from '@/types'
import { estSemaineImpaire, jourDeLaSemaine } from '@/engine/utils'

/** Les jours qu'une trame peut viser, dans l'ordre de la semaine. */
export const JOURS_TRAME: readonly JourTrame[] = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
] as const

/** Les parités, dans l'ordre où l'écran les propose. */
export const PARITES_TRAME: readonly PariteSemaine[] = ['toutes', 'paire', 'impaire'] as const

/** Le libellé lisible d'un jour. Source unique. */
export const LIBELLE_JOUR: Record<JourTrame, string> = {
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
  dimanche: 'Dimanche',
}

/**
 * Le libellé d'une parité, tel que l'admin le lit.
 *
 * « Une semaine sur deux » plutôt que « paire » : personne ne pense sa semaine
 * en numéro ISO. Le mot technique reste en base, pas à l'écran.
 */
export const LIBELLE_PARITE: Record<PariteSemaine, string> = {
  toutes: 'Toutes les semaines',
  paire: 'Semaines paires',
  impaire: 'Semaines impaires',
}

// ============================================================
// LA PARITÉ — LE PIÈGE N°1 DU CADRAGE V3
// ============================================================
// Le cadrage dit : « si la trame de journée pose une ancre, la même phrase
// produira deux plannings différents selon l'écran qui la lit. Même convention
// obligatoire. »
//
// 🔴 CE QUE LE MOTEUR FAIT RÉELLEMENT, mesuré le 02/10 et pas supposé :
//
//   `violeReposFixe` (engine/rules/hard-constraints.ts:477-486) choisit entre
//   DEUX fonctions selon que la règle porte une `ancre` ou non. Et
//   `paramsRegle.ts:270` n'en écrit JAMAIS pour le repos fixe, avec le motif
//   écrit sur place : « poser une ancre ici donnerait deux sens différents à
//   "semaines impaires" selon la règle qu'on lit ».
//
//   ➜ Pour le repos fixe, la parité est donc celle du NUMÉRO DE SEMAINE ISO.
//     C'est cette convention-là que la trame reprend.
//
// ⚠️ DEUX CONVENTIONS COHABITENT, ET CE N'EST PAS UN DÉFAUT À CORRIGER ICI.
//    `alternance_ancre` (indisponibilite_cyclique) EXIGE une ancre et compte les
//    semaines depuis elle. On ne reprend pas celle-là. Les confondre ne lève
//    aucune erreur : la trame s'enregistrerait et décalerait d'une semaine.
// ============================================================

/**
 * Cette date tombe-t-elle dans une semaine « impaire » au sens des trames ?
 *
 * ⚠️ DÉLÈGUE À `estSemaineImpaire` DU MOTEUR, qui porte un `@deprecated`.
 *
 *    Ce n'est pas une négligence, et il ne faut pas « corriger » cet appel. Le
 *    `@deprecated` oriente vers `estSemaineImpaireAncrée`, qui résiste à la
 *    semaine ISO 53 — mais qui EXIGE une ancre. Or le repos fixe des gardes
 *    n'en pose aucune, exprès. Basculer la trame sur la version ancrée créerait
 *    exactement l'incohérence que le cadrage interdit : « lundi des semaines
 *    impaires » voudrait dire une chose dans les règles de garde et une autre
 *    dans la trame de journée.
 *
 *    La contrepartie est connue et assumée, la même que pour les gardes : au
 *    passage d'une année à 53 semaines ISO, deux semaines impaires se suivent
 *    une fois.
 *
 *    Le jour où les gardes passeront à une convention ancrée, la trame devra
 *    suivre DANS LE MÊME COMMIT. C'est pour ça que ce passage est centralisé ici
 *    et pas recopié dans chaque appelant.
 */
export function semaineImpairePourTrame(date: string): boolean {
  return estSemaineImpaire(date)
}

/** Ce qu'il faut savoir d'une ligne de trame pour la projeter sur une date. */
export interface LigneTrame {
  jour: JourTrame
  semaine: PariteSemaine
}

/**
 * Cette ligne de trame s'applique-t-elle à cette date ?
 *
 * C'est LA fonction du lot 2 : appliquer une trame, c'est parcourir les dates
 * d'une période et poser une présence partout où ceci rend `true`. Elle est
 * écrite et testée dès le lot 1 parce qu'elle porte la convention de parité —
 * et qu'une convention sans test est une convention qu'on redécouvre en
 * production.
 */
export function trameViseCetteDate(ligne: LigneTrame, date: string): boolean {
  if (jourDeLaSemaine(date) !== ligne.jour) return false
  if (ligne.semaine === 'toutes') return true
  const impaire = semaineImpairePourTrame(date)
  return ligne.semaine === 'impaire' ? impaire : !impaire
}

// ── La validation d'une saisie ───────────────────────────────────────────────

/** Ce qu'un formulaire envoie, avant toute confiance. */
export interface SaisieTrame {
  veterinaire_id: string
  bloc_id: string
  jour: string
  semaine: string
}

/** Une saisie acceptée, prête pour la base. */
export interface TrameValide {
  veterinaire_id: string
  bloc_id: string
  jour: JourTrame
  semaine: PariteSemaine
}

export type ValidationTrame =
  | { ok: true; valeur: TrameValide }
  /** Le message est DÉJÀ en français, affichable tel quel. */
  | { ok: false; probleme: string }

/** Une tranche horaire, telle qu'il faut la connaître pour valider. */
export interface BlocPourTrame {
  id: string
  nom: string
  actif: boolean
}

/**
 * Une saisie de trame est-elle acceptable ?
 *
 * ⚠️ UNE TRANCHE RETIRÉE EST REFUSÉE, et c'est le contrôle qui compte le plus
 *    ici. La base ne peut pas le voir : sa clé étrangère ne regarde que
 *    l'existence de la ligne, pas son `actif`. Sans ce refus, l'admin pourrait
 *    bâtir une trame sur une tranche qui n'est plus proposée — elle
 *    s'enregistrerait, puis ne poserait jamais rien de visible, sans qu'aucune
 *    erreur n'apparaisse. C'est la famille d'échec silencieux que ce produit
 *    combat depuis le début.
 */
export function validerTrame(
  saisie: SaisieTrame,
  blocs: readonly BlocPourTrame[],
): ValidationTrame {
  const veterinaireId = (saisie.veterinaire_id ?? '').trim()
  if (!veterinaireId) {
    return { ok: false, probleme: 'Indiquez de qui est cette présence.' }
  }

  const blocId = (saisie.bloc_id ?? '').trim()
  if (!blocId) {
    return { ok: false, probleme: 'Choisissez une tranche horaire.' }
  }
  const bloc = blocs.find((b) => b.id === blocId)
  if (!bloc) {
    return {
      ok: false,
      probleme: 'Cette tranche horaire n’existe pas dans votre cabinet.',
    }
  }
  if (!bloc.actif) {
    return {
      ok: false,
      probleme: `La tranche « ${bloc.nom} » a été retirée. Remettez-la avant de bâtir une présence dessus.`,
    }
  }

  const jour = saisie.jour as JourTrame
  if (!JOURS_TRAME.includes(jour)) {
    return { ok: false, probleme: 'Choisissez un jour de la semaine.' }
  }

  const semaine = saisie.semaine as PariteSemaine
  if (!PARITES_TRAME.includes(semaine)) {
    // Le cas le plus probable est le PLURIEL — « impaires » au lieu de
    // « impaire » — parce que c'est l'orthographe de l'autre règle du produit.
    // Il mérite son message : refuser sans dire quoi renverrait chercher un
    // bug là où il n'y a qu'une lettre.
    return {
      ok: false,
      probleme:
        saisie.semaine === 'paires' || saisie.semaine === 'impaires'
          ? 'Écrivez la cadence au singulier (« paire », « impaire ») — c’est la forme que lit le planning.'
          : 'Indiquez à quelle cadence cette présence revient.',
    }
  }

  return { ok: true, valeur: { veterinaire_id: veterinaireId, bloc_id: blocId, jour, semaine } }
}

// ── Plusieurs jours d'un coup (B-147) ────────────────────────────────────────

/** Ce qu'un formulaire envoie quand il vise plusieurs jours à la fois. */
export interface SaisieTrames {
  veterinaire_id: string
  bloc_id: string
  jours: string[]
  semaine: string
}

export type ValidationTrames =
  | { ok: true; valeurs: TrameValide[] }
  | { ok: false; probleme: string }

/**
 * Valide une saisie qui vise plusieurs jours.
 *
 * Demande de MiKL le 06/10, capture à l'appui : décrire « Anne-Sophie, lundi +
 * mardi + jeudi, matin » obligeait à saisir trois fois la même phrase.
 *
 * ⚠️ DÉLÈGUE À `validerTrame` POUR CHAQUE JOUR, et ne réimplémente rien. Les
 *    refus qui comptent — la tranche retirée, le pluriel de la cadence — vivent
 *    là-bas : les recopier ici aurait créé un second jeu de règles qui diverge
 *    au premier correctif. Le premier refus arrête tout et porte son message
 *    tel quel.
 *
 * ⚠️ LES JOURS RÉPÉTÉS SONT ABSORBÉS, pas refusés. Un formulaire ne devrait pas
 *    pouvoir envoyer deux fois « lundi », mais l'URL le peut — et deux fois la
 *    même ligne ferait échouer l'insertion entière sur l'index unique, avec un
 *    message de contrainte illisible pour une faute qui n'en est pas une.
 */
export function validerTrames(
  saisie: SaisieTrames,
  blocs: readonly BlocPourTrame[],
): ValidationTrames {
  const jours = [...new Set(saisie.jours ?? [])]
  if (jours.length === 0) {
    return { ok: false, probleme: 'Choisissez au moins un jour.' }
  }

  const valeurs: TrameValide[] = []
  for (const jour of jours) {
    const r = validerTrame(
      {
        veterinaire_id: saisie.veterinaire_id,
        bloc_id: saisie.bloc_id,
        jour,
        semaine: saisie.semaine,
      },
      blocs,
    )
    if (!r.ok) return { ok: false, probleme: r.probleme }
    valeurs.push(r.valeur)
  }

  // Ordre de la semaine, pas ordre de clic : la liste relue doit se lire comme
  // un calendrier, sinon « lundi, jeudi, mardi » donne l'impression d'une
  // saisie en désordre.
  valeurs.sort((a, b) => JOURS_TRAME.indexOf(a.jour) - JOURS_TRAME.indexOf(b.jour))
  return { ok: true, valeurs }
}

/**
 * Cette ligne existe-t-elle déjà ? (même personne, même tranche, même jour,
 * même cadence)
 *
 * La base le refuse par un index unique. On le redemande ici pour une raison
 * d'usage : un refus de contrainte Postgres remonte un message que personne ne
 * comprend, là où l'écran peut dire « cette présence est déjà dans la trame ».
 *
 * ⚠️ Les lignes INACTIVES comptent — comme l'index unique de la base. Elles
 *    méritent cependant un message différent : « elle a été retirée, remettez-la
 *    plutôt que d'en créer une seconde ». C'est exactement ce que le chantier 2
 *    avait dû ajouter après coup pour les tranches (`refusDoublon`), parce qu'un
 *    refus exact mais incompréhensible envoie chercher un bug qui n'existe pas.
 */
export function trameDejaPresente(
  valeur: TrameValide,
  existantes: readonly { id: string; veterinaire_id: string; bloc_id: string; jour: string; semaine: string; actif: boolean }[],
  sauf?: string,
): { presente: false } | { presente: true; actif: boolean } {
  const jumelle = existantes.find(
    (t) =>
      t.id !== sauf &&
      t.veterinaire_id === valeur.veterinaire_id &&
      t.bloc_id === valeur.bloc_id &&
      t.jour === valeur.jour &&
      t.semaine === valeur.semaine,
  )
  return jumelle ? { presente: true, actif: jumelle.actif } : { presente: false }
}

/**
 * La trame d'une personne, en une phrase lisible.
 *
 * Sert à l'écran ET au futur aperçu d'application. Une seule formulation, pour
 * que l'admin lise la même chose aux deux endroits — sinon elle doute d'avoir
 * compris la même règle.
 */
export function phraseTrame(ligne: LigneTrame, nomBloc: string): string {
  const jour = LIBELLE_JOUR[ligne.jour]
  if (ligne.semaine === 'toutes') return `${jour}, toutes les semaines — ${nomBloc}`
  const cadence = ligne.semaine === 'paire' ? 'des semaines paires' : 'des semaines impaires'
  return `${jour} ${cadence} — ${nomBloc}`
}
