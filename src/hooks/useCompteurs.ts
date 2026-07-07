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

// ── Compteurs sur une plage de dates libre ───────────────
// Agrège les gardes entre `debut` et `fin` (incluses), en traversant
// autant de périodes que nécessaire. `valideOnly` ne compte que les
// gardes appartenant à des périodes publiées ou verrouillées.

function ligneVide(v: { id: string; prenom: string; nom: string; statut: 'associe' | 'salarie'; couleur: string }): CompteursRow {
  return {
    veterinaire_id: v.id, prenom: v.prenom, nom: v.nom, statut: v.statut, couleur: v.couleur,
    we_premier: 0, we_second: 0, we_total: 0,
    sem_premier: 0, sem_second: 0, sem_total: 0,
    feries_premier: 0, feries_second: 0, feries_total: 0,
    total_gardes: 0,
  }
}

export async function queryCompteursPlage(
  supabase: SupabaseClient,
  debut: string,
  fin: string,
  valideOnly: boolean
): Promise<{ compteurs: CompteursRow[]; totalWE: number }> {
  // 1. Vétérinaires actifs (noms + couleurs + statut)
  const { data: vetsData } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, statut, couleur')
    .eq('actif', true)
    .order('nom')
  const vets = (vetsData as Array<{ id: string; prenom: string; nom: string; statut: 'associe' | 'salarie'; couleur: string }> | null) ?? []

  // 2. Gardes de la plage + statut de leur période
  const { data: gardesData } = await supabase
    .from('gardes')
    .select('type, premier_id, second_id, periodes!inner(statut)')
    .gte('date', debut)
    .lte('date', fin)

  type GardeRow = { type: 'semaine' | 'weekend' | 'ferie'; premier_id: string | null; second_id: string | null; periodes: { statut: string } | { statut: string }[] }
  let gardes = (gardesData as GardeRow[] | null) ?? []

  const statutDe = (g: GardeRow): string =>
    Array.isArray(g.periodes) ? g.periodes[0]?.statut : g.periodes?.statut
  if (valideOnly) {
    gardes = gardes.filter((g) => {
      const s = statutDe(g)
      return s === 'publie' || s === 'verrouille'
    })
  }

  // 3. Agrégation par vétérinaire
  const map = new Map<string, CompteursRow>()
  for (const v of vets) map.set(v.id, ligneVide(v))

  let totalWE = 0
  for (const g of gardes) {
    if (g.type === 'weekend') totalWE++
    const p = g.premier_id ? map.get(g.premier_id) : null
    const s = g.second_id ? map.get(g.second_id) : null
    if (g.type === 'weekend') {
      if (p) { p.we_premier++; p.we_total++; p.total_gardes++ }
      if (s) { s.we_second++; s.we_total++; s.total_gardes++ }
    } else if (g.type === 'ferie') {
      if (p) { p.feries_premier++; p.feries_total++; p.total_gardes++ }
      if (s) { s.feries_second++; s.feries_total++; s.total_gardes++ }
    } else if (g.type === 'semaine') {
      if (p) { p.sem_premier++; p.sem_total++; p.total_gardes++ }
      if (s) { s.sem_second++; s.sem_total++; s.total_gardes++ }
    } else {
      // Type SUR-MESURE (P3b) : compte dans le TOTAL uniquement — même règle
      // que la vue SQL compteurs_gardes (sinon les deux chemins divergeaient).
      if (p) p.total_gardes++
      if (s) s.total_gardes++
    }
  }

  // On ne garde que les vétos ayant au moins une garde (cohérent avec la vue)
  const compteurs = [...map.values()].filter((r) => r.total_gardes > 0)
  return { compteurs, totalWE }
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

// ── Historique des fêtes (backlog n°14 — équité inter-annuelle) ──

export interface HistoriqueFeteAffichage {
  veterinaire_id: string
  fete: 'noel' | 'nouvel_an'
  annee: number
  role: string | null
  prenom: string
  nom: string
}

/**
 * Charge l'historique des fêtes du cabinet (RLS restrictive = scope tenant),
 * avec les noms des vétérinaires. BEST-EFFORT : table pas encore migrée ou
 * erreur → [] (la section n'est simplement pas affichée — pas de coquille
 * vide : on ne montre la carte QUE si des données réelles existent).
 */
export async function queryHistoriqueFetes(
  supabase: SupabaseClient
): Promise<HistoriqueFeteAffichage[]> {
  const { data, error } = await supabase
    .from('historique_fete')
    .select('veterinaire_id, fete, annee, role, veterinaires(prenom, nom)')
    .order('annee', { ascending: false })
    .order('fete')

  if (error || !data) return []

  type Row = {
    veterinaire_id: string
    fete: 'noel' | 'nouvel_an'
    annee: number
    role: string | null
    veterinaires: { prenom: string; nom: string } | { prenom: string; nom: string }[] | null
  }
  return (data as Row[]).map((r) => {
    const v = Array.isArray(r.veterinaires) ? r.veterinaires[0] : r.veterinaires
    return {
      veterinaire_id: r.veterinaire_id,
      fete: r.fete,
      annee: r.annee,
      role: r.role,
      prenom: v?.prenom ?? '',
      nom: v?.nom ?? '',
    }
  })
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
