// ============================================================
// GUARDVETO — Appliquer les trames, et retoucher à la main
// ============================================================
// B-120 chantier 3, lot 2. Même découpage que `blocs.ts` et `trames.ts` : toute
// la décision vit ICI, en fonctions pures, et pas dans l'action serveur ni dans
// l'écran. Une règle qui n'est testable qu'en cliquant n'est jamais testée.
//
// 🔴 CE QUE CE FICHIER DÉBLOQUE. Mesuré le 06/10 : les trames s'enregistraient
//    et ne posaient RIEN (`grep` sur `appliquerTrame|poserPresence` à vide).
//    `trameViseCetteDate` avait été écrite au lot 1 en annonçant exactement son
//    usage : « appliquer une trame, c'est parcourir les dates d'une période et
//    poser une présence partout où ceci rend true ». C'est ce qu'on fait ici.
//
// ── LA RÈGLE D'APPLICATION : ADDITIVE ET IDEMPOTENTE ────────────────────────
//
// `aPoser()` rend ce qui MANQUE, et rien d'autre. L'application n'enlève jamais
// une présence et n'en modifie jamais une. Trois conséquences, toutes voulues :
//
//   ① Aucune retouche manuelle ne peut être perdue en réappliquant une trame.
//      C'est ce qui remplace le cadenas — MiKL, le 06/10 : « on rajoute les
//      cadenas pour les gardes seulement, pour le planning jour pas besoin ».
//   ② Réappliquer deux fois de suite ne change rien la seconde fois. L'admin
//      peut relancer sans crainte, et sans avoir à se demander ce qu'elle risque.
//   ③ Le geste est prévisible AVANT de cliquer : `aPoser()` sert aussi d'aperçu,
//      donc l'écran annonce le nombre exact qu'il va écrire. Un bouton qui ne
//      dit pas ce qu'il va faire sur un planning en service n'est pas cliqué.
//
// ⚠️ LIMITE ASSUMÉE, QUI DOIT ÊTRE DITE À L'ÉCRAN : retirer à la main quelqu'un
//    que la trame désigne, puis réappliquer la trame, le remet. Il n'y a pas de
//    « retrait définitif » dans ce lot. Mémoriser les exceptions demandait une
//    ligne qui dit l'ABSENCE — et « vider une place ≠ la mettre à null » est un
//    piège déjà payé deux fois le 02/09 sur ce produit. On livre le comportement
//    le plus prévisible, et on écrit la limite plutôt que de la taire.
// ============================================================

import type { BlocJournee, JourTrame, PariteSemaine } from '@/types'
import { trameViseCetteDate } from './trames'

/** Une période, réduite à ce qu'il faut en savoir pour y poser des présences. */
export interface PeriodePourPresences {
  id: string
  date_debut: string
  date_fin: string
}

/** Une présence, telle qu'elle existe ou telle qu'on veut la poser. */
export interface PresenceVoulue {
  veterinaire_id: string
  bloc_id: string
  /** `AAAA-MM-JJ`. */
  date: string
  /** La trame qui la produit. `null` = posée à la main. */
  trame_id: string | null
}

/**
 * La clé d'identité d'une présence — exactement celle de l'index unique en base
 * (`presences_journee_sans_doublon`).
 *
 * ⚠️ `periode_id` N'ENTRE PAS dans la clé, et `trame_id` non plus. Les deux
 *    omissions sont délibérées :
 *
 *    • Sans `periode_id`, deux périodes qui se chevauchent ne peuvent pas poser
 *      deux fois la même personne sur le même créneau.
 *    • Sans `trame_id`, une présence déjà posée À LA MAIN empêche la trame d'en
 *      reposer une identique par-dessus. C'est le point qui protège le travail
 *      manuel : si la clé portait la trame, l'application créerait un doublon
 *      que l'index de la base refuserait — et l'admin lirait une erreur Postgres
 *      au lieu d'un « rien à faire ».
 *
 * Elle doit rester identique à l'index : si l'un bouge, l'autre bouge dans le
 * même commit, sinon l'application se met à échouer sur des doublons que le
 * calcul croyait absents.
 */
export function clePresence(p: { veterinaire_id: string; bloc_id: string; date: string }): string {
  return `${p.veterinaire_id}|${p.bloc_id}|${p.date}`
}

/**
 * Toutes les dates d'une période, bornes comprises.
 *
 * ⚠️ `T12:00:00Z` et arithmétique en UTC, convention du projet. Construire une
 *    date locale à minuit fait sauter ou doubler un jour au passage à l'heure
 *    d'hiver — et une période de 12 semaines en traverse un.
 *
 * Rend un tableau vide si les bornes sont incohérentes, plutôt que de boucler :
 * une période renversée est une donnée fausse, pas une raison de figer l'écran.
 */
export function datesDeLaPeriode(debut: string, fin: string): string[] {
  if (!debut || !fin || debut > fin) return []
  const dates: string[] = []
  const curseur = new Date(`${debut}T12:00:00Z`)
  const borne = new Date(`${fin}T12:00:00Z`)
  // Garde-fou de boucle : une donnée aberrante ne doit pas remplir la mémoire.
  // 3 ans de dates dépasse de loin la plus longue période jamais enregistrée
  // (les 6 périodes réelles font 2 à 12 semaines, mesuré le 01/10).
  let tours = 0
  while (curseur <= borne && tours < 1100) {
    dates.push(curseur.toISOString().slice(0, 10))
    curseur.setUTCDate(curseur.getUTCDate() + 1)
    tours++
  }
  return dates
}

/** Ce qu'il faut savoir d'une trame pour la projeter. */
export interface TramePourProjection {
  id: string
  veterinaire_id: string
  bloc_id: string
  jour: string
  semaine: string
  actif: boolean
}

/**
 * Une personne absente sur une plage de dates — B-148.
 *
 * ⚠️ VOLONTAIREMENT SANS STATUT NI MOTIF. Deux tables alimentent cette notion
 *    (`conges` avec son `statut`, `absences` avec le sien), et chacune a son
 *    vocabulaire. Les faire entrer ici obligerait cette fonction pure à
 *    connaître les règles métier des deux — et à être corrigée chaque fois que
 *    l'une d'elles gagne un statut. L'appelant trie, celle-ci applique.
 *
 * C'est aussi ce qui rend la décision lisible en un endroit : « quelles
 * absences bloquent » est une question produit, elle se répond dans l'action
 * serveur, pas au fond d'une boucle.
 */
export interface AbsencePourPresences {
  veterinaire_id: string
  /** `AAAA-MM-JJ`, bornes comprises. */
  date_debut: string
  date_fin: string
}

/** Cette personne est-elle absente ce jour-là ? */
function estAbsent(
  absences: readonly AbsencePourPresences[],
  veterinaireId: string,
  date: string,
): boolean {
  return absences.some(
    (a) => a.veterinaire_id === veterinaireId && a.date_debut <= date && a.date_fin >= date,
  )
}

/**
 * Ce que les trames VEULENT poser sur cette période.
 *
 * ⚠️ SEULES LES TRAMES ACTIVES comptent, et seules celles qui portent une
 *    tranche ACTIVE. Les deux filtres sont nécessaires, et le second n'est pas
 *    redondant : une tranche peut être retirée APRÈS que la trame a été bâtie
 *    dessus (le lot 1 refuse d'en créer une sur une tranche retirée, il
 *    n'empêche pas de retirer la tranche ensuite). Sans ce filtre, l'application
 *    poserait des présences sur une tranche que l'écran ne propose plus — donc
 *    invisibles dans les formulaires et pourtant comptées dans l'effectif.
 *
 * La projection passe par `trameViseCetteDate`, jamais par un calcul de parité
 * recopié : c'est là que vit la convention « numéro de semaine ISO, sans ancre »,
 * et la recopier était le piège n°1 du cadrage V3.
 */
export function presencesVoulues(
  trames: readonly TramePourProjection[],
  blocs: readonly Pick<BlocJournee, 'id' | 'actif'>[],
  periode: PeriodePourPresences,
  /**
   * B-148 — les gens absents ces jours-là. Par défaut vide, pour que les
   * appelants existants continuent de compiler ; mais **un appel sans absences
   * pose des présences sur des gens en vacances**, et c'est exactement le trou
   * que MiKL a signalé le 06/10 en disant « et les absences programmées ».
   */
  absences: readonly AbsencePourPresences[] = [],
): PresenceVoulue[] {
  const blocsActifs = new Set(blocs.filter((b) => b.actif).map((b) => b.id))
  const utiles = trames.filter((t) => t.actif && blocsActifs.has(t.bloc_id))
  if (utiles.length === 0) return []

  const dates = datesDeLaPeriode(periode.date_debut, periode.date_fin)
  const voulues: PresenceVoulue[] = []
  const vues = new Set<string>()

  for (const date of dates) {
    for (const t of utiles) {
      if (
        !trameViseCetteDate(
          { jour: t.jour as JourTrame, semaine: t.semaine as PariteSemaine },
          date,
        )
      ) {
        continue
      }
      // ⚠️ L'ABSENCE L'EMPORTE SUR L'HABITUDE, toujours. Une trame dit « elle
      //    est là d'habitude le mardi » ; un congé dit « pas ce mardi-là ».
      //    Poser quand même aurait affiché au comptoir quelqu'un qui est en
      //    vacances — le genre de réponse fausse servie avec l'aplomb d'une
      //    réponse juste que ce produit combat depuis le début.
      if (estAbsent(absences, t.veterinaire_id, date)) continue

      const p: PresenceVoulue = {
        veterinaire_id: t.veterinaire_id,
        bloc_id: t.bloc_id,
        date,
        trame_id: t.id,
      }
      // Deux trames peuvent viser la même case (« toutes les semaines » et
      // « semaines impaires » sur le même jour et la même tranche). L'index
      // unique de la base refuserait la seconde : on dédoublonne AVANT d'écrire,
      // sinon l'application échouerait sur une saisie que le lot 1 autorise.
      const cle = clePresence(p)
      if (vues.has(cle)) continue
      vues.add(cle)
      voulues.push(p)
    }
  }
  return voulues
}

/**
 * Ce qu'il reste réellement à écrire : les voulues qui ne sont pas déjà là.
 *
 * C'est le cœur de la règle additive. Sert DEUX fois : pour l'aperçu annoncé à
 * l'admin, et pour l'écriture elle-même — la même fonction, donc le nombre
 * annoncé est exactement celui qui sera écrit. Deux calculs séparés auraient
 * fini par diverger, et c'est précisément ce qui a coûté B-130b (« 23 cases
 * annoncées pour 19 écrites »).
 */
export function aPoser(
  voulues: readonly PresenceVoulue[],
  existantes: readonly { veterinaire_id: string; bloc_id: string; date: string }[],
): PresenceVoulue[] {
  const deja = new Set(existantes.map(clePresence))
  return voulues.filter((p) => !deja.has(clePresence(p)))
}

/**
 * Le résumé d'une application, tel que l'écran l'annonce AVANT d'écrire.
 *
 * `inchangees` n'est pas décoratif : c'est lui qui rend lisible une seconde
 * application (« 42 présences, aucune à ajouter »). Sans ce chiffre, un bouton
 * qui ne fait rien se lit comme un bouton cassé.
 */
export interface ResumeApplication {
  aPoser: number
  inchangees: number
  /** Combien de personnes distinctes sont concernées par ce qui sera posé. */
  personnes: number
  /** B-148 — présences qu'une absence a empêché de poser. */
  ecarteesPourAbsence: number
  /** Phrase prête à afficher — une seule formulation, écran et confirmation. */
  phrase: string
}

export function resumeApplication(
  voulues: readonly PresenceVoulue[],
  aEcrire: readonly PresenceVoulue[],
  /**
   * B-148 — combien de présences ont été écartées parce que la personne est
   * absente. Se calcule en comparant deux projections, l'une sans absences :
   *
   *   presencesVoulues(…).length - presencesVoulues(…, absences).length
   *
   * ⚠️ CE CHIFFRE DOIT ÊTRE DIT, pas tu. Sans lui, l'admin voit « 38 présences »
   *    là où elle en attendait 42 et n'a aucun moyen de savoir si le produit a
   *    bien fait son travail ou s'il a perdu quatre lignes. Un écart silencieux
   *    sur un planning se lit toujours comme une panne.
   */
  ecarteesPourAbsence = 0,
): ResumeApplication {
  const personnes = new Set(aEcrire.map((p) => p.veterinaire_id)).size
  const inchangees = voulues.length - aEcrire.length
  const n = aEcrire.length
  const absents =
    ecarteesPourAbsence > 0
      ? ` ${ecarteesPourAbsence} présence${ecarteesPourAbsence > 1 ? 's' : ''} non posée${ecarteesPourAbsence > 1 ? 's' : ''} : la personne est absente ce jour-là.`
      : ''

  let phrase: string
  if (voulues.length === 0 && ecarteesPourAbsence === 0) {
    phrase =
      'Aucune trame de présence ne s’applique à cette période. Définissez-les dans « Journée » avant d’appliquer.'
  } else if (voulues.length === 0) {
    // Des trames existent, mais tout le monde est absent sur la fenêtre. Le
    // dire franchement vaut mieux que « aucune trame ne s'applique », qui
    // enverrait l'admin corriger des règles parfaitement justes.
    phrase = `Rien à poser sur cette période.${absents}`
  } else if (n === 0) {
    phrase =
      `Tout est déjà en place : ${voulues.length} présence${voulues.length > 1 ? 's' : ''}, aucune à ajouter.` +
      absents
  } else {
    phrase =
      `${n} présence${n > 1 ? 's' : ''} à poser pour ${personnes} personne${personnes > 1 ? 's' : ''}` +
      (inchangees > 0 ? `, ${inchangees} déjà en place.` : '.') +
      absents
  }

  return { aPoser: n, inchangees, personnes, ecarteesPourAbsence, phrase }
}

// ── La retouche à la main ────────────────────────────────────────────────────

/** Ce qu'un écran envoie pour poser une présence, avant toute confiance. */
export interface SaisiePresence {
  veterinaire_id: string
  bloc_id: string
  date: string
  periode_id: string
}

/** Une saisie acceptée, prête pour la base. */
export interface PresenceValide {
  veterinaire_id: string
  bloc_id: string
  date: string
  periode_id: string
  /** Toujours `null` : une saisie manuelle n'a pas de trame. */
  trame_id: null
}

export type ValidationPresence =
  | { ok: true; valeur: PresenceValide }
  /** Le message est DÉJÀ en français, affichable tel quel. */
  | { ok: false; probleme: string }

/** `AAAA-MM-JJ`, et une date qui existe vraiment (31 février refusé). */
function dateReelle(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(`${iso}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

/**
 * Une présence posée à la main est-elle acceptable ?
 *
 * ⚠️ LES TROIS REFUS QUI COMPTENT, et aucun n'est gardé par la base :
 *
 *    ① UNE TRANCHE RETIRÉE. La clé étrangère ne regarde que l'existence de la
 *       ligne, jamais son `actif`. Même refus qu'au lot 1, même raison : la
 *       présence s'enregistrerait et ne serait proposée nulle part.
 *    ② UNE DATE HORS DE LA PÉRIODE. Rien en base ne lie `date` à
 *       `periode_id` — un CHECK ne peut pas lire une autre table. Sans ce refus,
 *       une présence posée hors des bornes serait écrite, rattachée à la
 *       période, et INVISIBLE sur la grille qui ne dessine que ses bornes :
 *       elle compterait dans les totaux sans apparaître nulle part.
 *    ③ UNE DATE QUI N'EXISTE PAS. Postgres refuse `2026-02-31`, mais avec un
 *       message de type illisible dans une modale.
 */
export function validerPresence(
  saisie: SaisiePresence,
  blocs: readonly Pick<BlocJournee, 'id' | 'nom' | 'actif'>[],
  periode: PeriodePourPresences,
): ValidationPresence {
  const veterinaireId = (saisie.veterinaire_id ?? '').trim()
  if (!veterinaireId) return { ok: false, probleme: 'Indiquez qui est présent.' }

  const blocId = (saisie.bloc_id ?? '').trim()
  if (!blocId) return { ok: false, probleme: 'Choisissez une tranche horaire.' }

  const bloc = blocs.find((b) => b.id === blocId)
  if (!bloc) {
    return { ok: false, probleme: 'Cette tranche horaire n’existe pas dans votre cabinet.' }
  }
  if (!bloc.actif) {
    return {
      ok: false,
      probleme: `La tranche « ${bloc.nom} » a été retirée. Remettez-la avant d’y poser quelqu’un.`,
    }
  }

  const date = (saisie.date ?? '').trim()
  if (!dateReelle(date)) {
    return { ok: false, probleme: 'Indiquez une date valide (jour, mois, année).' }
  }

  const periodeId = (saisie.periode_id ?? '').trim()
  if (!periodeId || periodeId !== periode.id) {
    return { ok: false, probleme: 'Planning introuvable. Rechargez l’écran.' }
  }

  if (date < periode.date_debut || date > periode.date_fin) {
    return {
      ok: false,
      probleme: `Le ${date} est en dehors de ce planning (${periode.date_debut} → ${periode.date_fin}).`,
    }
  }

  return {
    ok: true,
    valeur: { veterinaire_id: veterinaireId, bloc_id: blocId, date, periode_id: periodeId, trame_id: null },
  }
}

/**
 * Cette présence est-elle déjà posée ? (même personne, même tranche, même jour)
 *
 * La base le refuse par l'index unique. On le redemande ici pour l'usage :
 * « duplicate key value violates unique constraint » dans une modale se lit
 * comme une panne, alors que c'est un geste déjà fait.
 *
 * Rend aussi l'ORIGINE, parce que les deux cas ne se disent pas pareil : une
 * présence venue de la trame s'explique (« elle vient de sa trame »), une
 * présence posée à la main est simplement déjà là.
 */
export function presenceDejaPosee(
  valeur: { veterinaire_id: string; bloc_id: string; date: string },
  existantes: readonly {
    veterinaire_id: string
    bloc_id: string
    date: string
    trame_id: string | null
  }[],
): { presente: false } | { presente: true; deLaTrame: boolean } {
  const cle = clePresence(valeur)
  const jumelle = existantes.find((p) => clePresence(p) === cle)
  return jumelle ? { presente: true, deLaTrame: jumelle.trame_id !== null } : { presente: false }
}
