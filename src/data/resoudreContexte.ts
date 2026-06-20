// ============================================================
// GUARDVETO — resoudreContexte
// ============================================================
// Charge le contexte complet d'une période depuis Supabase et
// retourne un ContexteSimulation prêt à être passé au solver.
//
// Responsabilités :
//   1. Délègue le chargement des données métier à chargerInputDepuisSupabase
//   2. Enrichit le résultat avec le calendrier (fériés + vacances) via
//      la RPC get_calendrier scopée sur le cabinet
//   3. Retourne un ContexteSimulation (alias structurel de SolverInput)
//
// Déclencheur : pipeline de génération (F6-002) depuis la route
// POST /api/generate, après validation auth + extraction cabinet_id.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { chargerInputDepuisSupabase } from '@/engine/loader'
import type { ContexteSimulation, CalendrierResolu } from '@/engine/types'

// ── Types internes (réponse brute de get_calendrier) ─────────

interface FerieRaw {
  date: string
  libelle: string
}

interface VacanceRaw {
  debut: string
  fin: string
  label: string
}

interface CalendrierRaw {
  feries: FerieRaw[]
  vacances: VacanceRaw[]
}

// ── Chargement du calendrier via RPC ─────────────────────────

/**
 * Charge le calendrier (fériés + vacances scolaires) depuis Supabase
 * via la RPC get_calendrier, scopée sur la région et la zone scolaire
 * du cabinet.
 *
 * Retourne undefined si la RPC échoue ou renvoie null (cabinet introuvable,
 * inactif) — le solver se rabattra sur les listes en dur de utils.ts.
 */
async function chargerCalendrier(
  cabinetId: string,
  dateDebut: string,
  dateFin: string
): Promise<CalendrierResolu | undefined> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('get_calendrier', {
    p_cabinet_id: cabinetId,
    p_date_debut: dateDebut,
    p_date_fin: dateFin,
  })

  if (error || !data) {
    // Fallback silencieux — le solver utilise ses listes en dur
    return undefined
  }

  const raw = data as CalendrierRaw

  return {
    feries: new Set((raw.feries ?? []).map((f) => f.date)),
    vacancesScolaires: (raw.vacances ?? []).map((v) => ({
      debut: v.debut,
      fin: v.fin,
    })),
  }
}

// ── API publique ─────────────────────────────────────────────

/**
 * resoudreContexte — Charge et assemble le contexte complet d'une
 * simulation à partir d'une période et d'un cabinet.
 *
 * Pipeline :
 *   1. chargerInputDepuisSupabase(periodeId) → SolverInput (vets, congés, bonus/malus)
 *   2. chargerCalendrier(cabinetId, ...)     → CalendrierResolu (fériés + vacances)
 *   3. Merge → ContexteSimulation
 *
 * @param periodeId  UUID de la période à simuler
 * @param cabinetId  UUID du cabinet (lu depuis app_metadata du JWT — règle C1)
 * @throws           Si la période est introuvable, verrouillée, ou inaccessible
 */
export async function resoudreContexte(
  periodeId: string,
  cabinetId: string
): Promise<ContexteSimulation> {
  // 1. Charger les données métier ET le calendrier zone-aware en une passe.
  //    Le loader charge désormais lui-même les vacances scolaires de la ZONE
  //    du cabinet (cabinets.zone_scolaire) + les fériés de sa région — c'est
  //    le chemin nominal, source unique de vérité.
  const input = await chargerInputDepuisSupabase(periodeId, cabinetId)

  // 2. Filet de sécurité : si le loader n'a pas pu construire le calendrier
  //    (cabinet/référentiel introuvable), on retente via la RPC get_calendrier
  //    (SECURITY DEFINER) avant de retomber sur les listes en dur de utils.ts.
  const calendrier =
    input.calendrier ??
    (await chargerCalendrier(cabinetId, input.dateDebut, input.dateFin))

  // 3. Assembler le ContexteSimulation
  //    ⚠️ Propager EXPLICITEMENT nbVetosSemaineSoir ET equityWeights : cet objet
  //    est reconstruit champ par champ, donc tout champ oublié ici est détruit
  //    avant d'atteindre le solver (l'effectif configurable l'était jusqu'ici —
  //    il était chargé par le loader mais jamais transmis). Cf. ContexteSimulation.
  const contexte: ContexteSimulation = {
    dateDebut: input.dateDebut,
    dateFin: input.dateFin,
    saison: input.saison,
    vets: input.vets,
    bonusMalus: input.bonusMalus,
    calendrier,
    nbVetosSemaineSoir: input.nbVetosSemaineSoir,
    equityWeights: input.equityWeights,
    structureConfig: input.structureConfig,
  }

  return contexte
}
