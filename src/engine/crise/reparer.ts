// ============================================================
// GUARDVETO — Gestion de crise (Lot 2) : réparation CIBLÉE d'UN créneau
// ============================================================
// Quand une véto X s'absente après publication, un seul rôle d'un créneau de
// garde se libère. On veut proposer le MEILLEUR remplaçant LÉGAL pour ce seul
// rôle — SANS toucher au reste du planning (perturbation minimale). Ce n'est
// PAS une régénération : tous les autres créneaux restent GELÉS.
//
// Cohérence moteur ↔ validateur (impératif projet) :
//   • on rejoue EXACTEMENT le même `isValid` que la génération, avec la MÊME
//     `structure` (R8/R9) et le MÊME `calendrier` (fériés). Passer une structure
//     différente recréerait le piège connu : des « candidats légaux » qui
//     violent en réalité R8/R9 (cf. r8r9-reglables-deux-gardiens).
//   • on classe les candidats avec `scorerCandidatLNS` — le scoreur EXACT de la
//     construction greedy/LNS — pour proposer le moins chargé en tête (équité).
//   • aucun candidat légal → on réutilise `construireDiagnostic` (diagnostic.ts)
//     pour expliquer la règle en cause, comme à la génération.
//
// Fonction PURE et déterministe : aucune I/O, aucun Supabase. L'appelant fournit
// déjà des objets normalisés (vets, planning publié, calendrier, structure).
// ============================================================

import type {
  VetEngine,
  SlotGarde,
  PlanningPartiel,
  AttributionGarde,
  CodeCreneau,
  RoleGarde,
  Saison,
  CalendrierResolu,
} from '../types'
import { isValid, aGardeWeekendCetteSemaine } from '../rules/hard-constraints'
import { avecVet, clonerAttribution } from '../attribution'
import { normaliserContraintesVets } from '../normaliserContraintes'
import { scorerCandidatLNS, type SolverStep } from '../solver'
import { DEFAULT_EQUITY_WEIGHTS, type EquityWeights } from '../equity-weights'
import { DEFAULT_STRUCTURE_CONFIG, type StructureConfig } from '../structure-config'
import {
  construireDiagnostic,
  type DiagnosticImpasse,
  type CreneauStep,
} from '../diagnostic'

// ── Contrat d'entrée / sortie ────────────────────────────

/** Le créneau libéré par l'absence (un seul rôle d'une date+type). */
export interface CreneauCrise {
  /** Date ISO yyyy-MM-dd (lundi→jeudi pour semaine, vendredi, ou samedi pour WE). */
  date: string
  /** Type du créneau de garde (code du catalogue — historique ou sur-mesure). */
  type: CodeCreneau
  /** Rôle libéré à repourvoir (premier ou second). */
  role: RoleGarde
  /** Saison de la période (équité fériés / effectif). Défaut 'hiver'. */
  saison?: Saison
  /**
   * Ce créneau a-t-il besoin d'un 2nd ? Pertinent uniquement pour `semaine_soir`
   * (effectif réglable). Absent → repli sur la saison (hiver = 2, été = 1) ;
   * les vendredi_soir / weekend ont toujours besoin d'un 2nd.
   */
  besoinSecond?: boolean
}

/** Un candidat légal proposé pour le créneau libéré. */
export interface CandidatReparation {
  /** Id du véto proposé. */
  vetId: string
  /** Score d'équité (plus BAS = moins chargé = meilleur). */
  score: number
  /** Alertes non bloquantes (l'admin tranche) — ex : déjà de garde cette semaine. */
  warnings: string[]
}

/** Résultat d'une proposition de réparation ciblée. */
export interface ResultatReparation {
  /** Candidats LÉGAUX triés (meilleur d'abord). Vide si aucun. */
  candidats: CandidatReparation[]
  /** Id du véto recommandé (1er des candidats), ou null si aucun candidat légal. */
  meilleur: string | null
  /** Si aucun candidat légal : pourquoi (règle en cause). Absent sinon. */
  diagnostic?: DiagnosticImpasse
}

/** Paramètres de `proposerReparation` (fonction pure). */
export interface ProposerReparationParams {
  /** Le créneau libéré (un seul rôle). */
  creneau: CreneauCrise
  /** Le véto absent X — à EXCLURE des candidats. */
  absentId: string
  /** Tous les vétos (déjà normalisés). */
  vets: VetEngine[]
  /** Le planning publié actuel (complet). */
  planningComplet: AttributionGarde[]
  /** Calendrier résolu — DOIT être le même qu'à la génération. */
  calendrier?: CalendrierResolu
  /** Config R8/R9 — DOIT être la même qu'à la génération (sinon faux légaux). */
  structure?: StructureConfig
  /** Poids d'équité — mêmes curseurs qu'à la génération. Défaut historique. */
  equityWeights?: EquityWeights
  /** R11b — rôle à avantage financier (même réglage qu'à la génération).
   *  undefined → défaut moteur ('premier'). null → aucun équilibrage. */
  roleAvantageFinancier?: string | null
  /**
   * #17 — lookback inter-périodes (mêmes attributions figées de la période
   * précédente qu'à la génération). Sert aux règles de rythme quand le créneau à
   * réparer tombe en tout début de période (jonction). Absent/vide → byte-identique.
   */
  contexteAnterieur?: AttributionGarde[]
}

// ── Helpers internes ─────────────────────────────────────

/** Effectif semaine effectif : repli saison (hiver 2 / été 1) si non porté. */
function besoinSecondEffectif(creneau: CreneauCrise): boolean {
  if (creneau.type === 'weekend' || creneau.type === 'vendredi_soir') return true
  if (typeof creneau.besoinSecond === 'boolean') return creneau.besoinSecond
  return (creneau.saison ?? 'hiver') === 'hiver'
}

/**
 * Construit le planning partiel = planning publié MOINS le rôle libéré sur le
 * créneau de crise. TOUT le reste est GELÉ (perturbation minimale). On vide
 * uniquement le rôle concerné de l'attribution ciblée — on ne retire pas la row
 * (le binôme de l'autre rôle, lui, reste en place et compte pour R8/R9/R21).
 */
function construirePlanningPartiel(
  planningComplet: AttributionGarde[],
  creneau: CreneauCrise,
): PlanningPartiel {
  return {
    attributions: planningComplet.map((a): AttributionGarde => {
      if (a.date === creneau.date && a.type === creneau.type) {
        // Vide UNIQUEMENT la place du rôle libéré (le binôme reste en place).
        return avecVet(a, creneau.role, null)
      }
      // Copie défensive (immutabilité) — l'appelant garde son objet intact.
      return clonerAttribution(a)
    }),
  }
}

/** Le step structurel (pour scorerCandidatLNS) du créneau de crise. */
function stepDe(creneau: CreneauCrise): SolverStep {
  return {
    date: creneau.date,
    type: creneau.type,
    saison: creneau.saison ?? 'hiver',
    role: creneau.role,
    besoinSecond: besoinSecondEffectif(creneau),
  }
}

/** Le slot (pour isValid) du créneau de crise. */
function slotDe(creneau: CreneauCrise): SlotGarde {
  return {
    date: creneau.date,
    type: creneau.type,
    saison: creneau.saison ?? 'hiver',
    besoinSecond: besoinSecondEffectif(creneau),
  }
}

/**
 * Alertes non bloquantes pour un candidat valide (l'admin tranche, on n'exclut
 * pas). On signale notamment qu'un véto est DÉJÀ de garde sur le week-end lié à
 * cette semaine (charge cumulée intra-semaine — point de vigilance connu du
 * projet, cf. charge-gardes-meme-semaine). On y ajoute le statut dernier recours.
 */
function calculerWarnings(
  vet: VetEngine,
  creneau: CreneauCrise,
  planningPartiel: PlanningPartiel,
  validResult: { warning?: string },
): string[] {
  const warnings: string[] = []

  // Dernier recours (R7) : isValid le renvoie en warning — on le propage.
  if (validResult.warning) warnings.push(validResult.warning)

  // Déjà de garde le week-end lié à cette semaine (cumul intra-semaine).
  if (
    creneau.type !== 'weekend' &&
    creneau.type !== 'vendredi_soir' &&
    aGardeWeekendCetteSemaine(vet.id, creneau.date, planningPartiel)
  ) {
    warnings.push(
      `${vet.prenom} est déjà de garde le week-end de cette semaine — surcharge possible`,
    )
  }

  return warnings
}

// ── Point d'entrée ───────────────────────────────────────

/**
 * proposerReparation — propose le meilleur remplaçant LÉGAL pour UN créneau
 * libéré, sans toucher au reste du planning. Pure et déterministe.
 *
 * Logique :
 *   1. planningPartiel = planning publié MOINS le rôle libéré (reste GELÉ).
 *   2. pour chaque véto ≠ absentId : isValid(...) dans ce contexte partiel
 *      (mêmes structure + calendrier qu'à la génération) → on garde les valides.
 *   3. tri par scorerCandidatLNS (équité : le moins chargé en tête).
 *   4. warnings : signale les cas à l'œil sans exclure (l'admin tranche).
 *   5. zéro candidat → meilleur=null + diagnostic (règle en cause).
 */
export function proposerReparation(
  params: ProposerReparationParams,
): ResultatReparation {
  const { creneau, absentId, planningComplet } = params
  const calendrier = params.calendrier
  const structure = params.structure ?? DEFAULT_STRUCTURE_CONFIG
  const weights = params.equityWeights ?? DEFAULT_EQUITY_WEIGHTS
  // R11b : undefined → défaut moteur ; null explicite → aucun équilibrage.
  const roleAvantage = params.roleAvantageFinancier
  // #17 — lookback inter-périodes (jonction). Absent/vide → byte-identique.
  const contexteAnterieur = params.contexteAnterieur

  // ⚠️ NORMALISATION OBLIGATOIRE (parade cécité params — incident Fanny 2026-06-21) :
  // isValid lit la config des règles ; sans dépliage, les repos rangés sous
  // `params` étaient INVISIBLES ici → la crise proposait un véto que le validateur
  // rejetait ensuite. Le type VetEngineNormalise force désormais ce dépliage.
  const vets = normaliserContraintesVets(params.vets)

  const planningPartiel = construirePlanningPartiel(planningComplet, creneau)
  const slot = slotDe(creneau)
  const step = stepDe(creneau)

  // ── 2. Candidats légaux (absent exclu) ────────────────────────────────────
  const candidatsLegaux: CandidatReparation[] = []
  for (const vet of vets) {
    if (vet.id === absentId) continue // X exclu
    const res = isValid(slot, vet, creneau.role, vets, planningPartiel, calendrier, structure, contexteAnterieur)
    if (!res.valid) continue

    // #17 : le scoreur voit le même lookback (R10 à la jonction). On garde la
    // distinction undefined/défini de roleAvantage (byte-identique historique).
    const score = roleAvantage === undefined
      ? scorerCandidatLNS(step, vet, planningPartiel, vets, weights, calendrier, undefined, undefined, undefined, undefined, undefined, undefined, contexteAnterieur)
      : scorerCandidatLNS(step, vet, planningPartiel, vets, weights, calendrier, roleAvantage, undefined, undefined, undefined, undefined, undefined, contexteAnterieur)
    const warnings = calculerWarnings(vet, creneau, planningPartiel, res)
    candidatsLegaux.push({ vetId: vet.id, score, warnings })
  }

  // ── 3. Tri déterministe : score croissant, puis vetId (départage stable) ───
  candidatsLegaux.sort((a, b) =>
    a.score !== b.score ? a.score - b.score : a.vetId < b.vetId ? -1 : a.vetId > b.vetId ? 1 : 0,
  )

  if (candidatsLegaux.length > 0) {
    return { candidats: candidatsLegaux, meilleur: candidatsLegaux[0].vetId }
  }

  // ── 5. Aucun candidat légal → diagnostic (réutilise diagnostic.ts) ─────────
  // On exclut l'absent du jeu de vétos évalué par le diagnostic : il ne doit
  // PAS apparaître comme une « solution » à la règle en cause.
  const vetsHorsAbsent = vets.filter((v) => v.id !== absentId)
  const stepDiag: CreneauStep = {
    date: creneau.date,
    type: creneau.type,
    saison: creneau.saison ?? 'hiver',
    role: creneau.role,
    besoinSecond: besoinSecondEffectif(creneau),
  }

  const diagnostic = construireDiagnostic({
    blocage: { step: stepDiag, planning: planningPartiel },
    input: { vets: vetsHorsAbsent, calendrier, structureConfig: structure },
    steps: [stepDiag], // réparation ciblée : un seul créneau en jeu
    joursNonCouverts: [
      { date: creneau.date, type: creneau.type, role: creneau.role },
    ],
    structure,
    // pas de `resimuler` : on ne régénère JAMAIS le planning entier en crise.
  })

  return { candidats: [], meilleur: null, diagnostic }
}
