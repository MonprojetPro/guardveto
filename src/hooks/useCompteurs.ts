// ============================================================
// GUARDVETO — useCompteurs
// ============================================================
// Fonctions de requête server-side pour la page /compteurs.
// Interroge la vue compteurs_gardes + la table bonus_malus.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Periode } from '@/types'

// ── Types exportés ───────────────────────────────────────

export interface CompteursRow {
  veterinaire_id: string
  prenom: string
  nom: string
  statut: 'associe' | 'salarie'
  couleur: string
  we_premier: number
  we_second: number
  we_total: number
  sem_premier: number
  sem_second: number
  sem_total: number
  feries_premier: number
  feries_second: number
  feries_total: number
  total_gardes: number
}

export interface BonusMalusRow {
  veterinaire_id: string
  ecart_we: number
  ecart_semaine: number
  ecart_feries: number
  ecart_grands_we: number
}

// ── Requêtes ─────────────────────────────────────────────

/** Charge les compteurs de gardes pour une période donnée */
export async function queryCompteurs(
  supabase: SupabaseClient,
  periodeId: string
): Promise<CompteursRow[]> {
  const { data } = await supabase
    .from('compteurs_gardes')
    .select('*')
    .eq('periode_id', periodeId)
    .order('nom')

  return (data as CompteursRow[] | null) ?? []
}

/** Compte le nombre total de week-ends dans une période */
export async function queryTotalWE(
  supabase: SupabaseClient,
  periodeId: string
): Promise<number> {
  const { count } = await supabase
    .from('gardes')
    .select('*', { count: 'exact', head: true })
    .eq('periode_id', periodeId)
    .eq('type', 'weekend')

  return count ?? 0
}

/** Charge les bonus/malus déjà calculés pour une période donnée (bilan courant) */
export async function queryBonusMalusCourant(
  supabase: SupabaseClient,
  periodeId: string
): Promise<BonusMalusRow[]> {
  const { data } = await supabase
    .from('bonus_malus')
    .select('veterinaire_id, ecart_we, ecart_semaine, ecart_feries, ecart_grands_we')
    .eq('periode_id', periodeId)

  return (data as BonusMalusRow[] | null) ?? []
}

/** Charge les infos de base de tous les vétérinaires actifs (pour BonusMalusCard) */
export async function queryVetsInfo(
  supabase: SupabaseClient
): Promise<Array<{ id: string; prenom: string; nom: string; couleur: string }>> {
  const { data } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, couleur')
    .eq('actif', true)
    .order('nom')

  return (data as Array<{ id: string; prenom: string; nom: string; couleur: string }> | null) ?? []
}

/**
 * Charge le bonus/malus hérité depuis la période précédente.
 * Retourne null si aucun enregistrement trouvé.
 */
export async function queryBonusMalusHeritage(
  supabase: SupabaseClient,
  periodeSelectionnee: Periode,
  toutesLesPeriodes: Periode[]
): Promise<BonusMalusRow[]> {
  // Trouver la période chronologiquement précédente
  const periodesPrecedentes = toutesLesPeriodes
    .filter((p) => p.date_fin < periodeSelectionnee.date_debut)
    .sort((a, b) => b.date_debut.localeCompare(a.date_debut))

  const periodePrecedente = periodesPrecedentes[0]
  if (!periodePrecedente) return []

  const { data } = await supabase
    .from('bonus_malus')
    .select('veterinaire_id, ecart_we, ecart_semaine, ecart_feries, ecart_grands_we')
    .eq('periode_id', periodePrecedente.id)

  return (data as BonusMalusRow[] | null) ?? []
}
