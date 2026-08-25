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
import { periodesVisibles } from '@/lib/planning/diffusion'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export async function chargerDock(
  supabase: SupabaseServerClient,
  // Seul le rôle est lu ici. Le type est donc réduit à ce qu'on utilise
  // vraiment, ce qui permet au secrétariat — qui n'a pas de fiche
  // vétérinaire — de passer par la même fonction (B-017, 2026-08-25). Exiger
  // un `Veterinaire` complet aurait obligé à en fabriquer un faux, et un faux
  // vétérinaire qui circule dans le code finit toujours par arriver quelque
  // part où on le prend pour un vrai.
  qui: { role_app: string },
  /** Périodes déjà chargées par l'écran appelant — évite une requête de plus. */
  periodesConnues?: Periode[],
): Promise<DonneesDock> {
  const estAdmin = qui.role_app === 'admin'
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

  // La pastille annonce le planning « en cours » à tout l'écran : pour un
  // vétérinaire, elle ne peut donc parler que de ce qui lui a été DIFFUSÉ.
  // Sans ce tri, la barre affichait « Historique été 2026 · Brouillon » à un
  // véto — soit l'existence ET l'état d'avancement d'un planning qu'il n'était
  // pas censé connaître. Le critère est `publie_at`, jamais le statut.
  const periodes = periodesVisibles(
    ((periodesRes as { data?: Periode[] | null })?.data ?? []) as Periode[],
    estAdmin,
  )
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
