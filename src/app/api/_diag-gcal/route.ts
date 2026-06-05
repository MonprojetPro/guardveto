// ============================================================
// DIAGNOSTIC TEMPORAIRE — à supprimer après usage.
// GET /api/_diag-gcal : vérifie pourquoi la synchro Google Agenda
// échoue côté Vercel. N'expose AUCUN secret (juste forme + erreur).
// ============================================================
import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { isGoogleCalendarConfigured } from '@/lib/google-calendar'

export async function GET() {
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? ''

  const present = {
    email: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    calendarId: !!process.env.GOOGLE_CALENDAR_ID,
  }

  const keyShape = {
    length: rawKey.length,
    hasLiteralBackslashN: rawKey.includes('\\n'),
    hasRealNewline: rawKey.includes('\n'),
    startsWithBegin: rawKey.startsWith('-----BEGIN'),
    endsWithDashes: rawKey.trimEnd().endsWith('-----'),
  }

  let live: { ok: boolean; calendar?: string | null; error?: string; code?: string | number }
  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: rawKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/calendar'],
    })
    const cal = google.calendar({ version: 'v3', auth })
    const meta = await cal.calendars.get({ calendarId: process.env.GOOGLE_CALENDAR_ID ?? '' })
    live = { ok: true, calendar: meta.data.summary }
  } catch (e) {
    const err = e as { message?: string; code?: string | number }
    live = { ok: false, error: err?.message ?? String(e), code: err?.code }
  }

  return NextResponse.json({
    configured: isGoogleCalendarConfigured(),
    present,
    keyShape,
    live,
  })
}
