// ============================================================
// GUARDVETO — Réglages : les mots et les formats partagés (B-202)
// ============================================================
// Sortis de `components/v2/ReglagesV2.tsx` le 10/11 pour que l'ancien écran
// et l'onglet refondu lisent LA MÊME source pendant la recette (l'ancien
// écran est retiré depuis B-202b, 12/11). Deux
// copies d'un dictionnaire divergent toujours : c'est ainsi que
// « conge_demande » s'est affiché en code brut pendant cinq semaines.
// ============================================================

import { initialesVeto } from '@/lib/agenda/initiales'

export interface ValeursCabinet {
  googleCalendarId: string
  brevoFromEmail: string
  brevoFromName: string
  adresse: string
  codePostal: string
  ville: string
  zoneScolaire: string
  regionFeries: string
}

export interface LigneEmail {
  id: string
  type: string
  destinataire: string
  statut: string
  erreur: string | null
  created_at: string
  vetNom: string | null
}

/**
 * Un créneau du SOCLE (profil_id NULL), tel qu'il vit dans Google Agenda.
 * `heureDebut`/`heureFin` au format `'HH:MM'` (Postgres TIME déjà tronqué
 * côté page) — VRAIS horaires du cabinet, jamais une valeur en dur.
 */
export interface CreneauAgenda {
  id: string
  nom: string
  /** `null` = pas encore personnalisé, le champ repart du `nom`. */
  libelleAgenda: string | null
  heureDebut: string
  heureFin: string
  /**
   * Les rôles nommés du créneau (`creneau_modele.roles`), dans l'ordre des
   * places — même source que `google-calendar.ts`. L'aperçu DOIT passer par
   * `roleCourt(roles?.[placeIndex], placeIndex)` (bug B-080).
   */
  roles: string[]
}

/** 'HH:MM' → '18h' (minutes nulles) ou '18h30'. Pour L'AFFICHAGE de l'aperçu. */
export function formatHeureCourte(hhmm: string): string {
  const [h, m] = hhmm.split(':')
  return m && m !== '00' ? `${h}h${m}` : `${h}h`
}

/** Le véto d'exemple de l'aperçu — celui du cahier des charges (« garde-ACB-1er »). */
export const EXEMPLE_NOM = initialesVeto('Anne-Catherine', 'Bernard')

export const ZONE_LABEL: Record<string, string> = { A: 'Zone A', B: 'Zone B', C: 'Zone C' }
// Non exporté depuis B-202b : son seul lecteur hors de ce fichier était l'ancien écran.
const REGION_LABEL: Record<string, string> = {
  metropole: 'Métropole',
  'alsace-moselle': 'Alsace-Moselle',
  guadeloupe: 'Guadeloupe',
  martinique: 'Martinique',
  guyane: 'Guyane',
  reunion: 'La Réunion',
  mayotte: 'Mayotte',
  polynesie: 'Polynésie',
}

/** « Zone A · Métropole », ou `null` tant qu'aucune zone n'est connue. */
export function libelleZone(zone: string, region: string): string | null {
  if (!zone) return null
  return `${ZONE_LABEL[zone] ?? zone} · ${REGION_LABEL[region] ?? region}`
}

export const TYPE_EMAIL: Record<string, string> = {
  planning_publie: 'Planning publié',
  garde_modifiee: 'Garde modifiée',
  rappel_publication: 'Rappel de publication',
  appel_volontaires: 'Appel aux volontaires',
  depannage_confirme: 'Dépannage confirmé',
  conge_valide: 'Congé validé',
  conge_refuse: 'Congé refusé',
  email_test: 'Essai d’envoi',
  // Autorisé en base depuis B-134 (26/09) et jamais traduit : l'écran
  // affichait le code brut « conge_demande » (capture MiKL, 02/11).
  conge_demande: 'Demande de congé',
  // B-193c — un message de la messagerie, envoyé aussi par mail par l'admin.
  message: 'Message de la messagerie',
}

/**
 * L'état d'un e-mail, en français.
 *
 * « Parti » est volontairement modeste : c'est tout ce qu'on sait au moment de
 * l'envoi — le service d'expédition a accepté le message. « Remis » n'apparaît
 * que lorsque Brevo nous rappelle pour le confirmer (`/api/webhooks/brevo`).
 */
export const LIBELLE_STATUT: Record<string, string> = {
  envoye: 'Parti',
  remis: 'Remis',
  differe: 'En attente',
  spam: 'Indésirable',
  rejete: 'Rejeté',
  erreur: 'Refusé',
}

/** Le ton de la pastille. Tout ce qui n'est pas arrivé se voit en rouge. */
export const TON_STATUT: Record<string, string> = {
  envoye: 'envoye',
  remis: 'remis',
  differe: 'attente',
  spam: 'echec',
  rejete: 'echec',
  erreur: 'echec',
}

/**
 * Un e-mail qui n'est pas arrivé, quelle que soit l'étape où on l'a appris :
 * un rejet annoncé par le webhook une minute plus tard est le même problème
 * pour le cabinet qu'un refus au moment de l'envoi.
 */
export function estUnEchec(statut: string): boolean {
  return TON_STATUT[statut] === 'echec'
}

/**
 * Faut-il montrer la raison sous l'état ? La colonne `erreur` vaut « sent »
 * quand Brevo a ACCEPTÉ le message : sous « Remis », elle s'affichait en rouge
 * comme une panne. On ne montre une raison que si l'e-mail n'est pas arrivé,
 * ou pas encore.
 */
export function montrerRaison(e: Pick<LigneEmail, 'statut' | 'erreur'>): boolean {
  return !!e.erreur && (TON_STATUT[e.statut] === 'echec' || TON_STATUT[e.statut] === 'attente')
}

export function libellePeriode(p: {
  libelle?: string | null
  saison?: string | null
  date_debut: string
}): string {
  return p.libelle ?? `${p.saison === 'ete' ? 'Été' : 'Hiver'} ${p.date_debut.slice(0, 4)}`
}

export function dateHeure(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
