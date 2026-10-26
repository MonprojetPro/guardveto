// ============================================================
// GUARDVETO — GET /api/cron/agendas-perso (B-173)
// ============================================================
// Chaque nuit, rapproche les agendas personnels de tous les cabinets où la
// fonction est ouverte. Filet de sécurité : les synchros normales partent
// après chaque changement, mais l'une d'elles peut être coupée (délai serveur,
// quota Google). Celle-ci reprend là où l'autre s'est arrêtée — chaque
// événement écrit est mémorisé aussitôt, rien n'est doublé.
//
// Sécurité : Authorization: Bearer <CRON_SECRET>, comme les autres tâches.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { clientService, rapprocherCabinet } from '@/lib/agenda-perso/rapprocher'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  const admin = clientService()
  const { data, error } = await admin.from('cabinets').select('id').eq('agenda_perso_ouvert', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const bilan: { cabinet: string; ok: boolean; erreur?: string }[] = []
  for (const c of (data as { id: string }[] | null) ?? []) {
    try {
      await rapprocherCabinet(admin, c.id)
      bilan.push({ cabinet: c.id, ok: true })
    } catch (e) {
      bilan.push({ cabinet: c.id, ok: false, erreur: e instanceof Error ? e.message : String(e) })
    }
  }
  return NextResponse.json({ success: true, bilan })
}
