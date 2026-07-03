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
import { chargerStructureProfilPeriode } from '@/data/chargerStructureCabinet'
import type { StructureCreneauxResolue } from '@/engine/structure-creneaux'

// ── Types ────────────────────────────────────────────────────

interface GardeAvecVetos {
  id: string
  date: string
  type: 'semaine' | 'weekend' | 'ferie'
  google_event_id: string | null
  periode_id?: string
  premier: { prenom: string } | null
  second:  { prenom: string } | null
}

/**
 * Structure des créneaux (horaires) du PROFIL de la période (P5 slice 4b).
 * Best-effort : période / cabinet introuvable → horaires par défaut. Sert à ce
 * que l'agenda affiche les MÊMES horaires que ceux écrits en base — désormais
 * portés par le profil (creneau_modele), non plus par le cabinet.
 */
async function structurePourPeriode(
  supabase: SupabaseClient,
  periodeId: string,
): Promise<StructureCreneauxResolue | undefined> {
  return chargerStructureProfilPeriode(supabase, periodeId)
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
// ── Helpers anti rate-limit Google ───────────────────────────
// Google Calendar bride les créations/suppressions en rafale. On traite
// par petits lots espacés, avec reprise automatique en cas d'échec.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function avecReprise<T>(fn: () => Promise<T>, essais = 4): Promise<T> {
  let derniere: unknown
  for (let i = 0; i < essais; i++) {
    try {
      return await fn()
    } catch (e) {
      derniere = e
      if (i < essais - 1) await sleep(500 * (i + 1))
    }
  }
  throw derniere
}

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

  // Structure horaire du cabinet (A1) — passée à l'agenda pour rester aligné
  // avec les horaires écrits en base. Défaut si le cabinet n'a rien personnalisé.
  const structure = await structurePourPeriode(supabase, periodeId)

  // Petits lots espacés + reprise auto : évite le rate-limit Google
  // (qui jette une partie des créations quand on en lance trop d'un coup),
  // tout en restant largement sous le maxDuration de la fonction.
  const BATCH = 3
  const PAUSE_MS = 250
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
          await avecReprise(async () => {
            if (garde.google_event_id) {
              await updateGardeEvent(garde.google_event_id as string, data, structure)
            } else {
              const eventId = await createGardeEvent(data, structure)
              if (eventId) {
                await supabase
                  .from('gardes')
                  .update({ google_event_id: eventId })
                  .eq('id', garde.id)
              }
            }
          })
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
    if (i + BATCH < toutes.length) await sleep(PAUSE_MS)
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
      periode_id,
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

  // Structure horaire du cabinet (A1) — aligne l'agenda sur la base.
  const structure = g.periode_id
    ? await structurePourPeriode(supabase, g.periode_id)
    : undefined

  if (g.google_event_id) {
    await updateGardeEvent(g.google_event_id, data, structure)
  } else {
    const eventId = await createGardeEvent(data, structure)
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

  await supprimerEvenementsParIds(
    gardes
      .map((garde) => garde.google_event_id as string | null)
      .filter((id): id is string => Boolean(id))
  )
}

/**
 * Supprime une liste d'événements Google Agenda par leurs ids.
 *
 * Variante « ids pré-capturés » (audit 2026-07-03) : les `google_event_id`
 * vivent sur les lignes `gardes` — lors d'une régénération, il faut donc les
 * LIRE avant le DELETE des gardes, mais ne purger l'agenda qu'APRÈS le succès
 * de la réécriture en base (sinon un échec à mi-course laissait la base vide
 * ET l'agenda déjà purgé).
 */
export async function supprimerEvenementsParIds(eventIds: string[]): Promise<void> {
  if (!isGoogleCalendarConfigured()) return
  if (eventIds.length === 0) return

  // Suppression par petits lots espacés + reprise (anti rate-limit Google)
  const BATCH = 3
  const PAUSE_MS = 250

  for (let i = 0; i < eventIds.length; i += BATCH) {
    const lot = eventIds.slice(i, i + BATCH)
    await Promise.all(
      lot.map((eventId) =>
        avecReprise(() => deleteGardeEvent(eventId)).catch(() => {
          // On continue même si un événement n'existe plus côté Google
        })
      )
    )
    if (i + BATCH < eventIds.length) await sleep(PAUSE_MS)
  }
}
