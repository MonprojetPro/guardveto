// ============================================================
// GUARDVETO — Service de synchronisation Google Agenda
// ============================================================
// Appelé après publication d'une période ou modification d'une garde.
// Crée / met à jour les événements Google Agenda pour chaque garde.
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js'
import {
  createGardeEvent,
  updateGardeEvent,
  deleteGardeEvent,
  isGoogleCalendarConfigured,
  GardeEventData,
} from './google-calendar'

// ── Types ────────────────────────────────────────────────────

interface GardeAvecVetos {
  id: string
  date: string
  type: 'semaine' | 'weekend' | 'ferie'
  google_event_id: string | null
  premier: { prenom: string } | null
  second:  { prenom: string } | null
}

export interface SyncResult {
  synced: number
  errors: string[]
  skipped: boolean  // true si Google non configuré
}

// ── Synchronisation d'une période complète ───────────────────

/**
 * Synchronise toutes les gardes d'une période vers Google Agenda.
 * Crée les événements manquants, met à jour les existants.
 * Retourne un bilan (nombre synchronisés + erreurs éventuelles).
 */
export async function syncCalendrier(
  supabase: SupabaseClient,
  periodeId: string
): Promise<SyncResult> {
  if (!isGoogleCalendarConfigured()) {
    return { synced: 0, errors: [], skipped: true }
  }

  // ── Récupération des gardes avec les prénoms des vétos ───
  const { data: gardes, error } = await supabase
    .from('gardes')
    .select(`
      id,
      date,
      type,
      google_event_id,
      premier:veterinaires!gardes_premier_id_fkey ( prenom ),
      second:veterinaires!gardes_second_id_fkey  ( prenom )
    `)
    .eq('periode_id', periodeId)
    .order('date')

  if (error || !gardes) {
    return { synced: 0, errors: [`Impossible de récupérer les gardes : ${error?.message}`], skipped: false }
  }

  const errors: string[] = []
  let synced = 0

  // Traitement par lots EN PARALLÈLE : ~60 gardes en séquentiel dépassent
  // le timeout d'une fonction serverless Vercel. Par lots de 8, on reste
  // bien en dessous (et sous les quotas Google Calendar).
  const BATCH = 8
  const toutes = gardes as unknown as GardeAvecVetos[]

  for (let i = 0; i < toutes.length; i += BATCH) {
    const lot = toutes.slice(i, i + BATCH)
    const resultats = await Promise.all(
      lot.map(async (garde) => {
        const data: GardeEventData = {
          date:          garde.date,
          type:          garde.type,
          prenomPremier: garde.premier?.prenom ?? 'Inconnu',
          prenomSecond:  garde.second?.prenom  ?? null,
        }
        try {
          if (garde.google_event_id) {
            await updateGardeEvent(garde.google_event_id, data)
          } else {
            const eventId = await createGardeEvent(data)
            if (eventId) {
              await supabase
                .from('gardes')
                .update({ google_event_id: eventId })
                .eq('id', garde.id)
            }
          }
          return null
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return `Garde ${garde.date} : ${msg}`
        }
      })
    )
    for (const r of resultats) {
      if (r === null) synced++
      else errors.push(r)
    }
  }

  return { synced, errors, skipped: false }
}

// ── Mise à jour d'une garde individuelle ─────────────────────

/**
 * Met à jour l'événement Google Agenda d'une garde modifiée.
 * Crée l'événement s'il n'existe pas encore.
 * No-op si Google n'est pas configuré.
 */
export async function syncGardeIndividuelle(
  supabase: SupabaseClient,
  gardeId: string
): Promise<void> {
  if (!isGoogleCalendarConfigured()) return

  const { data: garde } = await supabase
    .from('gardes')
    .select(`
      id,
      date,
      type,
      google_event_id,
      premier:veterinaires!gardes_premier_id_fkey ( prenom ),
      second:veterinaires!gardes_second_id_fkey  ( prenom )
    `)
    .eq('id', gardeId)
    .single()

  if (!garde) return

  const g = garde as unknown as GardeAvecVetos
  const data: GardeEventData = {
    date:          g.date,
    type:          g.type,
    prenomPremier: g.premier?.prenom ?? 'Inconnu',
    prenomSecond:  g.second?.prenom  ?? null,
  }

  if (g.google_event_id) {
    await updateGardeEvent(g.google_event_id, data)
  } else {
    const eventId = await createGardeEvent(data)
    if (eventId) {
      await supabase
        .from('gardes')
        .update({ google_event_id: eventId })
        .eq('id', gardeId)
    }
  }
}

// ── Suppression des événements d'une période ─────────────────

/**
 * Supprime tous les événements Google Agenda d'une période.
 * Appelé avant une re-génération pour éviter les doublons.
 */
export async function supprimerEvenementsCalendrier(
  supabase: SupabaseClient,
  periodeId: string
): Promise<void> {
  if (!isGoogleCalendarConfigured()) return

  const { data: gardes } = await supabase
    .from('gardes')
    .select('id, google_event_id')
    .eq('periode_id', periodeId)
    .not('google_event_id', 'is', null)

  if (!gardes) return

  // Suppression EN PARALLÈLE (évite le timeout sur ~60 suppressions)
  await Promise.all(
    gardes
      .filter((garde) => garde.google_event_id)
      .map((garde) =>
        deleteGardeEvent(garde.google_event_id as string).catch(() => {
          // On continue même si un événement n'existe plus côté Google
        })
      )
  )
}
