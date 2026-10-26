// ============================================================
// GUARDVETO — B-173 : les appels Google de l'agenda personnel
// ============================================================
// Distinct de `google-calendar.ts`, dont le client est lié à UN agenda (celui
// du cabinet). Ici chaque membre a le sien, et on gère aussi des PARTAGES.
// Prouvé faisable le 26/10 sur le bac à sable (B-173a) : créer un agenda, le
// partager, y écrire, retirer le partage, le supprimer.
// ============================================================

import { google, type calendar_v3 } from 'googleapis'
import type { EvenementVoulu } from './planifier'

function client(): calendar_v3.Calendar | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim().replace(/\\n/g, '\n')
  if (!email || !key) return null
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/calendar'] })
  return google.calendar({ version: 'v3', auth })
}

export function googleConfigure(): boolean {
  return client() !== null
}

function exiger(): calendar_v3.Calendar {
  const c = client()
  if (!c) throw new Error('Google Agenda n’est pas configuré sur ce serveur.')
  return c
}

/** Le code HTTP d'une erreur googleapis, quelle que soit sa forme. */
export function codeErreur(e: unknown): number | null {
  const x = e as { code?: unknown; status?: unknown; response?: { status?: unknown } }
  const v = x?.code ?? x?.status ?? x?.response?.status
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

export function messageErreur(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function creerAgenda(nom: string): Promise<string> {
  const r = await exiger().calendars.insert({
    requestBody: {
      summary: nom,
      description: 'Votre planning GuardVeto, tenu à jour automatiquement. Une modification faite ici serait écrasée : passez par GuardVeto.',
      timeZone: 'Europe/Paris',
    },
  })
  if (!r.data.id) throw new Error('Google n’a pas rendu d’identifiant pour le nouvel agenda.')
  return r.data.id
}

/** Partage en lecture. `notifier` envoie l'e-mail « … a partagé un agenda avec vous ». */
export async function partager(calendarId: string, email: string, role = 'reader', notifier = true): Promise<void> {
  await exiger().acl.insert({
    calendarId,
    sendNotifications: notifier,
    requestBody: { role, scope: { type: 'user', value: email } },
  })
}

/** Le rôle d'une adresse sur un agenda, null si elle n'y a aucun partage nominatif. */
export async function roleDe(calendarId: string, email: string): Promise<string | null> {
  try {
    const r = await exiger().acl.get({ calendarId, ruleId: `user:${email}` })
    return r.data.role ?? null
  } catch (e) {
    if (codeErreur(e) === 404) return null
    throw e
  }
}

/** Retire un partage. Déjà absent = rien à faire, pas une erreur. */
export async function retirerPartage(calendarId: string, email: string): Promise<void> {
  try {
    await exiger().acl.delete({ calendarId, ruleId: `user:${email}` })
  } catch (e) {
    if (codeErreur(e) === 404 || codeErreur(e) === 410) return
    throw e
  }
}

function corps(v: EvenementVoulu): calendar_v3.Schema$Event {
  return {
    summary: v.titre,
    // Passer d'« en haut du jour » à « aux heures » exige d'EFFACER l'autre
    // forme : Google refuse un événement qui porte `date` ET `dateTime`.
    start: { dateTime: null, date: null, ...v.start },
    end: { dateTime: null, date: null, ...v.end },
    colorId: v.colorId ?? null,
  }
}

export async function creerEvenement(calendarId: string, v: EvenementVoulu): Promise<string> {
  const r = await exiger().events.insert({ calendarId, requestBody: corps(v) })
  if (!r.data.id) throw new Error('Google n’a pas rendu d’identifiant pour l’événement.')
  return r.data.id
}

export async function majEvenement(calendarId: string, eventId: string, v: EvenementVoulu): Promise<void> {
  await exiger().events.update({ calendarId, eventId, requestBody: corps(v) })
}

/** Supprime un événement. Déjà absent (effacé à la main) = c'est fait. */
export async function retirerEvenement(calendarId: string, eventId: string): Promise<void> {
  try {
    await exiger().events.delete({ calendarId, eventId })
  } catch (e) {
    if (codeErreur(e) === 404 || codeErreur(e) === 410) return
    throw e
  }
}

/** L'agenda existe-t-il encore (la personne a pu le supprimer côté Google) ? */
export async function agendaExiste(calendarId: string): Promise<boolean> {
  try {
    await exiger().calendars.get({ calendarId })
    return true
  } catch (e) {
    if (codeErreur(e) === 404 || codeErreur(e) === 410) return false
    throw e
  }
}

/** Supprime l'agenda entier (et donc ses partages). Déjà absent = c'est fait. */
export async function supprimerAgenda(calendarId: string): Promise<void> {
  try {
    await exiger().calendars.delete({ calendarId })
  } catch (e) {
    if (codeErreur(e) === 404 || codeErreur(e) === 410) return
    throw e
  }
}
