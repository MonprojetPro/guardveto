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
import { creerNotification, contenuRappelCreationPeriode } from '@/lib/notifications-inapp'

// Alerte « période suivante manquante » quand la couverture restante passe
// sous ce seuil (laisse le temps de créer + générer + publier).
const SEUIL_COUVERTURE_JOURS = 21
// Anti-spam : au plus une alerte par admin par semaine.
const ANTI_SPAM_JOURS = 7

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

  // ⚠️ PAS de retour anticipé si aucune période à venir : c'est justement le
  // cas le plus grave pour la phase 2 (« plus aucune période » → alerte).
  const periodesAVenir = periodes ?? []

  const rappelsEnvoyes: Array<{
    periodeId: string
    type: 'J-15' | 'J-7'
    joursRestants: number
    sent: number
    errors: number
  }> = []

  for (const periode of periodesAVenir) {
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

  // ── Phase 2 : la période SUIVANTE n'existe pas (audit 2026-07-03, n°11) ──
  // Le rappel de publication ne voit que les périodes EXISTANTES : si l'admin
  // oublie de CRÉER la période suivante, plus rien n'alerte jusqu'au trou de
  // gardes. Ici : pour chaque cabinet, si la dernière période se termine dans
  // ≤ SEUIL_COUVERTURE_JOURS (ou est déjà finie) et qu'aucune ne la suit →
  // notif in-app aux admins du cabinet (anti-spam hebdomadaire).
  const alertesPeriodeManquante: Array<{ cabinetId: string; dateFin: string }> = []
  {
    const todayStr = today.toISOString().split('T')[0]
    const seuil = new Date(today)
    seuil.setUTCDate(seuil.getUTCDate() + SEUIL_COUVERTURE_JOURS)
    const seuilStr = seuil.toISOString().split('T')[0]
    const depuis = new Date(today.getTime() - ANTI_SPAM_JOURS * 24 * 60 * 60 * 1000).toISOString()

    const { data: cabinets } = await supabase.from('cabinets').select('id')
    for (const cabinet of (cabinets ?? []) as { id: string }[]) {
      const { data: derniere } = await supabase
        .from('periodes')
        .select('id, date_fin')
        .eq('cabinet_id', cabinet.id)
        .order('date_fin', { ascending: false })
        .limit(1)
        .maybeSingle()

      // Cabinet sans aucune période (onboarding en cours) : on ne spamme pas.
      if (!derniere) continue
      const dateFin = (derniere as { date_fin: string }).date_fin
      if (dateFin > seuilStr) continue // encore assez de couverture

      const dejaFinie = dateFin < todayStr
      const contenu = contenuRappelCreationPeriode(dateFin, dejaFinie)

      const { data: admins } = await supabase
        .from('veterinaires')
        .select('id')
        .eq('cabinet_id', cabinet.id)
        .eq('role_app', 'admin')
        .eq('actif', true)

      let notifie = false
      for (const admin of (admins ?? []) as { id: string }[]) {
        // Anti-spam : au plus une alerte par admin par semaine.
        const { data: doublon } = await supabase
          .from('notifications')
          .select('id')
          .eq('veterinaire_id', admin.id)
          .eq('type', 'rappel_creation_periode')
          .gte('created_at', depuis)
          .limit(1)
          .maybeSingle()
        if (doublon) continue

        await creerNotification(supabase, {
          veterinaireId: admin.id,
          type: 'rappel_creation_periode',
          titre: contenu.titre,
          message: contenu.message,
          lien: contenu.lien,
          cabinetId: cabinet.id,
        })
        notifie = true
      }
      if (notifie) alertesPeriodeManquante.push({ cabinetId: cabinet.id, dateFin })
    }
  }

  return NextResponse.json({
    success: true,
    date: today.toISOString().split('T')[0],
    periodesVerifiees: periodesAVenir.length,
    rappelsEnvoyes,
    alertesPeriodeManquante,
  })
}
