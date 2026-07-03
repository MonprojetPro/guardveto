// ============================================================
// GUARDVETO — API Route POST /api/publish
// ============================================================
// Change le statut d'une période de 'brouillon' → 'publie'.
//
// GATE DE PUBLICATION (audit 2026-07-03) : avant de publier, on re-valide le
// planning avec le validateur indépendant (violations dures + jours non
// couverts) et on compte les souhaits de congé encore en attente sur la
// période. S'il y a des réserves, on NE publie PAS : on les renvoie à l'UI
// qui demande une confirmation explicite (`confirmAvecReserves: true`).
//
// Accès : admin uniquement
// Corps : { periodeId: string, confirmAvecReserves?: boolean }
// Réponse : { success: true } | { requiresConfirmation: true, violations, souhaitsEnAttente } | { error: string }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncCalendrier } from '@/lib/sync-calendrier'
import { sendPlanningPublie } from '@/lib/notifications'
import { revaliderPlanningPublie } from '@/data/revaliderPlanning'
import type { ViolationRevalidation } from '@/components/planning/types-revalidation'

// Laisse le temps à la synchro agenda (par lots) + envoi des emails
export const maxDuration = 60

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
  let confirmAvecReserves = false
  try {
    const body = await req.json()
    periodeId = body?.periodeId
    confirmAvecReserves = body?.confirmAvecReserves === true
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
    .select('id, statut, date_debut, date_fin')
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

  // ── Gate de publication : re-validation + souhaits en attente ──
  // Le code de re-validation existait déjà (revaliderPlanningPublie) mais
  // n'était appelé qu'après coup, depuis /planning. Ici on l'appelle AVANT
  // de publier : violations dures / jours non couverts → confirmation exigée.
  if (!confirmAvecReserves) {
    let violations: ViolationRevalidation[] = []
    try {
      violations = await revaliderPlanningPublie([periodeId])
    } catch (e) {
      console.error('[publish] Re-validation impossible (gate best-effort):', e)
    }

    const { count: nbSouhaits } = await supabase
      .from('conges')
      .select('id', { count: 'exact', head: true })
      .eq('statut', 'souhait')
      .lte('date_debut', periode.date_fin)
      .gte('date_fin', periode.date_debut)
    const souhaitsEnAttente = nbSouhaits ?? 0

    if (violations.length > 0 || souhaitsEnAttente > 0) {
      return NextResponse.json({
        requiresConfirmation: true,
        violations,
        souhaitsEnAttente,
      })
    }
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

  // ── Synchronisation Google Agenda ───────────────────────
  // Exécutée en best-effort : si la synchro échoue, le planning
  // reste publié et l'admin reçoit les détails dans la réponse.
  let calendarSync: { synced: number; errors: string[]; skipped: boolean } | null = null
  try {
    calendarSync = await syncCalendrier(supabase, periodeId)
  } catch (syncErr) {
    const msg = syncErr instanceof Error ? syncErr.message : String(syncErr)
    calendarSync = { synced: 0, errors: [msg], skipped: false }
  }

  // ── Notifications email (best-effort) ──────────────────────
  // Envoyées après la synchro agenda — une erreur ne bloque pas la réponse.
  let emailNotif: { sent: number; errors: number } | null = null
  try {
    emailNotif = await sendPlanningPublie(supabase, periodeId)
  } catch (notifErr) {
    const msg = notifErr instanceof Error ? notifErr.message : String(notifErr)
    console.error('[publish] Erreur notifications email:', msg)
    emailNotif = { sent: 0, errors: 1 }
  }

  return NextResponse.json({ success: true, calendarSync, emailNotif })
}
