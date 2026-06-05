// ============================================================
// DIAGNOSTIC TEMPORAIRE (admin uniquement) — à supprimer après usage.
// GET /api/admin/diag-gcal : teste la connexion Google Agenda côté serveur
// et renvoie l'erreur exacte. Réservé à un admin authentifié.
// ============================================================
import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  // ── Auth + rôle admin ───────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 })
  }

  // ── Diagnostic Google Calendar ──────────────────────────
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
    looksPem: rawKey.startsWith('-----BEGIN') && rawKey.trimEnd().endsWith('-----'),
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

  const keySha256 = crypto.createHash('sha256').update(rawKey).digest('hex').slice(0, 16)

  return NextResponse.json({
    marker: 'diag-v4',
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? null,
    keyLen: rawKey.length,
    keySha256,
    present,
    keyShape,
    live,
  })
}
