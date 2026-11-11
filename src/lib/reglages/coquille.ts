// ============================================================
// GUARDVETO — Réglages refondus : la coquille et ses règles (B-202)
// ============================================================
// Maquette validée par MiKL le 10/11 : `docs/maquettes/B-202-reglages.html`.
// Cinq sections au lieu d'une grille de cartes mélangées. L'administratrice
// les voit toutes ; les vétos et le secrétariat n'ont que « Pour moi ».
//
// Tout ce qui DÉCIDE vit ici, sans React, pour être testé : quelles sections,
// quelle pastille dans le sommaire, et surtout ce qu'envoie chaque bouton
// « Enregistrer ».
// ============================================================

import { estUnEchec, type LigneEmail } from './libelles'

export type IdSection = 'moi' | 'cabinet' | 'messagerie' | 'connexions' | 'suivi'

export interface Section {
  id: IdSection
  nom: string
  /** La ligne sous le nom, dans la liste du téléphone. */
  resume: string
}

/** L'ordre du sommaire : le plus personnel d'abord, le journal (rarement ouvert) en dernier. */
export const SECTIONS: readonly Section[] = [
  { id: 'moi', nom: 'Pour moi', resume: 'Notifications, agenda' },
  { id: 'cabinet', nom: 'Le cabinet', resume: 'Adresse, e-mails' },
  // MiKL, 10/11 : « Fonctions de l'équipe » n'était pas instinctif, et aucune
  // autre fonction à allumer n'est prévue — la section porte son vrai nom.
  { id: 'messagerie', nom: 'Messagerie', resume: 'Fil d’équipe, conversations privées' },
  { id: 'connexions', nom: 'Connexions', resume: 'Google Agenda' },
  // MiKL, 11/11 : « à la place de suivi j'aurais mis journal des emails ».
  // L'identifiant reste `suivi` : il ne se lit que dans l'adresse.
  { id: 'suivi', nom: 'Journal des e-mails', resume: 'Les e-mails partis et leur état' },
]

export type RoleReglages = 'admin' | 'veto' | 'secretaire'

/** Les sections qu'un rôle voit. Hors administratrice, rien du cabinet. */
export function sectionsPour(role: RoleReglages): readonly Section[] {
  return role === 'admin' ? SECTIONS : SECTIONS.filter((s) => s.id === 'moi')
}

/**
 * La section demandée par l'adresse (`?section=`), si ce rôle y a droit.
 * Une valeur inconnue ou interdite retombe sur la première, sans erreur :
 * un lien périmé ne doit pas mener à une page blanche.
 */
export function sectionDemandee(param: string | null | undefined, role: RoleReglages): IdSection | null {
  if (!param) return null
  return sectionsPour(role).find((s) => s.id === param)?.id ?? null
}

export interface EtatAttentions {
  zoneConnue: boolean
  envoiConfigure: boolean
  agendaBranche: boolean
  emails: Pick<LigneEmail, 'statut'>[]
}

/** Ce que le sommaire signale : un point quand c'est à régler, un nombre pour les e-mails en échec. */
export interface Attentions {
  cabinet: boolean
  connexions: boolean
  suivi: number
}

export function nbEchecs(emails: Pick<LigneEmail, 'statut'>[]): number {
  return emails.filter((e) => estUnEchec(e.statut)).length
}

export function attentions(e: EtatAttentions): Attentions {
  return {
    cabinet: !e.zoneConnue || !e.envoiConfigure,
    connexions: !e.agendaBranche,
    suivi: nbEchecs(e.emails),
  }
}

/** Les trois champs que `configurerPartagesCabinet` réécrit TOUJOURS ensemble. */
export interface Partages {
  googleCalendarId: string
  brevoFromEmail: string
  brevoFromName: string
}

/**
 * Ce qu'un bouton « Enregistrer » envoie : SON champ, et pour les autres la
 * dernière valeur ENREGISTRÉE — jamais ce qui traîne dans un autre champ.
 *
 * 🔴 LE PIÈGE QUE ÇA FERME. L'action serveur réécrit les trois colonnes d'un
 *    coup. L'écran actuel lui passait l'état de saisie commun aux deux cartes :
 *    corriger le nom d'expéditeur enregistrait aussi, sans le dire, l'adresse
 *    d'agenda à moitié tapée dans l'autre carte (et inversement).
 *
 * `brevoFromEmail` n'est plus saisissable (retiré le 21/08, il coupait les
 * e-mails du cabinet) : il repart toujours tel qu'il a été chargé.
 */
export function partagesAEnvoyer(
  enregistre: Partages,
  sujet: 'agenda' | 'expediteur',
  valeur: string,
): Partages {
  const v = valeur.trim()
  return sujet === 'agenda'
    ? { ...enregistre, googleCalendarId: v }
    : { ...enregistre, brevoFromName: v }
}
