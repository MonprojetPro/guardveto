// ============================================================
// GUARDVETO — API Route POST /api/publish
// ============================================================
// Change le statut d'une période de 'brouillon' → 'publie'.
//
// Accès : admin uniquement
// Corps : { periodeId: string }
// Réponse : { success: true } | { error: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  // ── Authentification ────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Non authentifié. Veuillez vous connecter.' },
      { status: 401 }
    )
  }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return NextResponse.json(
      { error: 'Accès réservé aux administrateurs.' },
      { status: 403 }
    )
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
    return NextResponse.json(
      { error: 'Corps de requête non parsable (JSON attendu).' },
      { status: 400 }
    )
  }

  // ── Vérification de la période ──────────────────────────
  const { data: periode } = await supabase
    .from('periodes')
    .select('id, statut')
    .eq('id', periodeId)
    .single()

  if (!periode) {
    return NextResponse.json(
      { error: 'Période introuvable.' },
      { status: 404 }
    )
  }

  if (periode.statut !== 'brouillon') {
    return NextResponse.json(
      { error: `Impossible de publier : statut actuel "${periode.statut}". Seuls les brouillons peuvent être publiés.` },
      { status: 422 }
    )
  }

  // ── Vérification qu'il y a des gardes ───────────────────
  const { count } = await supabase
    .from('gardes')
    .select('id', { count: 'exact', head: true })
    .eq('periode_id', periodeId)

  if (!count || count === 0) {
    return NextResponse.json(
      { error: 'Aucune garde trouvée pour cette période. Générez d\'abord le planning avant de publier.' },
      { status: 422 }
    )
  }

  // ── Publication ─────────────────────────────────────────
  const { error } = await supabase
    .from('periodes')
    .update({
      statut: 'publie',
      publie_at: new Date().toISOString(),
    })
    .eq('id', periodeId)

  if (error) {
    return NextResponse.json(
      { error: `Erreur lors de la publication : ${error.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
