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

/**
 * ⚠️ 60 s, et ce n'est PAS du confort (B-079, 2026-08-27).
 *
 * Cette ligne manquait, seule parmi les routes longues du projet : la fonction
 * tombait donc sur le défaut Vercel de 10 s. Tant qu'un événement couvrait
 * toute une garde, une période en produisait une vingtaine et ça passait. Depuis
 * qu'il y en a un par personne et par jour, la même période en produit ~56, et
 * la bascule des anciens s'y ajoute : mesuré entre 10,3 s (latence Google de
 * 150 ms) et 19,2 s (500 ms).
 *
 * Ce que coûtait l'oubli : la fonction est TUÉE NET au dépassement, sans
 * remonter d'erreur exploitable. L'agenda de la cliente serait resté à moitié
 * converti — une partie en événements de bloc, l'autre par personne — et rien
 * à l'écran ne l'aurait dit. C'est `/api/publish` qui portait déjà cette ligne
 * et qui masquait le problème : la publication passait, la synchro manuelle
 * depuis l'écran des réglages aurait échoué.
 */
export const maxDuration = 60

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
