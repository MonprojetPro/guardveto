// ============================================================
// GUARDVETO — GET /api/cron/lock-gardes
// ============================================================
// Cron Vercel exécuté chaque nuit à 00h01.
// 1. Verrouille toutes les gardes dont la date < aujourd'hui.
// 2. Passe les périodes dont toutes les gardes sont verrouillées
//    au statut "verrouille".
// 3. Pour chaque période nouvellement verrouillée : calcule et
//    sauvegarde les bonus/malus (bonus_malus).
//
// Sécurité : vérifie l'en-tête Authorization: Bearer <CRON_SECRET>
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { queryCompteurs, queryTotalWE } from '@/hooks/useCompteurs'
import { calculerBilans } from '@/engine/bilan'

// ── Client service role (pas de cookies — cron non authentifié) ──
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Variables Supabase manquantes.')
  return createServiceClient(url, key)
}

// ── Handler ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // ── Vérification du secret cron ──────────────────────
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  const supabase = getServiceClient()
  const today = new Date().toISOString().split('T')[0] // yyyy-MM-dd

  // ── 1. Verrouiller les gardes passées ─────────────────
  const { data: gardesVerrouillees, error: lockError } = await supabase
    .from('gardes')
    .update({ verrouille: true })
    .lt('date', today)
    .eq('verrouille', false)
    .select('id, periode_id')

  if (lockError) {
    return NextResponse.json(
      { error: `Erreur verrouillage gardes : ${lockError.message}` },
      { status: 500 }
    )
  }

  const nbGardesVerrouillees = gardesVerrouillees?.length ?? 0

  // ── 2. Identifier les périodes affectées ──────────────
  const periodeIdsAffectees = [
    ...new Set((gardesVerrouillees ?? []).map((g) => g.periode_id as string)),
  ]

  const periodesNouveauxVerrous: string[] = []

  for (const periodeId of periodeIdsAffectees) {
    // Compter les gardes non-verrouillées restantes dans cette période
    const { count: nbNonVerrouillees } = await supabase
      .from('gardes')
      .select('*', { count: 'exact', head: true })
      .eq('periode_id', periodeId)
      .eq('verrouille', false)

    if (nbNonVerrouillees === 0) {
      // Toutes les gardes sont verrouillées → verrouiller la période
      const { error: periodeError } = await supabase
        .from('periodes')
        .update({ statut: 'verrouille' })
        .eq('id', periodeId)
        .neq('statut', 'verrouille') // idempotent

      if (!periodeError) {
        periodesNouveauxVerrous.push(periodeId)
      }
    }
  }

  // ── 3. Calculer les bonus/malus des périodes verrouillées ──
  const bilanResults: Array<{ periodeId: string; nbVets: number }> = []

  for (const periodeId of periodesNouveauxVerrous) {
    const [compteurs, totalWE] = await Promise.all([
      queryCompteurs(supabase, periodeId),
      queryTotalWE(supabase, periodeId),
    ])

    if (compteurs.length === 0) continue

    // Cron service_role (multi-cabinet, sans JWT) : le cabinet_id est
    // dérivé de la période traitée, jamais d'un input client.
    const { data: periodeRow } = await supabase
      .from('periodes')
      .select('cabinet_id')
      .eq('id', periodeId)
      .single()

    const cabinetId = periodeRow?.cabinet_id as string | null
    if (!cabinetId) {
      console.error(`[lock-gardes] periode ${periodeId} sans cabinet_id — bilan ignoré`)
      continue
    }

    const bilans = calculerBilans(compteurs, totalWE)

    const rows = bilans.map((b) => ({
      cabinet_id: cabinetId,
      veterinaire_id: b.veterinaire_id,
      periode_id: periodeId,
      ecart_we: b.ecart_we,
      ecart_semaine: b.ecart_semaine,
      ecart_feries: b.ecart_feries,
      ecart_grands_we: b.ecart_grands_we,
    }))

    await supabase
      .from('bonus_malus')
      .upsert(rows, { onConflict: 'cabinet_id,veterinaire_id,periode_id' })

    bilanResults.push({ periodeId, nbVets: bilans.length })
  }

  return NextResponse.json({
    success: true,
    date: today,
    gardesVerrouillees: nbGardesVerrouillees,
    periodesVerrouillees: periodesNouveauxVerrous.length,
    bilanCalcules: bilanResults,
  })
}
