// ============================================================
// GUARDVETO V2 — Les pastilles de la barre, pour tous les écrans
// ============================================================
// L'accueil calcule ces chiffres au passage (il lit déjà tout) ; les autres
// écrans V2 n'ont besoin QUE de ça. Une seule source pour les deux : une
// pastille qui dirait « 3 souhaits » sur l'accueil et « 2 » sur le planning
// apprendrait à l'utilisateur à ne plus les croire.
//
// Best-effort : un compteur qui ne se calcule pas s'affiche à zéro plutôt que
// de faire tomber l'écran.
// ============================================================

import type { createClient } from '@/lib/supabase/server'
import type { Periode, Veterinaire } from '@/types'
import type { DonneesDock } from './accueilEpicentre'
import { aujourdhuiISO } from './accueilEpicentre'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export async function chargerDock(
  supabase: SupabaseServerClient,
  veterinaire: Veterinaire,
  /** Périodes déjà chargées par l'écran appelant — évite une requête de plus. */
  periodesConnues?: Periode[],
): Promise<DonneesDock> {
  const estAdmin = veterinaire.role_app === 'admin'
  const today = aujourdhuiISO()

  const [periodesRes, vetosRes, souhaitsRes, echangesRes, cabinetRes] =
    await Promise.all([
      periodesConnues
        ? Promise.resolve({ data: periodesConnues })
        : supabase.from('periodes').select('*').order('date_debut', { ascending: false }).limit(20),
      supabase.from('veterinaires').select('id', { count: 'exact', head: true }).eq('actif', true),
      estAdmin
        ? supabase.from('conges').select('id', { count: 'exact', head: true }).eq('statut', 'souhait')
        : Promise.resolve({ count: 0 }),
      supabase
        .from('echanges_gardes')
        .select('id', { count: 'exact', head: true })
        .eq('statut', 'proposee'),
      supabase.from('cabinets').select('google_calendar_id').limit(1).maybeSingle(),
    ])

  const periodes = ((periodesRes as { data?: Periode[] | null })?.data ?? []) as Periode[]
  const courante =
    periodes.find((p) => p.date_debut <= today && p.date_fin >= today) ??
    [...periodes].reverse().find((p) => p.date_debut > today) ??
    periodes[0] ??
    null

  const calendarId = (cabinetRes as { data?: { google_calendar_id?: string | null } | null })?.data
    ?.google_calendar_id

  return {
    nbSouhaits: (souhaitsRes as { count?: number | null })?.count ?? 0,
    nbEchanges: (echangesRes as { count?: number | null })?.count ?? 0,
    nbVetos: (vetosRes as { count?: number | null })?.count ?? 0,
    agendaConnecte: Boolean(calendarId),
    libellePlanning: courante
      ? (courante.libelle ??
        `${courante.saison === 'ete' ? 'Été' : 'Hiver'} ${courante.date_debut.slice(0, 4)}`)
      : 'Aucune période',
    statutPlanning: courante?.statut ?? null,
  }
}
