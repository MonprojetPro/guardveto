// ============================================================
// GUARDVETO — Chargeur de données Supabase pour le solver
// ============================================================
// Transforme les données Supabase (vétérinaires, contraintes,
// congés, bonus/malus) en SolverInput consommable par genererPlanningPur().
// ============================================================

import { createClient } from '@/lib/supabase/server'
import type { VetEngine, ContrainteEngine, CongeEngine, CalendrierResolu } from './types'
import type { BonusMalusMap } from './score-lexicographique'
import type { SolverInput } from './solver'

// ── Mapping DB → engine ──────────────────────────────────

interface ContrainteDb {
  id: string
  type: ContrainteEngine['type']
  config: Record<string, unknown>
  /** Format du config : 'legacy' = V1 hétérogène, 'v2' = grammaire 6-axes normalisée */
  brique_type: 'legacy' | 'v2'
  actif: boolean
}

interface CongeDb {
  veterinaire_id: string
  date_debut: string
  date_fin: string
  type: 'vacances' | 'formation' | 'sante' | 'autre' | 'indisponibilite'
}

interface BonusMalusDb {
  veterinaire_id: string
  ecart_we: number
}

/** Ligne brute de la table de référentiel `vacances_scolaires` (schéma V2). */
interface VacanceScolaireDb {
  debut: string
  fin: string
  label: string
}

/** Ligne brute de la table de référentiel `jours_feries` (schéma V2). */
interface JourFerieDb {
  date: string
  libelle: string
}

// ── Chargement du calendrier scopé par zone/région ───────

/**
 * chargerCalendrierZone — Construit le CalendrierResolu (fériés + vacances
 * scolaires) à partir des DONNÉES de référentiel, scopées sur la RÉGION et
 * la ZONE du cabinet courant (`cabinets.region_feries` + `zone_scolaire`).
 *
 * C'est le cœur du correctif « zone-aware » : avant, le moteur utilisait la
 * constante `VACANCES_SCOLAIRES` (zone C, codée en dur) pour TOUS les
 * cabinets — ce qui faussait la règle « repos sauf vacances » (ex. Fanny,
 * mercredi) pour tout cabinet non-zone-C (le pilote = zone A).
 *
 * ⚠️ Cohérence fériés : on charge AUSSI les fériés (par région) pour que le
 * Set `feries` soit fidèle. Un calendrier avec un Set `feries` vide ferait
 * croire à `estJourFerie()` qu'aucune date n'est fériée → régression. On ne
 * renvoie donc le calendrier QUE lorsqu'on a pu charger les deux référentiels.
 *
 * @param cabinetId  UUID du cabinet courant (sa zone/région déterminent les dates)
 * @param dateDebut  Premier jour de la période (filtre de chevauchement)
 * @param dateFin    Dernier jour de la période (filtre de chevauchement)
 * @returns          CalendrierResolu complet, ou `undefined` si le cabinet est
 *                   introuvable / requête en erreur → le moteur se rabat alors
 *                   sur les listes en dur de utils.ts (fallback hors-DB).
 */
async function chargerCalendrierZone(
  cabinetId: string,
  dateDebut: string,
  dateFin: string
): Promise<CalendrierResolu | undefined> {
  const supabase = await createClient()

  // 1. Zone scolaire + région du cabinet courant
  const { data: cabinet, error: cabinetErr } = await supabase
    .from('cabinets')
    .select('zone_scolaire, region_feries')
    .eq('id', cabinetId)
    .single()

  if (cabinetErr || !cabinet?.zone_scolaire) {
    // Cabinet/zone introuvable → fallback sur les listes en dur (utils.ts)
    return undefined
  }

  const region = cabinet.region_feries ?? 'metropole'

  // 2. Vacances scolaires de CETTE zone qui chevauchent la période
  const { data: vacances, error: vacErr } = await supabase
    .from('vacances_scolaires')
    .select('debut, fin, label')
    .eq('zone', cabinet.zone_scolaire)
    .lte('debut', dateFin)
    .gte('fin', dateDebut)
    .order('debut')

  if (vacErr || !vacances) {
    return undefined
  }

  // 3. Jours fériés de la région qui tombent dans la période
  const { data: feries, error: ferErr } = await supabase
    .from('jours_feries')
    .select('date, libelle')
    .eq('region', region)
    .gte('date', dateDebut)
    .lte('date', dateFin)
    .order('date')

  if (ferErr || !feries) {
    return undefined
  }

  return {
    feries: new Set((feries as JourFerieDb[]).map((f) => f.date)),
    vacancesScolaires: (vacances as VacanceScolaireDb[]).map((v) => ({
      debut: v.debut,
      fin: v.fin,
    })),
  }
}

// ── Chargement principal ─────────────────────────────────

/**
 * chargerInputDepuisSupabase — Charge toutes les données nécessaires
 * depuis Supabase et retourne un SolverInput prêt à l'emploi.
 *
 * Si `cabinetId` est fourni, le SolverInput est enrichi d'un `calendrier`
 * (fériés + vacances scolaires) chargé depuis les DONNÉES de référentiel,
 * scopé sur la zone/région du cabinet. Le chemin nominal utilise donc les
 * vraies vacances de la zone du cabinet, et non plus la constante en dur
 * `VACANCES_SCOLAIRES` (zone C) de utils.ts.
 *
 * Sans `cabinetId` (contextes hors-DB / legacy), `calendrier` reste absent
 * et le moteur se rabat sur les listes en dur de utils.ts (fallback).
 *
 * @param periodeId  UUID de la période à générer
 * @param cabinetId  UUID du cabinet courant (optionnel) — active le calendrier zone-aware
 * @throws           Si la période est introuvable ou inaccessible
 */
export async function chargerInputDepuisSupabase(
  periodeId: string,
  cabinetId?: string
): Promise<SolverInput> {
  const supabase = await createClient()

  // 1. Période à générer
  const { data: periode, error: periodeErr } = await supabase
    .from('periodes')
    .select('id, saison, date_debut, date_fin, statut')
    .eq('id', periodeId)
    .single()

  if (periodeErr || !periode) {
    throw new Error(`Période introuvable : ${periodeId}`)
  }

  if (periode.statut === 'verrouille') {
    throw new Error('Cette période est verrouillée — impossible de régénérer.')
  }

  // 2. Vétérinaires actifs + leurs contraintes (via join)
  const { data: vetsDb, error: vetsErr } = await supabase
    .from('veterinaires')
    .select('id, nom, prenom, statut, dernier_recours, contraintes_veto(*)')
    .eq('actif', true)
    .order('nom')

  if (vetsErr) throw new Error(`Erreur chargement vétérinaires : ${vetsErr.message}`)

  // 3. Congés validés qui chevauchent la période
  const { data: congesDb } = await supabase
    .from('conges')
    .select('veterinaire_id, date_debut, date_fin, type')
    .eq('statut', 'valide')
    .lte('date_debut', periode.date_fin)
    .gte('date_fin', periode.date_debut)

  // 4. Bonus/malus de la période précédente (pour R20)
  const { data: periodePrecedente } = await supabase
    .from('periodes')
    .select('id')
    .lt('date_fin', periode.date_debut)
    .order('date_fin', { ascending: false })
    .limit(1)
    .maybeSingle()

  let bonusMalus: BonusMalusMap = {}
  if (periodePrecedente) {
    const { data: bmDb } = await supabase
      .from('bonus_malus')
      .select('veterinaire_id, ecart_we')
      .eq('periode_id', periodePrecedente.id)

    for (const bm of (bmDb as BonusMalusDb[] | null) ?? []) {
      // ecart_we positif = a fait plus → bm positif = doit faire moins ce tour
      // On inverse le signe car dans le solver, bm positif = DOIT faire plus
      bonusMalus[bm.veterinaire_id] = -bm.ecart_we
    }
  }

  // 5. Mapper vers VetEngine
  type VetDb = {
    id: string
    nom: string
    prenom: string
    statut: 'associe' | 'salarie'
    dernier_recours: boolean
    contraintes_veto: ContrainteDb[]
  }

  const vets: VetEngine[] = ((vetsDb as VetDb[]) ?? []).map((vet) => ({
    id: vet.id,
    nom: vet.nom,
    prenom: vet.prenom,
    statut: vet.statut,
    dernier_recours: vet.dernier_recours,
    contraintes: (vet.contraintes_veto ?? []).map((c): ContrainteEngine => ({
      id: c.id,
      type: c.type,
      config: c.config,
      // brique_type disponible pour les consommateurs V2 du solver
      // (non inclus dans ContrainteEngine V1 — sera utilisé dans F6-002)
      actif: c.actif,
    })),
    conges: ((congesDb as CongeDb[] | null) ?? [])
      .filter((c) => c.veterinaire_id === vet.id)
      .map((c): CongeEngine => ({
        date_debut: c.date_debut,
        date_fin: c.date_fin,
        type: c.type,
      })),
  }))

  // 6. Calendrier zone-aware (fériés + vacances de la zone du cabinet).
  //    Chemin nominal : on charge les vraies vacances de la zone du cabinet.
  //    Fallback : si pas de cabinetId, ou cabinet/référentiel introuvable,
  //    `calendrier` reste undefined → le moteur retombe sur utils.ts.
  const calendrier = cabinetId
    ? await chargerCalendrierZone(cabinetId, periode.date_debut, periode.date_fin)
    : undefined

  return {
    dateDebut: periode.date_debut,
    dateFin: periode.date_fin,
    saison: periode.saison as 'ete' | 'hiver',
    vets,
    bonusMalus,
    calendrier,
  }
}
