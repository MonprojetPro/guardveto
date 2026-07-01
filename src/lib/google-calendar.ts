// ============================================================
// GUARDVETO — Wrapper Google Calendar API
// ============================================================
// Utilise un Service Account Google pour créer, mettre à jour
// et supprimer des événements dans le Google Agenda du cabinet.
//
// Variables d'environnement requises :
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  — email du Service Account
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — clé privée (avec \n)
//   GOOGLE_CALENDAR_ID            — ID du calendrier cible
// ============================================================

import { google } from 'googleapis'
import { addDays } from 'date-fns'
import { horairesResolus, type StructureCreneauxResolue } from '@/engine/structure-creneaux'

// ── Types internes ───────────────────────────────────────────

export interface GardeEventData {
  date: string              // ISO yyyy-MM-dd
  type: 'semaine' | 'weekend' | 'ferie'
  prenomPremier: string
  prenomSecond: string | null
}

// ── Initialisation du client Google ─────────────────────────

function getCalendarClient() {
  // .trim() : protège contre les retours à la ligne / espaces parasites
  // ajoutés en collant les valeurs dans Vercel (sinon : "account not found").
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim()

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

/** Pose l'heure 'HH:MM' sur une copie de la date (heure locale Europe/Paris). */
function withTime(d: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const r = new Date(d)
  r.setHours(h, m, 0, 0)
  return r
}

function getEventTimes(
  date: string,
  type: 'semaine' | 'weekend' | 'ferie',
  structure?: StructureCreneauxResolue,
) {
  const baseDate = new Date(date + 'T00:00:00')

  if (type === 'weekend') {
    // L'événement agenda regroupe le vendredi soir + le week-end en UN seul
    // bloc (lisibilité côté cabinet). Début = prise du vendredi soir (veille
    // du samedi), fin = fin du week-end. `date` est le samedi.
    const ven = horairesResolus(structure, 'vendredi_soir')
    const we = horairesResolus(structure, 'weekend')
    const start = withTime(addDays(baseDate, -1), ven.heureDebut)
    const end = withTime(addDays(baseDate, we.offsetJoursFin), we.heureFin)
    return { start: start.toISOString(), end: end.toISOString() }
  }

  // semaine → semaine_soir ; ferie → ferie (journée entière, comme en base).
  const h = horairesResolus(structure, type === 'ferie' ? 'ferie' : 'semaine_soir')
  const start = withTime(baseDate, h.heureDebut)
  const end = withTime(addDays(baseDate, h.offsetJoursFin), h.heureFin)
  return { start: start.toISOString(), end: end.toISOString() }
}

// ── Construction du titre et de la description ───────────────

function buildEventTitle(data: GardeEventData): string {
  if (data.prenomSecond) {
    return `Garde — ${data.prenomPremier} (1er) + ${data.prenomSecond} (2nd)`
  }
  return `Garde — ${data.prenomPremier} (1er)`
}

function buildEventDescription(data: GardeEventData): string {
  const typeLabel = data.type === 'semaine'
    ? 'Garde de semaine (soir)'
    : data.type === 'weekend'
    ? 'Garde de week-end'
    : 'Garde de jour férié'

  // Week-end : R8 — le vendredi soir a les deux mêmes vétos avec les rôles
  // inversés par rapport au samedi/dimanche. On le détaille dans la description.
  if (data.type === 'weekend' && data.prenomSecond) {
    return [
      typeLabel,
      '',
      `Vendredi soir : ${data.prenomSecond} (1er) + ${data.prenomPremier} (2nd)`,
      `Samedi & dimanche : ${data.prenomPremier} (1er) + ${data.prenomSecond} (2nd)`,
    ].join('\n')
  }

  const lines = [
    typeLabel,
    `1er de garde : ${data.prenomPremier}`,
  ]
  if (data.prenomSecond) {
    lines.push(`2nd de garde : ${data.prenomSecond}`)
  }
  return lines.join('\n')
}

// ── API publique ─────────────────────────────────────────────

/**
 * Crée un événement Google Agenda pour une garde.
 * Retourne l'ID de l'événement créé, ou null si Google n'est pas configuré.
 */
export async function createGardeEvent(
  data: GardeEventData,
  structure?: StructureCreneauxResolue,
): Promise<string | null> {
  const ctx = getCalendarClient()
  if (!ctx) return null

  const { start, end } = getEventTimes(data.date, data.type, structure)

  const res = await ctx.client.events.insert({
    calendarId: ctx.calendarId,
    requestBody: {
      summary: buildEventTitle(data),
      description: buildEventDescription(data),
      start: { dateTime: start, timeZone: 'Europe/Paris' },
      end:   { dateTime: end,   timeZone: 'Europe/Paris' },
    },
  })

  return res.data.id ?? null
}

/**
 * Met à jour un événement Google Agenda existant.
 * No-op si Google n'est pas configuré.
 */
export async function updateGardeEvent(
  eventId: string,
  data: GardeEventData,
  structure?: StructureCreneauxResolue,
): Promise<void> {
  const ctx = getCalendarClient()
  if (!ctx) return

  const { start, end } = getEventTimes(data.date, data.type, structure)

  await ctx.client.events.update({
    calendarId: ctx.calendarId,
    eventId,
    requestBody: {
      summary: buildEventTitle(data),
      description: buildEventDescription(data),
      start: { dateTime: start, timeZone: 'Europe/Paris' },
      end:   { dateTime: end,   timeZone: 'Europe/Paris' },
    },
  })
}

/**
 * Supprime un événement Google Agenda.
 * No-op si Google n'est pas configuré.
 */
export async function deleteGardeEvent(eventId: string): Promise<void> {
  const ctx = getCalendarClient()
  if (!ctx) return

  await ctx.client.events.delete({
    calendarId: ctx.calendarId,
    eventId,
  })
}

/**
 * Vérifie si Google Calendar est configuré (variables d'env présentes).
 */
export function isGoogleCalendarConfigured(): boolean {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    process.env.GOOGLE_CALENDAR_ID
  )
}
