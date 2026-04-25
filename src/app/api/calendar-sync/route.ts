// ============================================================
// GUARDVETO — API Route POST /api/calendar-sync
// ============================================================
// Déclenche la synchronisation des gardes d'une période vers
// Google Agenda. Peut être appelé manuellement par l'admin
// ou automatiquement depuis /api/publish.
//
// Accès : admin uniquement
// Corps : { periodeId: string }
// Réponse : { synced: number, errors: string[], skipped: boolean }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncCalendrier } from '@/lib/sync-calendrier'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  // ── Authentification ────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 })
  }

  // ── Validation du corps ─────────────────────────────────
  let periodeId: string
  try {
    const body = await req.json()
    periodeId = body?.periodeId
    if (!periodeId || typeof periodeId !== 'string') {
      return NextResponse.json(
        { error: 'Corps invalide. Attendu : { periodeId: string }' },
        { status: 400 }
      )
    }
  } catch {
    return NextResponse.json({ error: 'Corps de requête non parsable.' }, { status: 400 })
  }

  // ── Synchronisation ─────────────────────────────────────
  const result = await syncCalendrier(supabase, periodeId)

  return NextResponse.json(result)
}
