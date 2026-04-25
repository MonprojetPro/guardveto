// ============================================================
// GUARDVETO — PATCH /api/gardes/[id]
// ============================================================
// Modification manuelle d'une garde (admin uniquement).
// Marque la garde comme modifie_manuellement=true.
// Si force=true : déverrouille la garde (verrouille=false).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: gardeId } = await params
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

  // ── Validation du corps ─────────────────────────────────
  let premier_id: string | null
  let second_id: string | null
  let force: boolean

  try {
    const body = await req.json()
    premier_id = body?.premier_id ?? null
    second_id = body?.second_id ?? null
    force = body?.force === true
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 })
  }

  // ── Vérification de la garde ────────────────────────────
  const { data: garde } = await supabase
    .from('gardes')
    .select('id, verrouille, periode_id')
    .eq('id', gardeId)
    .single()

  if (!garde) return NextResponse.json({ error: 'Garde introuvable.' }, { status: 404 })

  if (garde.verrouille && !force) {
    return NextResponse.json(
      { error: 'Cette garde est verrouillée. Utilisez "Corriger" pour la modifier.' },
      { status: 422 }
    )
  }

  // ── Mise à jour ──────────────────────────────────────────
  const updatePayload: Record<string, unknown> = {
    premier_id,
    second_id,
    modifie_manuellement: true,
    updated_at: new Date().toISOString(),
  }

  if (force) {
    updatePayload.verrouille = false
  }

  const { error } = await supabase
    .from('gardes')
    .update(updatePayload)
    .eq('id', gardeId)

  if (error) {
    return NextResponse.json(
      { error: `Erreur lors de la mise à jour : ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
