// ============================================================
// GUARDVETO — Ce qu'une absence couvre, et ce qu'elle ne couvre pas
// ============================================================
// B-163. Tranché par MiKL le 13/10, en trois temps :
//
//   ① *« il est possible qu'un véto soit absent la journée mais pas la nuit, ou
//     juste la nuit, ou juste le matin mais pas l'après-midi »*
//   ② *« il est possible qu'un véto soit absent pour une réunion parent-prof de
//     2h un après-midi mais qu'il soit là le reste du temps »*
//   ③ *« la journée ça n'est pas la nuit, ce sont 2 choses distinctes »*
//
// ── POURQUOI CE FICHIER EXISTE, ET POURQUOI IL EST LA SEULE AUTORITÉ ─────────
//
// 🔴 CE CHAMP A DÉJÀ ÉTÉ LIVRÉ UNE FOIS, ET IL MENTAIT.
//    `conges.creneau` proposait « Toute la journée / Matin / Après-midi /
//    Soirée » jusqu'au 26/08 (B-043). `checkR16Conge` ne l'a JAMAIS lu : quel
//    que soit le créneau choisi, le congé bloquait la journée entière. Quelqu'un
//    posant une matinée perdait sa garde du soir, sans qu'aucun écran ne le
//    dise. Le champ a donc été retiré — pas la demande, qui revient ici.
//
//    ⛔ LA SEULE FAÇON DE NE PAS LE REFAIRE une troisième fois est que la
//       question « qu'est-ce que ce périmètre retire ? » n'ait qu'UN endroit où
//       se poser. C'est celui-ci. Tout lecteur de `conges` ou d'`absences` qui
//       décide d'une indisponibilité passe par ces fonctions, et
//       `tests/lib/perimetre-absence.test.ts` refuse qu'un chemin s'en écarte.
//
// ── LA DÉCISION, EN UNE PHRASE ──────────────────────────────────────────────
//
// Une absence NOMME ce qu'elle couvre. Elle retire exactement ça, jamais plus.
// Un périmètre `ponctuel` ne retire RIEN — ni présence de journée, ni garde :
// la personne est là le reste du temps, et c'est tout l'objet du choix de MiKL
// (option A du 13/10). Mais il doit être DIT à l'écran, sinon c'est un décor.
// ============================================================

import type { CreneauBlocJournee } from '@/types'
import { normaliserHeure, plageLisible } from '@/lib/journee/blocs'

/**
 * Les six formes qu'une indisponibilité peut prendre. Liste FERMÉE.
 *
 * ⚠️ `journee` N'INCLUT PAS LA NUIT — tranché mot pour mot le 13/10. C'est un
 *    changement de comportement : jusqu'ici, tout congé bloquait la garde du
 *    soir. D'où `PERIMETRE_PAR_DEFAUT` juste en dessous, qui protège l'existant.
 */
export type PerimetreAbsence =
  | 'ponctuel'
  | 'matin'
  | 'apres-midi'
  | 'journee'
  | 'nuit'
  | 'journee-et-nuit'

export const PERIMETRES: readonly PerimetreAbsence[] = [
  'ponctuel',
  'matin',
  'apres-midi',
  'journee',
  'nuit',
  'journee-et-nuit',
] as const

/**
 * Ce qu'une absence vaut quand personne n'a choisi.
 *
 * 🔴 C'EST `journee-et-nuit`, ET CE N'EST PAS UN DÉTAIL. Les congés posés avant
 *    ce lot ont tous `creneau = null` (32 lignes, mesurées en août) et ont été
 *    acceptés sous le comportement « un congé bloque tout ». Les relire comme
 *    `journee` rendrait disponibles des gardes que personne n'a jamais acceptées
 *    — c'est-à-dire que le produit inventerait du consentement. On ne
 *    réinterprète jamais une donnée ancienne dans un sens plus permissif.
 */
export const PERIMETRE_PAR_DEFAUT: PerimetreAbsence = 'journee-et-nuit'

/** Le libellé lisible, source unique pour tous les écrans et pour Filou. */
export const LIBELLE_PERIMETRE: Record<PerimetreAbsence, string> = {
  ponctuel: 'Indisponibilité ponctuelle',
  matin: 'Le matin',
  'apres-midi': "L'après-midi",
  journee: 'Toute la journée (pas la nuit)',
  nuit: 'La nuit (gardes)',
  'journee-et-nuit': 'La journée et la nuit',
}

/** La phrase d'aide, celle qui évite d'avoir à devenir devin devant la liste. */
export const AIDE_PERIMETRE: Record<PerimetreAbsence, string> = {
  ponctuel: 'Je suis là le reste de la journée et de ma garde. Rien ne change au planning.',
  matin: "Je ne suis pas là le matin. L'après-midi et la nuit ne changent pas.",
  'apres-midi': "Je ne suis pas là l'après-midi. Le matin et la nuit ne changent pas.",
  journee: 'Je ne suis pas là de la journée, mais je peux assurer ma garde de nuit.',
  nuit: 'Je ne peux pas assurer de garde. Ma journée au cabinet ne change pas.',
  'journee-et-nuit': 'Je ne suis là ni la journée, ni la nuit.',
}

/** Vrai quand la valeur vient d'une base ou d'un formulaire, et qu'on s'en méfie. */
export function estPerimetre(v: unknown): v is PerimetreAbsence {
  return typeof v === 'string' && (PERIMETRES as readonly string[]).includes(v)
}

/**
 * Lit un périmètre venu de la base, avec le repli qui protège l'existant.
 *
 * ⚠️ `null` et l'inconnu tombent sur `journee-et-nuit`, JAMAIS sur `ponctuel`.
 *    Un défaut de lecture doit pencher du côté qui retire — l'inverse ferait
 *    silencieusement réapparaître quelqu'un sur une garde qu'il a refusée.
 */
export function lirePerimetre(v: unknown): PerimetreAbsence {
  return estPerimetre(v) ? v : PERIMETRE_PAR_DEFAUT
}

// ── CE QUE CHAQUE PÉRIMÈTRE RETIRE ──────────────────────────────────────────

/**
 * Cette absence empêche-t-elle d'assurer une garde ?
 *
 * Lue par R16, par le validateur de planning, par la détection de conflit, par
 * les listes de remplaçants, par les échanges, et par le parcours de réparation.
 * Six décideurs, une seule réponse — c'est tout l'intérêt.
 */
export function toucheLesGardes(p: PerimetreAbsence): boolean {
  return p === 'nuit' || p === 'journee-et-nuit'
}

/** Cette absence retire-t-elle de la présence au cabinet ? */
export function toucheLaJournee(p: PerimetreAbsence): boolean {
  return p === 'matin' || p === 'apres-midi' || p === 'journee' || p === 'journee-et-nuit'
}

/** Une indisponibilité de quelques heures, qui ne retire rien. */
export function estPonctuel(p: PerimetreAbsence): boolean {
  return p === 'ponctuel'
}

/**
 * Les créneaux de bloc dont la présence est RETIRÉE.
 *
 * ⚠️ UNE ABSENCE DU MATIN NE RETIRE PAS UN BLOC « JOURNÉE COMPLÈTE ».
 *    Les blocs du premier cabinet sont Matin 08-12, Après-midi 14-18 et Journée
 *    complète 08-18 (mesurés le 13/10). Quelqu'un d'absent le matin, posé sur
 *    « Journée complète », est bel et bien là de 14h à 18h : retirer sa présence
 *    le ferait disparaître d'un après-midi qu'il travaille. C'est exactement
 *    l'option B que MiKL a écartée. Le bloc reste, et `blocsPartiels` dit qu'il
 *    est amputé.
 */
export function blocsRetires(p: PerimetreAbsence): CreneauBlocJournee[] {
  switch (p) {
    case 'matin':
      return ['matin']
    case 'apres-midi':
      return ['apres-midi']
    case 'journee':
    case 'journee-et-nuit':
      return ['matin', 'apres-midi', 'journee']
    case 'nuit':
    case 'ponctuel':
      return []
  }
}

/**
 * Les créneaux de bloc CONSERVÉS mais entamés — ce que l'écran doit signaler.
 *
 * C'est la moitié visible de l'option A : la présence reste, et la case dit
 * « absent le matin » ou « absent 14h-16h ». Sans cette moitié, le choix de
 * périmètre serait une case à cocher sans effet lisible, soit le défaut de
 * B-043 déplacé d'un cran.
 */
export function blocsPartiels(p: PerimetreAbsence): CreneauBlocJournee[] {
  switch (p) {
    // Le bloc « journée » est entamé : la personne manque une moitié.
    case 'matin':
    case 'apres-midi':
      return ['journee']
    // Quelques heures quelque part : tout bloc du jour peut être entamé.
    case 'ponctuel':
      return ['matin', 'apres-midi', 'journee']
    case 'journee':
    case 'journee-et-nuit':
    case 'nuit':
      return []
  }
}

/**
 * Ce périmètre vaut-il repos pour le moteur ?
 *
 * Lu par `estVeilleDeRepos` (ne pas faire veiller quelqu'un qui enchaîne) et par
 * `estWeekEndAvantVacances`. Seul `ponctuel` ne compte pas : deux heures de
 * réunion ne sont pas un repos, et les compter en ferait un argument pour
 * refuser une garde — un refus fondé sur rien.
 */
export function vautRepos(p: PerimetreAbsence): boolean {
  return !estPonctuel(p)
}

// ── CE QUE L'ÉCRAN PROPOSE, SELON CE QUE LE CABINET A ACHETÉ ────────────────

/**
 * Les choix offerts à la pose.
 *
 * ⚠️ SANS LE MODULE JOURNÉE, LES CRÉNEAUX DE JOURNÉE N'APPARAISSENT PAS.
 *    Exigence de MiKL : *« s'il n'a pas déclenché le planning journée, cette
 *    option n'apparaît pas »*. Un cabinet qui ne gère que ses gardes n'a aucune
 *    raison de voir « le matin » — il n'a pas de matin dans le produit. Il lui
 *    reste `journee-et-nuit` (le comportement qu'il connaît) et `ponctuel`.
 */
export function perimetresOfferts(moduleJourneeActif: boolean): PerimetreAbsence[] {
  if (moduleJourneeActif) return [...PERIMETRES]
  return ['ponctuel', 'nuit', 'journee-et-nuit']
}

// ── LES HEURES DU PONCTUEL ──────────────────────────────────────────────────

export interface HeuresPonctuel {
  heure_debut: string
  heure_fin: string
}

export type ValidationPerimetre =
  | { ok: true; perimetre: PerimetreAbsence; heures: HeuresPonctuel | null }
  /** Message déjà en français, affichable tel quel par la modale de refus. */
  | { ok: false; probleme: string }

/**
 * Ce qu'un formulaire envoie, avant toute confiance.
 *
 * ⚠️ LES HEURES NE SONT EXIGÉES QUE POUR `ponctuel`, ET REFUSÉES AILLEURS.
 *    Garder « 14h-16h » sur une absence devenue « toute la journée » laisserait
 *    deux vérités dans la même ligne, et c'est la plus précise que les écrans
 *    afficheraient — en annonçant une présence qui n'existe pas.
 */
export function validerPerimetre(
  perimetreBrut: unknown,
  heureDebutBrut?: string | null,
  heureFinBrut?: string | null,
): ValidationPerimetre {
  if (!estPerimetre(perimetreBrut)) {
    return { ok: false, probleme: "Ce périmètre d'absence n'existe pas." }
  }

  if (!estPonctuel(perimetreBrut)) {
    return { ok: true, perimetre: perimetreBrut, heures: null }
  }

  const debut = normaliserHeure(heureDebutBrut ?? '')
  const fin = normaliserHeure(heureFinBrut ?? '')
  if (!debut || !fin) {
    return {
      ok: false,
      probleme:
        "Une indisponibilité ponctuelle a besoin d'une heure de début et d'une heure de fin.",
    }
  }
  if (debut >= fin) {
    return { ok: false, probleme: "L'heure de fin doit être après l'heure de début." }
  }

  return { ok: true, perimetre: perimetreBrut, heures: { heure_debut: debut, heure_fin: fin } }
}

/**
 * La phrase qui dit le périmètre à l'écran.
 *
 * Rend `null` pour `journee-et-nuit` : c'est le cas général, et une mention qui
 * s'affiche toujours cesse d'être lue. Les cinq autres sont des exceptions, donc
 * des informations.
 */
export function phrasePerimetre(
  p: PerimetreAbsence,
  heures?: HeuresPonctuel | null,
): string | null {
  if (p === 'journee-et-nuit') return null
  if (p === 'ponctuel') {
    return heures
      ? `Absent ${plageLisible(heures.heure_debut, heures.heure_fin)} — présent le reste du temps`
      : 'Indisponible quelques heures — présent le reste du temps'
  }
  return LIBELLE_PERIMETRE[p]
}
