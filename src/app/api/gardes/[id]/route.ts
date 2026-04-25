// ============================================================
// GUARDVETO — PATCH /api/gardes/[id]
// ============================================================
// Modification manuelle d'une garde (admin uniquement).
// Marque la garde comme modifie_manuellement=true.
// Si force=true : déverrouille la garde, logue dans audit_log
//                et recalcule les bonus/malus de la période.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { queryCompteurs, queryTotalWE } from '@/hooks/useCompteurs'
import { calculerBilans } from '@/engine/bilan'
import { syncGardeIndividuelle } from '@/lib/sync-calendrier'

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
    .select('id, role_app')
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
    .select('id, verrouille, periode_id, premier_id, second_id, modifie_manuellement')
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

  // ── Audit log (correction d'une garde verrouillée) ──────
  if (force) {
    await supabase.from('audit_log').insert({
      table_name: 'gardes',
      record_id: gardeId,
      action: 'update',
      old_data: {
        premier_id: garde.premier_id,
        second_id: garde.second_id,
        verrouille: true,
        modifie_manuellement: garde.modifie_manuellement,
      },
      new_data: {
        premier_id,
        second_id,
        verrouille: false,
        modifie_manuellement: true,
      },
      user_id: vet.id,
    })

    // ── Recalcul des bonus/malus de la période ───────────
    const [compteurs, totalWE] = await Promise.all([
      queryCompteurs(supabase, garde.periode_id),
      queryTotalWE(supabase, garde.periode_id),
    ])

    if (compteurs.length > 0) {
      const bilans = calculerBilans(compteurs, totalWE)
      const rows = bilans.map((b) => ({
        veterinaire_id: b.veterinaire_id,
        periode_id: garde.periode_id,
        ecart_we: b.ecart_we,
        ecart_semaine: b.ecart_semaine,
        ecart_feries: b.ecart_feries,
        ecart_grands_we: b.ecart_grands_we,
      }))
      await supabase
        .from('bonus_malus')
        .upsert(rows, { onConflict: 'veterinaire_id,periode_id' })
    }
  }

  // ── Synchronisation Google Agenda (best-effort) ─────────
  // Ne bloque pas la réponse en cas d'erreur Google
  syncGardeIndividuelle(supabase, gardeId).catch(() => {
    // Échec silencieux — la modification garde est enregistrée
  })

  return NextResponse.json({ success: true })
}
