// Promu depuis src/engine/__bench__/score-lexicographique.ts (banc d'essai 2026-06-16)
// ============================================================
// GUARDVETO V2 — Score lexicographique HYBRIDE
// ============================================================
// Implémente docs/v2/06-architecture-v2.md §3.2 :
//  - VecteurScore = un nombre par étage (étages hermétiques)
//  - comparerScores = comparaison lexicographique déterministe
//  - somme pondérée À L'INTÉRIEUR de chaque étage (fairness fine)
//  - tie-break déterministe (ordre d'ID véto, puis chronologique)
//
// Réutilise au maximum la logique V1 réelle (hard-constraints,
// soft-constraints, optimization) — aucune ré-écriture des règles.
// ============================================================

import type { PlanningPartiel, VetEngine, SlotGarde, RoleGarde } from './types'

// ── Type partagé solver ↔ loader ─────────────────────────
/**
 * Bonus/malus inter-périodes par vétérinaire (R20).
 * - Valeur positive : le véto doit faire PLUS de gardes cette période.
 * - Valeur négative : le véto doit faire MOINS de gardes cette période.
 */
export interface BonusMalusMap {
  [vetId: string]: number
}
import { isValid } from './rules/hard-constraints'
import { DEFAULT_EQUITY_WEIGHTS } from './equity-weights'
import {
  penaliteR10WEConsecutif,
  penaliteWEAvantVacances,
  penaliteFeteFinAnnee,
  penaliteInversionFerie,
} from './rules/soft-constraints'
import {
  compterParVet,
  desequilibreWE,
  desequilibreWeekendPremier,
  desequilibreFeries,
  desequilibreSemainePremier,
  desequilibreSemaineSecond,
  desequilibreGrandsWeSalaries,
} from './rules/optimization'

// ── Étages (cf. §3.2 enum Etage) ─────────────────────────

export enum Etage {
  INVARIANT_SYSTEME = 0, // hard constraints R1-R9,R16-R21 — jamais violable
  REGLEMENTAIRE = 1, // gravé VIDE & désactivé en V2 (G1)
  JAMAIS_USER = 2, // 🔴 règle d'or utilisateur (aucune dans le pilote)
  SAUF_CRISE = 3, // 🟠 — R10 (2 WE consécutifs)
  EVITEE_AU_MAX = 4, // 🟡 — R10c (WE avant vacances), R10b (fête fin année)
  SI_POSSIBLE = 5, // ⚪ — R8b (inversion férié), dernier recours
  EQUITE = 6, // variance des charges
}

export const NB_ETAGES = 7

export interface ContributionEtage {
  etage: Etage
  regle: string
  cout: number
}

export interface VecteurScore {
  /** Un nombre par étage, index = priorité décroissante. Longueur NB_ETAGES. */
  etages: number[]
  /** Détail des contributions (pour la trace + tests). */
  contributions: ContributionEtage[]
}

/**
 * Comparaison lexicographique stricte.
 * GARANTIE : un seul point dans l'étage N bat N'importe quel nombre de points dans l'étage N+1.
 * Élimine structurellement le bug prod "cumul de pénalités" :
 * 100×🟡 ne franchissent jamais 1×🟠.
 *
 * On parcourt les étages du plus fort (0) au plus faible (6).
 * Le premier étage où les deux vecteurs diffèrent décide.
 * @returns < 0 si a meilleur, > 0 si b meilleur, 0 si strictement égaux.
 */
export function comparerScores(a: VecteurScore, b: VecteurScore): number {
  for (let i = 0; i < a.etages.length; i++) {
    if (a.etages[i] !== b.etages[i]) return a.etages[i] - b.etages[i]
  }
  return 0
}

function vecteurVide(): VecteurScore {
  return { etages: new Array(NB_ETAGES).fill(0), contributions: [] }
}

function ajouter(v: VecteurScore, etage: Etage, regle: string, cout: number): void {
  if (cout === 0) return
  v.etages[etage] += cout
  v.contributions.push({ etage, regle, cout })
}

// ── Poids intra-étage (somme pondérée À L'INTÉRIEUR de l'étage) ──
// IMPORTANT : ce ne sont PAS les POIDS additifs inter-règles de V1
// (qui causaient le cumul de pénalités). Ici, ils ne servent qu'à
// départager DEUX règles DU MÊME étage. Les étages sont hermétiques.

export const POIDS_INTRA = {
  // Étage SAUF_CRISE (🟠)
  R10_WE_CONSECUTIF: 50,
  // Étage EVITEE_AU_MAX (🟡)
  R10C_WE_AVANT_VACANCES: 45,
  R10B_FETE_FIN_ANNEE: 30,
  // Étage SI_POSSIBLE (⚪)
  R8B_INVERSION_FERIE: 20,
  /** Marqueur dernier recours — terme DOMINANT dans son étage (§3.2). */
  DERNIER_RECOURS: 100_000,
  // Étage EQUITE (variance) — poids relatifs des dimensions.
  // Source unique : equity-weights.ts (mutualisé avec POIDS_LNS du solver).
  EQ_WE: DEFAULT_EQUITY_WEIGHTS.WE_GARDE,
  EQ_WE_PREMIER: DEFAULT_EQUITY_WEIGHTS.WE_PREMIER_ROLE,
  EQ_FERIES: DEFAULT_EQUITY_WEIGHTS.FERIES,
  EQ_SEMAINE_PREMIER: DEFAULT_EQUITY_WEIGHTS.SEMAINE_PREMIER,
  EQ_SEMAINE_SECOND: DEFAULT_EQUITY_WEIGHTS.SEMAINE_SECOND,
  EQ_GRANDS_WE: DEFAULT_EQUITY_WEIGHTS.GRANDS_WE,
} as const

// ── Reconstruction des slots+rôles d'une attribution ──────

interface SlotRole {
  slot: SlotGarde
  role: RoleGarde
  vetId: string
}

function listerSlotRoles(planning: PlanningPartiel, saison: 'ete' | 'hiver'): SlotRole[] {
  const out: SlotRole[] = []
  for (const a of planning.attributions) {
    const slot: SlotGarde = { date: a.date, type: a.type, saison }
    if (a.premier_id) out.push({ slot, role: 'premier', vetId: a.premier_id })
    if (a.second_id) out.push({ slot, role: 'second', vetId: a.second_id })
  }
  return out
}

// ── Évaluation d'un planning COMPLET → VecteurScore ───────

/**
 * scorerPlanning — calcule le VecteurScore d'un planning complet.
 *
 * - Étage 0 (INVARIANT) : nombre de hard constraints violées (devrait être 0
 *   pour un planning produit par le solver, qui ne génère que des solutions
 *   valides ; calculé ici pour vérification d'exactitude).
 * - Étages 3-5 : somme pondérée intra-étage des pénalités souples réelles.
 * - Étage 6 (EQUITE) : variance des charges (somme pondérée des variances).
 *
 * @param planning  Planning complet à évaluer
 * @param vets      Tous les vétos
 * @param saison    Saison de la période
 */
export function scorerPlanning(
  planning: PlanningPartiel,
  vets: VetEngine[],
  saison: 'ete' | 'hiver'
): VecteurScore {
  const v = vecteurVide()
  const slotRoles = listerSlotRoles(planning, saison)
  const vetById = new Map(vets.map((x) => [x.id, x]))

  // ── Étage 0 : INVARIANTS (hard constraints) ──
  // On reconstruit le planning attribution par attribution et on vérifie
  // que chaque pose était valide dans le contexte des poses précédentes.
  // (Vérification d'exactitude — un planning du solver doit donner 0.)
  let nbInvariantsViols = 0
  {
    const cumul: PlanningPartiel = { attributions: [] }
    // Ordre déterministe : chronologique puis premier avant second
    const ordered = [...planning.attributions].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.type < b.type ? -1 : 1
    )
    for (const a of ordered) {
      // premier d'abord
      for (const role of ['premier', 'second'] as RoleGarde[]) {
        const vetId = role === 'premier' ? a.premier_id : a.second_id
        if (!vetId) continue
        const vet = vetById.get(vetId)
        if (!vet) continue
        const slot: SlotGarde = { date: a.date, type: a.type, saison }
        const res = isValid(slot, vet, role, vets, cumul)
        if (!res.valid) nbInvariantsViols++
        // pose dans le cumul
        const idx = cumul.attributions.findIndex(
          (x) => x.date === a.date && x.type === a.type
        )
        if (idx >= 0) {
          cumul.attributions[idx] = {
            ...cumul.attributions[idx],
            [role === 'premier' ? 'premier_id' : 'second_id']: vetId,
          }
        } else {
          cumul.attributions.push({
            date: a.date,
            type: a.type,
            premier_id: role === 'premier' ? vetId : null,
            second_id: role === 'second' ? vetId : null,
          })
        }
      }
    }
  }
  if (nbInvariantsViols > 0) {
    ajouter(v, Etage.INVARIANT_SYSTEME, 'hard-constraints', nbInvariantsViols)
  }

  // ── Étages 3-5 : pénalités souples réelles, par étage ──
  // On évalue chaque (slot, rôle) contre le planning ENTIER (les pénalités
  // souples V1 regardent le contexte ; ici le planning est complet).
  for (const sr of slotRoles) {
    const vet = vetById.get(sr.vetId)
    if (!vet) continue

    // R10 (🟠 SAUF_CRISE)
    const r10 = penaliteR10WEConsecutif(sr.slot, vet, planning)
    if (r10 > 0) ajouter(v, Etage.SAUF_CRISE, 'R10', POIDS_INTRA.R10_WE_CONSECUTIF)

    // R10c (🟡 EVITEE)
    const r10c = penaliteWEAvantVacances(sr.slot, vet, planning)
    if (r10c > 0)
      ajouter(v, Etage.EVITEE_AU_MAX, 'R10c', POIDS_INTRA.R10C_WE_AVANT_VACANCES)

    // R10b (🟡 EVITEE) — pénalité de fête de fin d'année (slot seul)
    const r10b = penaliteFeteFinAnnee(sr.slot)
    if (r10b > 0)
      ajouter(v, Etage.EVITEE_AU_MAX, 'R10b', POIDS_INTRA.R10B_FETE_FIN_ANNEE)

    // R8b (⚪ SI_POSSIBLE)
    const r8b = penaliteInversionFerie(sr.slot, vet, sr.role, planning)
    if (r8b > 0)
      ajouter(v, Etage.SI_POSSIBLE, 'R8b', POIDS_INTRA.R8B_INVERSION_FERIE)
  }

  // Dernier recours (⚪ SI_POSSIBLE) — terme dominant dans son étage.
  // Compte les gardes attribuées à un véto dernier-recours.
  {
    const drIds = new Set(vets.filter((x) => x.dernier_recours).map((x) => x.id))
    let nbDR = 0
    for (const sr of slotRoles) if (drIds.has(sr.vetId)) nbDR++
    if (nbDR > 0)
      ajouter(v, Etage.SI_POSSIBLE, 'dernier_recours', nbDR * POIDS_INTRA.DERNIER_RECOURS)
  }

  // ── Étage 6 : ÉQUITÉ (variance des charges) ──
  const compteurs = compterParVet(planning, vets)
  const eq =
    desequilibreWE(compteurs) * POIDS_INTRA.EQ_WE +
    desequilibreWeekendPremier(compteurs) * POIDS_INTRA.EQ_WE_PREMIER +
    desequilibreFeries(compteurs) * POIDS_INTRA.EQ_FERIES +
    desequilibreSemainePremier(compteurs) * POIDS_INTRA.EQ_SEMAINE_PREMIER +
    desequilibreSemaineSecond(compteurs) * POIDS_INTRA.EQ_SEMAINE_SECOND +
    desequilibreGrandsWeSalaries(compteurs, vets) * POIDS_INTRA.EQ_GRANDS_WE
  // L'équité est continue : on arrondit pour garder un entier déterministe
  // (variance × poids → on multiplie par 1000 et on arrondit, pour ne pas
  // perdre la finesse sous l'entier).
  ajouter(v, Etage.EQUITE, 'equite-variance', Math.round(eq * 1000))

  return v
}

// ── Tie-break déterministe (§3.2 D-R2) ───────────────────

/**
 * Empreinte canonique stable d'un planning, pour départager deux solutions
 * de VecteurScore strictement égaux. Ordre : chronologique des créneaux,
 * puis (premier_id, second_id) en ordre d'ID véto.
 * Une empreinte plus petite (ordre lexicographique) gagne — règle stable.
 */
export function empreinteTieBreak(planning: PlanningPartiel): string {
  return [...planning.attributions]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type < b.type ? -1 : 1))
    .map((a) => `${a.date}|${a.type}|${a.premier_id ?? ''}|${a.second_id ?? ''}`)
    .join('//')
}
