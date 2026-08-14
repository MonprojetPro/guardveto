// ============================================================
// GUARDVETO — useCompteurs
// ============================================================
// Fonctions de requête server-side pour l'écran « Historique & compteurs »
// (`/historique`). Interroge la vue compteurs_gardes + la table bonus_malus.
//
// DEUX RÈGLES DE MAISON, toutes deux payées au prix fort sur ce projet :
//
// ① Une erreur Supabase ne devient JAMAIS « zéro ligne ». Un `?? []` avalé
//    transforme « je n'ai pas pu lire » en « personne n'a de garde » — et
//    l'écran affiche sereinement un vide qui est un mensonge. Les fonctions
//    de lecture remontent donc `erreur` en plus des lignes, et leurs
//    appelants ont le devoir de la montrer. (cf. mémoire projet
//    « supabase-erreur-avalee-devient-zero-ligne ».)
//
// ② Aucune lecture de `gardes` n'est laissée à la limite par défaut de
//    PostgREST (1000 lignes). Une période de 17 semaines pèse déjà ~120
//    gardes : le cumul sur huit périodes franchit le plafond, et la coupure
//    est SILENCIEUSE — les compteurs seraient simplement faux, sans erreur.
//    D'où `lireTout()`, qui pagine jusqu'à épuisement.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Periode } from '@/types'

/** Taille de page pour les lectures paginées (limite PostgREST par défaut). */
const TAILLE_PAGE = 1000

/**
 * Lit une table par tranches de 1000 jusqu'à épuisement.
 *
 * `construire(de, a)` doit renvoyer la requête déjà filtrée, à laquelle on
 * n'ajoute que le `.range()`. Une erreur interrompt la boucle et remonte —
 * mieux vaut dire « je n'ai pas pu lire » que de rendre un total tronqué qui
 * a l'air normal.
 */
async function lireTout<T>(
  construire: (de: number, a: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ lignes: T[]; erreur: string | null }> {
  const lignes: T[] = []
  for (let page = 0; ; page++) {
    const de = page * TAILLE_PAGE
    const { data, error } = await construire(de, de + TAILLE_PAGE - 1)
    if (error) return { lignes, erreur: error.message }
    const lot = (data as T[] | null) ?? []
    lignes.push(...lot)
    if (lot.length < TAILLE_PAGE) return { lignes, erreur: null }
  }
}

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

/**
 * Résultat d'une lecture de compteurs : les lignes, et ce qui a empêché de
 * les lire. `erreur` non nulle veut dire « je n'ai pas pu compter » — ce qui
 * n'est PAS la même chose que `compteurs: []`, qui veut dire « personne n'a
 * de garde sur ce filtre ». L'écran doit distinguer les deux.
 */
export interface ResultatCompteurs {
  compteurs: CompteursRow[]
  totalWE: number
  erreur: string | null
}

/** Charge les compteurs de gardes pour une période donnée */
export async function queryCompteurs(
  supabase: SupabaseClient,
  periodeId: string
): Promise<{ compteurs: CompteursRow[]; erreur: string | null }> {
  const { data, error } = await supabase
    .from('compteurs_gardes')
    .select('*')
    .eq('periode_id', periodeId)
    .order('nom')

  if (error) return { compteurs: [], erreur: error.message }
  return { compteurs: (data as CompteursRow[] | null) ?? [], erreur: null }
}

// ── Compteurs sur une plage de dates libre ───────────────
// Agrège les gardes entre `debut` et `fin` (incluses), en traversant
// autant de périodes que nécessaire. `valideOnly` ne compte que les
// gardes appartenant à des périodes publiées ou verrouillées.

/** Le minimum qu'il faut connaître d'un vétérinaire pour lui fabriquer une
 *  ligne de compteurs à zéro. */
export interface VetoPourCompteurs {
  id: string
  prenom: string
  nom: string
  statut: 'associe' | 'salarie'
  couleur: string
}

export function ligneVide(v: VetoPourCompteurs): CompteursRow {
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
): Promise<ResultatCompteurs> {
  // 1. Vétérinaires actifs (noms + couleurs + statut)
  const { data: vetsData, error: vetsErr } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, statut, couleur')
    .eq('actif', true)
    .order('nom')
  if (vetsErr) return { compteurs: [], totalWE: 0, erreur: vetsErr.message }
  const vets = (vetsData as Array<{ id: string; prenom: string; nom: string; statut: 'associe' | 'salarie'; couleur: string }> | null) ?? []

  // 2. Gardes de la plage + statut de leur période
  // `garde_placements` porte les places au-delà de la deuxième (créneaux
  // sur-mesure à 3 ou 4 places) : sans elle, un vétérinaire de garde en 3e
  // place ne serait compté nulle part — donc réputé moins chargé qu'il ne
  // l'est, et resservi par le moteur.
  //
  // PAGINÉ : une plage large dépasse les 1000 lignes par défaut de PostgREST,
  // et la coupure ne se voit nulle part — les compteurs seraient juste faux.
  type GardeRow = {
    type: 'semaine' | 'weekend' | 'ferie'
    premier_id: string | null
    second_id: string | null
    periodes: { statut: string } | { statut: string }[]
    garde_placements?: { place_index: number; veterinaire_id: string | null }[] | null
  }
  const { lignes: gardesLues, erreur: gardesErr } = await lireTout<GardeRow>((de, a) =>
    supabase
      .from('gardes')
      .select('type, premier_id, second_id, periodes!inner(statut), garde_placements(place_index, veterinaire_id)')
      .gte('date', debut)
      .lte('date', fin)
      .order('date')
      .range(de, a),
  )
  if (gardesErr) return { compteurs: [], totalWE: 0, erreur: gardesErr }
  let gardes = gardesLues

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

    // Places 3 et 4 : elles comptent dans le TOTAL, comme les places 1 et 2
    // d'un créneau sur-mesure — les colonnes détaillées (1er/2e) ne savent
    // représenter que deux rôles.
    for (const pl of g.garde_placements ?? []) {
      if (pl.place_index < 2 || !pl.veterinaire_id) continue
      const ligne = map.get(pl.veterinaire_id)
      if (ligne) ligne.total_gardes++
    }
  }

  // On ne garde que les vétos ayant au moins une garde (cohérent avec la vue)
  const compteurs = [...map.values()].filter((r) => r.total_gardes > 0)
  return { compteurs, totalWE, erreur: null }
}

/**
 * Complète une liste de compteurs avec les vétérinaires actifs qui n'y sont
 * pas, à zéro. Rend la liste inchangée quand personne ne manque.
 *
 * POURQUOI CE N'EST PAS FAIT DANS LES REQUÊTES. La vue `compteurs_gardes` et
 * `queryCompteursPlage` (cf. son filtre final) n'émettent volontairement
 * aucune ligne pour un vétérinaire sans garde, et les TROIS chemins qui
 * écrivent `bonus_malus` s'appuient là-dessus : la quote-part de
 * `calculerBilans` se calcule sur les seuls vétérinaires qui participent à la
 * rotation, et deux d'entre eux (`cron/lock-gardes`, `appliquer-changement`)
 * testent `compteurs.length` pour décider s'il y a quelque chose à écrire.
 * Élargir les requêtes casserait ces deux gardes et changerait l'écart de
 * toute l'équipe.
 *
 * Ce complément est donc réservé à l'AFFICHAGE et s'applique APRÈS
 * `calculerBilans`. Sans lui, un vétérinaire sans garde ne s'affiche pas à
 * zéro : il DISPARAÎT du tableau — ce qui tombe pile sur le vétérinaire de
 * dernier recours, dont le rôle est justement de n'avoir aucune garde tant
 * que tout va bien. Les lignes ajoutées n'ont pas de bilan, ce que
 * `CompteursPanel` rend déjà comme « hors répartition ».
 */
export function completerCompteursPourAffichage(
  compteurs: CompteursRow[],
  vetsActifs: VetoPourCompteurs[],
): CompteursRow[] {
  const presents = new Set(compteurs.map((c) => c.veterinaire_id))
  const manquants = vetsActifs.filter((v) => !presents.has(v.id)).map((v) => ligneVide(v))
  if (manquants.length === 0) return compteurs
  // Même ordre que les deux chemins de lecture : par nom.
  return [...compteurs, ...manquants].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
}

/** Compte le nombre total de week-ends dans une période */
export async function queryTotalWE(
  supabase: SupabaseClient,
  periodeId: string
): Promise<{ totalWE: number; erreur: string | null }> {
  const { count, error } = await supabase
    .from('gardes')
    .select('*', { count: 'exact', head: true })
    .eq('periode_id', periodeId)
    .eq('type', 'weekend')

  if (error) return { totalWE: 0, erreur: error.message }
  return { totalWE: count ?? 0, erreur: null }
}

/**
 * Quelles périodes contiennent au moins une garde.
 *
 * Sert au bouton « supprimer » de la corbeille : il doit prévenir qu'il
 * efface un planning rempli. Avant, cette réponse venait d'un
 * `.select('periode_id').limit(500)` — passé 500 gardes, les périodes les
 * plus anciennes disparaissaient de l'ensemble et la corbeille annonçait
 * « aucune garde » sur un planning plein. Ici on interroge période par
 * période, en `head` : un compte, pas des lignes, donc aucun plafond.
 */
export async function queryPeriodesAvecGardes(
  supabase: SupabaseClient,
  periodeIds: string[],
): Promise<Set<string>> {
  const avec = new Set<string>()
  await Promise.all(
    periodeIds.map(async (id) => {
      const { count } = await supabase
        .from('gardes')
        .select('*', { count: 'exact', head: true })
        .eq('periode_id', id)
      if ((count ?? 0) > 0) avec.add(id)
    }),
  )
  return avec
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

// ── Dépannages (« qui a repris la garde de qui ») ─────────

export interface DepannagesRow {
  veterinaire_id: string
  /** Gardes reprises POUR quelqu'un d'autre. */
  rendus: number
  /** Gardes que quelqu'un a reprises À SA PLACE. */
  recus: number
  /** Dettes encore ouvertes (statut `a_compenser`) où il a été dépanné. */
  dettesOuvertes: number
}

/**
 * Compte les dépannages sur une plage de dates, par vétérinaire.
 *
 * La date qui compte est celle de la GARDE dépannée, pas celle de la saisie :
 * un dépannage saisi en mars pour une garde de janvier appartient à janvier.
 * Les compensations `annulee` sont ignorées — elles n'ont jamais eu lieu.
 *
 * BEST-EFFORT : la table peut être vide sur un cabinet qui n'a jamais eu
 * d'absence. Une erreur renvoie une map vide plutôt que de faire tomber
 * l'écran de compteurs.
 */
export async function queryDepannages(
  supabase: SupabaseClient,
  debut: string,
  fin: string,
): Promise<Map<string, DepannagesRow>> {
  const parVeto = new Map<string, DepannagesRow>()

  const { data, error } = await supabase
    .from('compensations')
    .select('remplacant_id, remplace_id, statut, gardes!inner(date)')
    .gte('gardes.date', debut)
    .lte('gardes.date', fin)

  if (error || !data) return parVeto

  const ligne = (id: string): DepannagesRow => {
    let l = parVeto.get(id)
    if (!l) {
      l = { veterinaire_id: id, rendus: 0, recus: 0, dettesOuvertes: 0 }
      parVeto.set(id, l)
    }
    return l
  }

  for (const c of data as {
    remplacant_id: string
    remplace_id: string
    statut: string
  }[]) {
    if (c.statut === 'annulee') continue
    ligne(c.remplacant_id).rendus += 1
    const recu = ligne(c.remplace_id)
    recu.recus += 1
    if (c.statut === 'a_compenser') recu.dettesOuvertes += 1
  }

  return parVeto
}

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
