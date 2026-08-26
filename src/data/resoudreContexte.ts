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
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { effectifPourGeneration, exclusDeLaGeneration } from '@/engine/effectif'
import { fallbackVacancesObsolete, VACANCES_FALLBACK_FIN } from '@/engine/utils'
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
 * @param options    `autoriserVerrouille` (défaut false) : autorise une période
 *                   VERROUILLÉE. Réservé à la gestion de crise (réparation ciblée
 *                   d'un planning verrouillé) — la génération laisse le défaut.
 *
 *                   `pourGeneration` (défaut false) : retire de l'effectif les
 *                   vétérinaires « dernier recours » (B-046). OPT-IN EXPLICITE,
 *                   et c'est voulu : ce chargeur sert AUSSI les chemins manuels
 *                   (crise, dépannage, disponibilités d'une garde), où le dernier
 *                   recours DOIT rester proposable. Seules les trois portes de la
 *                   génération le passent — /api/generate, replay, pré-vol.
 *                   Les exclus sont renvoyés dans `exclusDernierRecours` pour que
 *                   l'impasse puisse nommer ce réglage au lieu de le taire.
 * @throws           Si la période est introuvable, verrouillée (hors crise), ou inaccessible
 */
export async function resoudreContexte(
  periodeId: string,
  cabinetId: string,
  options?: { autoriserVerrouille?: boolean; pourGeneration?: boolean }
): Promise<ContexteSimulation> {
  // 1. Charger les données métier ET le calendrier zone-aware en une passe.
  //    Le loader charge désormais lui-même les vacances scolaires de la ZONE
  //    du cabinet (cabinets.zone_scolaire) + les fériés de sa région — c'est
  //    le chemin nominal, source unique de vérité.
  const input = await chargerInputDepuisSupabase(periodeId, cabinetId, options)

  // 2. Filet de sécurité : si le loader n'a pas pu construire le calendrier
  //    (cabinet/référentiel introuvable), on retente via la RPC get_calendrier
  //    (SECURITY DEFINER) avant de retomber sur les listes en dur de utils.ts.
  const calendrier =
    input.calendrier ??
    (await chargerCalendrier(cabinetId, input.dateDebut, input.dateFin))

  // Alerte NON silencieuse (dette technique) : si AUCUN calendrier zone-aware
  // n'a pu être résolu (ni loader ni RPC), le moteur retombe sur la liste de
  // vacances scolaires EN DUR (utils.ts), qui expire au 31/08/2027. Pour une
  // période qui déborde cette couverture, on le DIT au lieu de fausser en
  // silence les règles « repos sauf vacances ». Pur logging → aucun effet sur
  // le planning généré (byte-identique).
  if (!calendrier && fallbackVacancesObsolete(input.dateFin)) {
    console.warn(
      `[vacances-fallback] Aucun calendrier scolaire zone-aware pour la période ` +
      `${periodeId} (fin ${input.dateFin}, cabinet ${cabinetId}) : repli sur la liste ` +
      `EN DUR, obsolète après ${VACANCES_FALLBACK_FIN}. Étendre la table ` +
      `vacances_scolaires ou vérifier la zone scolaire du cabinet — les règles ` +
      `« repos sauf vacances » risquent d'être faussées sur cette période.`,
    )
  }

  // 3. Assembler le ContexteSimulation
  //    ⚠️ Propager EXPLICITEMENT nbVetosSemaineSoir ET equityWeights : cet objet
  //    est reconstruit champ par champ, donc tout champ oublié ici est détruit
  //    avant d'atteindre le solver (l'effectif configurable l'était jusqu'ici —
  //    il était chargé par le loader mais jamais transmis). Cf. ContexteSimulation.
  const contexte: ContexteSimulation = {
    dateDebut: input.dateDebut,
    dateFin: input.dateFin,
    saison: input.saison,
    // PARADE 1 — normalisation à la SOURCE : tous les consommateurs (générateur,
    // validateur, crise, disponibilités…) reçoivent des règles déjà dépliées.
    // Plus aucun consommateur, même futur, ne peut être aveugle à la config params.
    // B-046 — le dernier recours sort de l'effectif AVANT le moteur quand on
    // charge pour une génération. Filtré ICI, à la source : solver, équité,
    // validateur et pré-vol reçoivent tous le même effectif, aucun ne peut
    // diverger (parade anti-cécité, même esprit que la normalisation ci-dessus).
    vets: normaliserContraintesVets(
      options?.pourGeneration ? effectifPourGeneration(input.vets) : input.vets,
    ),
    exclusDernierRecours: options?.pourGeneration
      ? exclusDeLaGeneration(input.vets).map((v) => ({ id: v.id, prenom: v.prenom }))
      : undefined,
    bonusMalus: input.bonusMalus,
    calendrier,
    nbVetosSemaineSoir: input.nbVetosSemaineSoir,
    equityWeights: input.equityWeights,
    structureConfig: input.structureConfig,
    creneaux: input.creneaux,
    roleAvantageFinancier: input.roleAvantageFinancier,
    // #17 — lookback inter-périodes : propagation EXPLICITE (objet reconstruit
    // champ par champ ; sans cette ligne, le lookback chargé par le loader serait
    // détruit avant d'atteindre le solver — cf. avertissement ContexteSimulation).
    contexteAnterieur: input.contexteAnterieur,
  }

  return contexte
}
