// ============================================================
// GUARDVETO — Chargeur de données Supabase pour le solver
// ============================================================
// Transforme les données Supabase (vétérinaires, contraintes,
// congés, bonus/malus) en SolverInput consommable par genererPlanningPur().
// ============================================================

import { createClient } from '@/lib/supabase/server'
import type { VetEngine, ContrainteEngine, CongeEngine } from './types'
import type { BonusMalusMap } from './scorer'
import type { SolverInput } from './solver'

// ── Mapping DB → engine ──────────────────────────────────

interface ContrainteDb {
  id: string
  type: ContrainteEngine['type']
  config: Record<string, unknown>
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

// ── Chargement principal ─────────────────────────────────

/**
 * chargerInputDepuisSupabase — Charge toutes les données nécessaires
 * depuis Supabase et retourne un SolverInput prêt à l'emploi.
 *
 * @param periodeId  UUID de la période à générer
 * @throws           Si la période est introuvable ou inaccessible
 */
export async function chargerInputDepuisSupabase(periodeId: string): Promise<SolverInput> {
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

  return {
    dateDebut: periode.date_debut,
    dateFin: periode.date_fin,
    saison: periode.saison as 'ete' | 'hiver',
    vets,
    bonusMalus,
  }
}
