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
import { chargerRelationsAffichagePeriode } from '@/data/chargerRelationsAffichage'

/**
 * Prénoms des places 3 et 4, dans l'ordre. Les colonnes `premier_id` et
 * `second_id` n'en portent que deux : les suivantes vivent dans le miroir
 * `garde_placements`. Sans elles, un vétérinaire de garde ne verrait jamais
 * la garde arriver dans son agenda.
 */
function prenomsPlacesSup(garde: {
  garde_placements?: { place_index: number; veterinaires: { prenom: string } | { prenom: string }[] | null }[] | null
}): string[] {
  return (garde.garde_placements ?? [])
    .filter((p) => p.place_index >= 2)
    .sort((a, b) => a.place_index - b.place_index)
    .map((p) => {
      const v = Array.isArray(p.veterinaires) ? p.veterinaires[0] : p.veterinaires
      return v?.prenom ?? ''
    })
    .filter(Boolean)
}

// ── Résolution du calendarId PAR CABINET (#10b) ──────────────
// Le calendarId Google est désormais porté par le cabinet
// (cabinets.google_calendar_id). On le résout ici depuis un cabinet_id ; la
// couche google-calendar retombe sur l'env GOOGLE_CALENDAR_ID si le résultat
// est vide (cabinet pilote = colonne nulle → comportement inchangé).

/** calendarId du cabinet, ou null si non renseigné (→ fallback env en aval). */
async function calendarIdDuCabinet(
  supabase: SupabaseClient,
  cabinetId: string | null | undefined,
): Promise<string | null> {
  if (!cabinetId) return null
  const { data } = await supabase
    .from('cabinets')
    .select('google_calendar_id')
    .eq('id', cabinetId)
    .single()
  const val = (data as { google_calendar_id?: string | null } | null)?.google_calendar_id
  return (val ?? '').trim() || null
}

/** cabinet_id d'une période (pour scoper l'agenda). */
async function cabinetIdDePeriode(
  supabase: SupabaseClient,
  periodeId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('periodes')
    .select('cabinet_id')
    .eq('id', periodeId)
    .single()
  return (data as { cabinet_id?: string | null } | null)?.cabinet_id ?? null
}

// ── Types ────────────────────────────────────────────────────

interface GardeAvecVetos {
  id: string
  date: string
  /** Type V1 ('semaine'/'weekend'/'ferie') ou code sur-mesure (P3b). */
  type: string
  google_event_id: string | null
  periode_id?: string
  cabinet_id?: string | null
  premier: { prenom: string } | null
  second:  { prenom: string } | null
  /** Miroir des places 3 et 4 — absentes des colonnes de `gardes`. */
  garde_placements?: {
    place_index: number
    veterinaires: { prenom: string } | { prenom: string }[] | null
  }[] | null
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
  skipped: boolean  // true si Google non configuré, ou planning non publié
  /**
   * Pourquoi rien n'a été envoyé. Sans elle, l'écran affichait « 0 garde
   * synchronisée » sans dire si c'était une panne, une absence de réglage ou
   * un refus volontaire — trois situations qui n'appellent pas du tout la
   * même réaction.
   */
  raison?: string
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
  // ⚠️ UN BROUILLON NE SORT PAS DU LOGICIEL.
  //
  // L'agenda du cabinet est un canal de DIFFUSION : ce qui s'y écrit est lu
  // par toute l'équipe, et par des gens qui n'ouvriront jamais GuardVeto. Rien
  // n'empêchait jusqu'ici d'y déverser un planning non publié — et c'est
  // exactement ce qui s'est produit chez Val d'Allier : 38 événements de
  // brouillon dans l'agenda du client, pour zéro planning publié. Chaque
  // retouche manuelle en ajoutait un.
  //
  // Le critère est `publie_at`, pas le statut : une période peut être
  // « verrouillée » sans avoir jamais été diffusée (c'est le cas d'un
  // historique amorcé en base), et son passé n'a rien à faire dans l'agenda.
  const { data: per } = await supabase
    .from('periodes')
    .select('publie_at')
    .eq('id', periodeId)
    .maybeSingle()

  if (!(per as { publie_at: string | null } | null)?.publie_at) {
    return {
      synced: 0,
      errors: [],
      skipped: true,
      raison: "Ce planning n'a pas encore été publié : rien n'est envoyé vers l'agenda.",
    }
  }

  // calendarId scopé au cabinet de la période (fallback env en aval).
  const cabinetId = await cabinetIdDePeriode(supabase, periodeId)
  const calendarId = await calendarIdDuCabinet(supabase, cabinetId)

  if (!isGoogleCalendarConfigured(calendarId)) {
    return { synced: 0, errors: [], skipped: true, raison: "Aucun agenda Google n'est configuré." }
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
      second:veterinaires!gardes_second_id_fkey  ( prenom ),
      garde_placements ( place_index, veterinaires ( prenom ) )
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

  // Relations du profil (P6 verrou n°3) — pilotent le vendredi dans la
  // description. undefined (pas de catalogue) → couple historique, byte-identique.
  const relations = await chargerRelationsAffichagePeriode(supabase, periodeId)

  // Petits lots espacés + reprise auto : évite le rate-limit Google
  // (qui jette une partie des créations quand on en lance trop d'un coup),
  // tout en restant largement sous le maxDuration de la fonction.
  const BATCH = 3
  const PAUSE_MS = 250
  const toutes = gardes as unknown as GardeAvecVetos[]

  // Backlog 8 bis — toutes les exceptions de la période EN UNE FOIS, indexées
  // par garde. Une requête par garde dans la boucle ci-dessous en ferait des
  // dizaines pour un résultat presque toujours vide, sur un chemin déjà
  // contraint par le rate-limit Google.
  const { data: excDb } = await supabase
    .from('gardes_exceptions')
    .select('garde_id, date, role, veterinaires:veterinaire_id(prenom)')
    .in('garde_id', toutes.map((g) => g.id as string))

  type RawExc = {
    garde_id: string
    date: string
    role: 'premier' | 'second'
    veterinaires: { prenom: string } | null
  }
  const exceptionsParGarde = new Map<string, GardeEventData['exceptions']>()
  for (const e of ((excDb as unknown as RawExc[] | null) ?? [])) {
    const liste = exceptionsParGarde.get(e.garde_id) ?? []
    liste.push({ date: e.date, role: e.role, prenom: e.veterinaires?.prenom ?? null })
    exceptionsParGarde.set(e.garde_id, liste)
  }

  for (let i = 0; i < toutes.length; i += BATCH) {
    const lot = toutes.slice(i, i + BATCH)
    const resultats = await Promise.all(
      lot.map(async (garde) => {
        const data: GardeEventData = {
          date:          garde.date,
          type:          garde.type,
          prenomPremier: garde.premier?.prenom ?? 'Inconnu',
          prenomSecond:  garde.second?.prenom  ?? null,
          prenomsSuivants: prenomsPlacesSup(garde),
          exceptions: exceptionsParGarde.get(garde.id as string) ?? [],
        }
        try {
          await avecReprise(async () => {
            if (garde.google_event_id) {
              await updateGardeEvent(garde.google_event_id as string, data, structure, calendarId, relations)
            } else {
              const eventId = await createGardeEvent(data, structure, calendarId, relations)
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
  const { data: garde } = await supabase
    .from('gardes')
    .select(`
      id,
      date,
      type,
      google_event_id,
      periode_id,
      cabinet_id,
      premier:veterinaires!gardes_premier_id_fkey ( prenom ),
      second:veterinaires!gardes_second_id_fkey  ( prenom ),
      garde_placements ( place_index, veterinaires ( prenom ) ),
      periodes!inner ( publie_at )
    `)
    .eq('id', gardeId)
    .single()

  if (!garde) return

  // ⚠️ C'EST ICI QUE LE BROUILLON FUYAIT.
  //
  // Cette fonction est appelée à CHAQUE modification manuelle d'une garde.
  // Sans ce garde-fou, retoucher un planning non publié écrivait l'événement
  // dans l'agenda du cabinet : chez Val d'Allier, 38 événements s'y étaient
  // accumulés pour zéro planning publié. Le client voyait des gardes qui
  // n'engageaient personne, et personne ne pouvait deviner d'où elles
  // venaient.
  //
  // Tant qu'un planning n'est pas publié, il ne sort pas du logiciel.
  const perGarde = (garde as unknown as { periodes?: { publie_at: string | null } | Array<{ publie_at: string | null }> }).periodes
  const publieAt = Array.isArray(perGarde) ? perGarde[0]?.publie_at : perGarde?.publie_at
  if (!publieAt) return

  const g = garde as unknown as GardeAvecVetos

  // calendarId scopé au cabinet de la garde (fallback env en aval).
  const calendarId = await calendarIdDuCabinet(supabase, g.cabinet_id)
  if (!isGoogleCalendarConfigured(calendarId)) return

  // Backlog 8 bis — les jours remplacés à titre exceptionnel. Une requête de
  // plus par garde synchronisée, mais elle ne rapporte rien dans l'immense
  // majorité des cas, et sans elle l'agenda afficherait le bloc entier au nom
  // du titulaire alors que quelqu'un le remplace un jour.
  const { data: exceptionsDb } = await supabase
    .from('gardes_exceptions')
    .select('date, role, veterinaires:veterinaire_id(prenom)')
    .eq('garde_id', gardeId)

  type RawExc = { date: string; role: 'premier' | 'second'; veterinaires: { prenom: string } | null }
  const exceptions = ((exceptionsDb as unknown as RawExc[] | null) ?? []).map((e) => ({
    date: e.date,
    role: e.role,
    prenom: e.veterinaires?.prenom ?? null,
  }))

  const data: GardeEventData = {
    date:          g.date,
    type:          g.type,
    prenomPremier: g.premier?.prenom ?? 'Inconnu',
    prenomSecond:  g.second?.prenom  ?? null,
    prenomsSuivants: prenomsPlacesSup(g),
    exceptions,
  }

  // Structure horaire du cabinet (A1) — aligne l'agenda sur la base.
  const structure = g.periode_id
    ? await structurePourPeriode(supabase, g.periode_id)
    : undefined

  // Relations du profil (P6 verrou n°3) — pilotent le vendredi dans la description.
  const relations = g.periode_id
    ? await chargerRelationsAffichagePeriode(supabase, g.periode_id)
    : undefined

  if (g.google_event_id) {
    await updateGardeEvent(g.google_event_id, data, structure, calendarId, relations)
  } else {
    const eventId = await createGardeEvent(data, structure, calendarId, relations)
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
  const cabinetId = await cabinetIdDePeriode(supabase, periodeId)
  const calendarId = await calendarIdDuCabinet(supabase, cabinetId)
  if (!isGoogleCalendarConfigured(calendarId)) return

  const { data: gardes } = await supabase
    .from('gardes')
    .select('id, google_event_id')
    .eq('periode_id', periodeId)
    .not('google_event_id', 'is', null)

  if (!gardes) return

  await supprimerEvenementsParIds(
    gardes
      .map((garde) => garde.google_event_id as string | null)
      .filter((id): id is string => Boolean(id)),
    calendarId,
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
export async function supprimerEvenementsParIds(
  eventIds: string[],
  calendarId?: string | null,
): Promise<void> {
  if (!isGoogleCalendarConfigured(calendarId)) return
  if (eventIds.length === 0) return

  // Suppression par petits lots espacés + reprise (anti rate-limit Google)
  const BATCH = 3
  const PAUSE_MS = 250

  for (let i = 0; i < eventIds.length; i += BATCH) {
    const lot = eventIds.slice(i, i + BATCH)
    await Promise.all(
      lot.map((eventId) =>
        avecReprise(() => deleteGardeEvent(eventId, calendarId)).catch(() => {
          // On continue même si un événement n'existe plus côté Google
        })
      )
    )
    if (i + BATCH < eventIds.length) await sleep(PAUSE_MS)
  }
}
