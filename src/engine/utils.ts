// ============================================================
// GUARDVETO — Utilitaires de dates pour le moteur
// ============================================================

import type { JourSemaine, Saison } from './types'

// ── Helpers de base ──────────────────────────────────────

/** Numéro ISO de la semaine (1-53) */
export function numeroSemaine(date: string): number {
  const d = new Date(date + 'T12:00:00Z')
  const thursday = new Date(d)
  thursday.setUTCDate(d.getUTCDate() + (4 - (d.getUTCDay() || 7)))
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/** Semaine impaire (numéro ISO % 2 !== 0) */
export function estSemaineImpaire(date: string): boolean {
  return numeroSemaine(date) % 2 !== 0
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

export function estJourFerie(date: string): boolean {
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

export function estEnVacancesScolaires(date: string): boolean {
  return VACANCES_SCOLAIRES.some(({ debut, fin }) => dateEntre(date, debut, fin))
}

// ── Helpers planning ────────────────────────────────────

/** La date est-elle un week-end (sam ou dim) ? */
export function estWeekend(date: string): boolean {
  const j = jourIndex(date)
  return j === 0 || j === 6
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
