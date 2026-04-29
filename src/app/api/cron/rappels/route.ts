// ============================================================
// GUARDVETO — GET /api/cron/rappels
// ============================================================
// Cron Vercel exécuté chaque matin à 07h00.
// Envoie un email à l'admin (Anne-So) si une période à venir
// n'est pas encore publiée :
//   J-15 : premier rappel (si rappel_15j_at IS NULL)
//   J-7  : deuxième rappel urgent (si rappel_7j_at IS NULL)
//
// Anti-doublon : timestamps rappel_15j_at / rappel_7j_at dans periodes.
// Sécurité : vérifie Authorization: Bearer <CRON_SECRET>
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendRappelPublication } from '@/lib/notifications'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Variables Supabase manquantes.')
  return createServiceClient(url, key)
}

export async function GET(req: NextRequest) {
  // ── Vérification du secret cron ──────────────────────────
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 })
  }

  const supabase = getServiceClient()

  // Date aujourd'hui en UTC (comparaison avec date_debut)
  const today = new Date()
  today.setUTCHours(12, 0, 0, 0) // midi UTC pour éviter les décalages de fuseau

  // ── Récupérer les périodes à venir non publiées ──────────
  // Statuts concernés : brouillon (pas encore publié)
  // On récupère toutes les périodes futures (date_debut > today - 1 jour)
  const demain = new Date(today)
  demain.setUTCDate(demain.getUTCDate() - 1)
  const demainStr = demain.toISOString().split('T')[0]

  const { data: periodes, error } = await supabase
    .from('periodes')
    .select('id, saison, numero, date_debut, statut, rappel_15j_at, rappel_7j_at')
    .neq('statut', 'publie')
    .neq('statut', 'verrouille')
    .gt('date_debut', demainStr)
    .order('date_debut')

  if (error) {
    return NextResponse.json(
      { error: `Erreur récupération périodes : ${error.message}` },
      { status: 500 }
    )
  }

  if (!periodes || periodes.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'Aucune période à venir non publiée.',
      rappelsEnvoyes: [],
    })
  }

  const rappelsEnvoyes: Array<{
    periodeId: string
    type: 'J-15' | 'J-7'
    joursRestants: number
    sent: number
    errors: number
  }> = []

  for (const periode of periodes) {
    const dateDebut = new Date(periode.date_debut + 'T12:00:00Z')
    const diffMs = dateDebut.getTime() - today.getTime()
    const joursRestants = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

    // ── Rappel J-7 (priorité sur J-15 si les deux déclenchent) ──
    if (joursRestants <= 7 && !periode.rappel_7j_at) {
      const { sent, errors } = await sendRappelPublication(supabase, periode.id, joursRestants)

      // Marquer le rappel J-7 comme envoyé
      await supabase
        .from('periodes')
        .update({ rappel_7j_at: new Date().toISOString() })
        .eq('id', periode.id)

      rappelsEnvoyes.push({ periodeId: periode.id, type: 'J-7', joursRestants, sent, errors })
      continue // pas besoin d'envoyer aussi le J-15
    }

    // ── Rappel J-15 ──────────────────────────────────────────
    if (joursRestants <= 15 && !periode.rappel_15j_at) {
      const { sent, errors } = await sendRappelPublication(supabase, periode.id, joursRestants)

      // Marquer le rappel J-15 comme envoyé
      await supabase
        .from('periodes')
        .update({ rappel_15j_at: new Date().toISOString() })
        .eq('id', periode.id)

      rappelsEnvoyes.push({ periodeId: periode.id, type: 'J-15', joursRestants, sent, errors })
    }
  }

  return NextResponse.json({
    success: true,
    date: today.toISOString().split('T')[0],
    periodesVerifiees: periodes.length,
    rappelsEnvoyes,
  })
}
