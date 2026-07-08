// ============================================================
// GUARDVETO — Utilitaires de dates pour le moteur
// ============================================================

import type { JourSemaine, Saison, CalendrierResolu, PlanningPartiel, AttributionGarde } from './types'

// ── Helpers de base ──────────────────────────────────────

/** Numéro ISO de la semaine (1-53) */
export function numeroSemaine(date: string): number {
  const d = new Date(date + 'T12:00:00Z')
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() + (4 - (d.getUTCDay() || 7)))
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/**
 * Semaine impaire (numéro ISO % 2 !== 0)
 * @deprecated Utiliser estSemaineImpaireAncrée() qui résiste à la semaine ISO 53.
 *   Cette fonction retourne un résultat incorrect pour décembre 2026 (semaine 53 ISO)
 *   car elle se base sur le numéro ISO global au lieu d'un comptage relatif à une ancre.
 */
export function estSemaineImpaire(date: string): boolean {
  return numeroSemaine(date) % 2 !== 0
}

/**
 * Calcule si une semaine est "impaire" relativement à une ancre.
 * L'ancre se recale à chaque début de vacances scolaires (évite le bug semaine ISO 53).
 *
 * @param date - Date ISO yyyy-mm-dd à tester
 * @param ancre - Date ISO du début de la période (lundi de référence)
 * @param vacancesScolaires - Plages de vacances pour les recalages
 *
 * @example
 * // Sans vacances : comptage simple depuis l'ancre
 * estSemaineImpaireAncrée('2026-12-28', '2026-09-01', []) // 118 jours → semaine 16 → paire (false)
 *
 * // Avec vacances : l'ancre se recale au début des vacances
 * estSemaineImpaireAncrée('2026-11-02', '2026-09-01', [{ debut: '2026-10-17', fin: '2026-10-31' }])
 * // ancre effective = '2026-10-17', diff = ~2 semaines → paire
 */
export function estSemaineImpaireAncrée(
  date: string,
  ancre: string,
  vacancesScolaires: Array<{ debut: string; fin: string }>
): boolean {
  // ⚠️ CORRECTIF parité intra-semaine (2026-06) :
  // La parité est une propriété de la SEMAINE entière (une semaine est paire OU
  // impaire — pas certains de ses jours). On RAMÈNE donc date, ancre et chaque
  // recalage de vacances au LUNDI de leur semaine avant de compter les semaines.
  // Sans cette normalisation, une ancre tombant un mardi (ex. 2026-09-01)
  // coupait les semaines en deux : le lundi et le samedi d'une même semaine
  // recevaient des parités OPPOSÉES → Anne-Sophie pouvait être déclarée dispo
  // un jour et indispo un autre de la même semaine (gardes incohérentes
  // observées en semaines ISO 28/29/31/32).
  const ancreLundi = lundiDeSemaine(ancre)
  const dateLundi = lundiDeSemaine(date)

  // Trouver l'ancre effective = dernier début de vacances AVANT ou ÉGAL à la date
  // et STRICTEMENT après l'ancre initiale (pour avancer l'ancre uniquement).
  // On compare la date de début de vacances brute (chevauchement), mais on
  // ancre sur le LUNDI de cette semaine de vacances.
  let ancreEffectiveLundi = ancreLundi
  for (const v of vacancesScolaires) {
    const vLundi = lundiDeSemaine(v.debut)
    if (v.debut <= date && vLundi > ancreEffectiveLundi) {
      ancreEffectiveLundi = vLundi
    }
  }

  // Nombre de semaines pleines entre deux lundis (différence multiple de 7 jours).
  // On arrondit (Math.round) pour neutraliser tout résidu de fuseau/DST.
  const msParSemaine = 7 * 24 * 60 * 60 * 1000
  const diffMs =
    new Date(dateLundi + 'T12:00:00Z').getTime() -
    new Date(ancreEffectiveLundi + 'T12:00:00Z').getTime()
  const diffSemaines = Math.round(diffMs / msParSemaine)

  return diffSemaines % 2 !== 0
}

/** Jour de la semaine (0=dimanche … 6=samedi) */
export function jourIndex(date: string): number {
  return new Date(date + 'T12:00:00Z').getUTCDay()
}

/** Nom du jour en français */
export function jourDeLaSemaine(date: string): JourSemaine {
  const jours: JourSemaine[] = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
  return jours[jourIndex(date)]
}

/** Lundi de la semaine contenant la date */
export function lundiDeSemaine(date: string): string {
  const d = new Date(date + 'T12:00:00Z')
  const day = d.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().split('T')[0]
}

/** Vendredi de la semaine contenant la date */
export function vendrediDeSemaine(date: string): string {
  const lundi = lundiDeSemaine(date)
  const d = new Date(lundi + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 4)
  return d.toISOString().split('T')[0]
}

/** Samedi de la semaine contenant la date */
export function samediDeSemaine(date: string): string {
  const lundi = lundiDeSemaine(date)
  const d = new Date(lundi + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 5)
  return d.toISOString().split('T')[0]
}

/** Ajouter N jours à une date ISO */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

/** Comparer deux dates ISO */
export function dateEntre(date: string, debut: string, fin: string): boolean {
  return date >= debut && date <= fin
}

// ── Saisons ─────────────────────────────────────────────

/** Premier lundi de mai d'une année */
function premierLundiMai(annee: number): string {
  for (let j = 1; j <= 7; j++) {
    const d = new Date(Date.UTC(annee, 4, j)) // mai = 4
    if (d.getUTCDay() === 1) return d.toISOString().split('T')[0]
  }
  return `${annee}-05-01`
}

/** Dernier dimanche d'août d'une année */
function dernierDimancheAout(annee: number): string {
  for (let j = 31; j >= 25; j--) {
    const d = new Date(Date.UTC(annee, 7, j)) // août = 7
    if (d.getUTCDay() === 0) return d.toISOString().split('T')[0]
  }
  return `${annee}-08-31`
}

/** La date est-elle en saison été ? */
export function estEnEte(date: string): boolean {
  const annee = parseInt(date.substring(0, 4))
  return dateEntre(date, premierLundiMai(annee), dernierDimancheAout(annee))
}

export function getSaison(date: string): Saison {
  return estEnEte(date) ? 'ete' : 'hiver'
}

// ── Jours fériés français ────────────────────────────────

function calculerPaques(annee: number): Date {
  // Algorithme de Meeus/Jones/Butcher
  const a = annee % 19
  const b = Math.floor(annee / 100)
  const c = annee % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mois = Math.floor((h + l - 7 * m + 114) / 31)
  const jour = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(annee, mois - 1, jour))
}

export function estJourFerie(date: string, calendrier?: CalendrierResolu): boolean {
  if (calendrier) return calendrier.feries.has(date)

  const annee = parseInt(date.substring(0, 4))
  const mmjj = date.substring(5) // MM-DD

  // Fériés fixes
  const fixes = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25']
  if (fixes.includes(mmjj)) return true

  // Fériés mobiles (basés sur Pâques)
  const paques = calculerPaques(annee)
  const lundiPaques = new Date(paques); lundiPaques.setUTCDate(paques.getUTCDate() + 1)
  const ascension = new Date(paques); ascension.setUTCDate(paques.getUTCDate() + 39)
  const lundiPentecote = new Date(paques); lundiPentecote.setUTCDate(paques.getUTCDate() + 50)

  const mobiles = [lundiPaques, ascension, lundiPentecote].map(d => d.toISOString().split('T')[0])
  return mobiles.includes(date)
}

// ── Vacances scolaires France Zone C (Paris) ─────────────
// Données 2025-2026 (à mettre à jour chaque année)

const VACANCES_SCOLAIRES: Array<{ debut: string; fin: string; label: string }> = [
  { debut: '2025-10-18', fin: '2025-11-03', label: 'Toussaint 2025' },
  { debut: '2025-12-20', fin: '2026-01-05', label: 'Noël 2025-2026' },
  { debut: '2026-02-14', fin: '2026-03-02', label: 'Hiver 2026' },
  { debut: '2026-04-11', fin: '2026-04-27', label: 'Pâques 2026' },
  { debut: '2026-07-04', fin: '2026-08-31', label: 'Été 2026' },
  // 2026-2027
  { debut: '2026-10-17', fin: '2026-11-02', label: 'Toussaint 2026' },
  { debut: '2026-12-19', fin: '2027-01-04', label: 'Noël 2026-2027' },
  { debut: '2027-02-13', fin: '2027-03-01', label: 'Hiver 2027' },
  { debut: '2027-04-10', fin: '2027-04-26', label: 'Pâques 2027' },
  { debut: '2027-07-03', fin: '2027-08-31', label: 'Été 2027' },
]

export function estEnVacancesScolaires(date: string, calendrier?: CalendrierResolu): boolean {
  if (calendrier) return calendrier.vacancesScolaires.some(({ debut, fin }) => dateEntre(date, debut, fin))
  return VACANCES_SCOLAIRES.some(({ debut, fin }) => dateEntre(date, debut, fin))
}

/**
 * Dernière date couverte par la liste de vacances scolaires EN DUR (fallback
 * hors-DB). Au-delà, la liste est OBSOLÈTE : `estEnVacancesScolaires` sans
 * calendrier zone-aware renverra `false` pour des dates réellement en vacances,
 * ce qui fausse silencieusement les règles « repos sauf vacances ».
 */
export const VACANCES_FALLBACK_FIN = '2027-08-31'

/**
 * Le fallback en dur est-il obsolète pour couvrir une période finissant à
 * `dateFin` ? (true = la liste en dur ne couvre pas toute la période → il faut
 * alerter et/ou étendre la table `vacances_scolaires`.)
 *
 * N'est utile que sur le CHEMIN FALLBACK (aucun calendrier zone-aware résolu) :
 * appelé par les assembleurs d'input (loader / resoudreContexte) pour lever
 * l'alerte AU BON ENDROIT (période connue), jamais dans la fonction chaude
 * `estEnVacancesScolaires` (appelée par date → spam de logs).
 */
export function fallbackVacancesObsolete(dateFin: string): boolean {
  return dateFin > VACANCES_FALLBACK_FIN
}

// ── Fêtes de fin d'année ─────────────────────────────────

/**
 * Retourne true pour les 4 jours de fêtes de fin d'année :
 * 24-25 décembre (Noël) et 31 décembre - 1er janvier (Nouvel An).
 * Dec 25 et Jan 1 sont déjà des jours fériés officiels.
 * Dec 24 et Dec 31 sont des veilles de fête (soirs sensibles).
 */
export function estFeteFinAnnee(date: string): boolean {
  const mmjj = date.substring(5) // MM-DD
  return mmjj === '12-24' || mmjj === '12-25' || mmjj === '12-31' || mmjj === '01-01'
}

// ── Helpers planning ────────────────────────────────────

/** La date est-elle un week-end (sam ou dim) ? */
export function estWeekend(date: string): boolean {
  const j = jourIndex(date)
  return j === 0 || j === 6
}

// ── Lookback inter-périodes (#17 — vue étendue des règles de rythme) ──

/**
 * attributionsAvecContexte — vue ÉTENDUE d'un planning pour les seules règles
 * de RYTHME (R10, espacement_min, espacement_weekend, R3, au_plus_n fenêtre).
 *
 * À la jonction de deux périodes, ces règles doivent « voir » les gardes de la
 * FIN de la période précédente (le `contexteAnterieur`, ~10 jours de lookback)
 * pour ne pas laisser un véto enchaîner deux week-ends à cheval sur deux
 * périodes. On concatène donc les attributions figées antérieures DEVANT les
 * attributions courantes, et on ne fait consommer cette vue QUE par les
 * prédicats de rythme (jamais par la couverture, l'équité, R21/R22, etc.).
 *
 * Le lookback ne crée AUCUN slot, ne compte dans AUCUNE équité : il ne sert
 * qu'à juger les écarts / consécutivités.
 *
 * Distinction VOLONTAIRE `undefined` vs `[]` (leçon RG2) :
 *   • `undefined` / absent → repli HISTORIQUE : on renvoie le planning tel quel
 *     (référence identique → byte-identique, pas d'allocation superflue).
 *   • `[]` (donnée vide voulue) → on renvoie aussi le planning tel quel (aucune
 *     garde antérieure à ajouter) — même effet, mais l'intention est explicite.
 */
export function attributionsAvecContexte(
  planning: PlanningPartiel,
  contexteAnterieur?: AttributionGarde[],
): PlanningPartiel {
  // Absent OU vide → aucune extension (référence inchangée = byte-identique).
  if (!contexteAnterieur || contexteAnterieur.length === 0) return planning
  // Lookback DEVANT les attributions courantes. Les dates du lookback sont
  // strictement antérieures au début de la période (filtre par date côté
  // loader) → aucune collision (date, type) avec le planning courant.
  return { attributions: [...contexteAnterieur, ...planning.attributions] }
}

/** Vérifie si un véto est en congé validé à cette date */
export function estEnConge(
  vetId: string,
  date: string,
  congesParVet: Record<string, Array<{ date_debut: string; date_fin: string }>>
): boolean {
  const conges = congesParVet[vetId] ?? []
  return conges.some(({ date_debut, date_fin }) => dateEntre(date, date_debut, date_fin))
}
