// ============================================================
// GUARDVETO — Diagnostic d'impasse (types partagés)
// ============================================================
// Quand la génération échoue, le moteur sait EXACTEMENT quel créneau n'a
// trouvé aucun candidat valide dans son contexte partiel réel (le step où
// `candidates.length === 0` dans le backtracking). Ce fichier pose le contrat
// de données partagé entre :
//   • le moteur (solver.ts) — REMPLIT le créneau bloquant + les règles en cause
//     + les suggestions vérifiées par re-simulation,
//   • l'UI (DiagnosticImpasse.tsx) — affiche le diagnostic + le bouton guidé
//     « Assouplir cette règle » (génération ET gestion de crise).
//
// ✅ Palier 2 COMPLET (lots 1+2+3) : `creneauBloquant`, `joursNonCouverts`,
// `reglesEnCause` ET `suggestions` (chacune VÉRIFIÉE par re-simulation avant
// d'être proposée comme actionnable) sont tous renseignés. Le diagnostic est
// éphémère (jamais persisté) : construit à l'échec, renvoyé tel quel à l'UI.
//
// ⚠️ Réutilise les types existants du moteur (TypeGardeEngine, RoleGarde,
// JourNonCouvert) — ne JAMAIS réinventer ces unions ici.
// ============================================================

import type {
  CodeCreneau, RoleGarde, VetEngine, SlotGarde, PlanningPartiel, Saison,
  CalendrierResolu, ContrainteEngine,
} from './types'
import type { JourNonCouvert } from './solver'
import { isValid } from './rules/hard-constraints'
import { normaliserContraintesVets } from './normaliserContraintes'
import { rendreRegle } from './briques/catalogue'
import type { StructureConfig, StructureRegleConfig } from './structure-config'

/**
 * Une règle identifiée comme cause (ou cause possible) du blocage d'un créneau.
 *
 * - `code`        : identifiant court de la règle (ex : 'R1', 'R8', 'R16', 'effectif').
 * - `libelle`     : libellé lisible par l'humain (affiché à l'utilisateur).
 * - `origine`     : famille de la règle (pilote l'action d'assouplissement possible).
 * - `vetId`       : véto concerné si la règle est individuelle (R1/R2/R3/R6/congé).
 * - `occurrences` : combien de fois cette règle a écarté un candidat sur le créneau.
 * - `contrainteId`: id de la contrainte individuelle en base (pour la cibler aux lots 2/3).
 * - `cleStructure`: clé de la règle structurelle réglable (R8 / R9) si origine === 'structurelle'.
 */
export interface RegleEnCause {
  code: string
  libelle: string
  origine: 'individuelle' | 'structurelle' | 'effectif' | 'conge'
  vetId?: string
  occurrences: number
  contrainteId?: string
  cleStructure?: 'r8_inversion' | 'r9_liaison'
}

/**
 * Le créneau réellement bloquant : celui qui, dans son contexte partiel réel,
 * n'avait plus aucun candidat valide. C'est le VRAI point d'impasse (pas le
 * step le plus profond atteint par le backtracking).
 */
export interface CreneauBloquant {
  date: string
  type: CodeCreneau
  role: RoleGarde
  /** Règles ayant écarté tous les candidats sur ce créneau (vide au Lot 1). */
  reglesEnCause: RegleEnCause[]
}

/**
 * Une suggestion d'assouplissement proposée à l'utilisateur pour débloquer la
 * génération. Remplie au Lot 3.
 *
 * - `verifiee` : la suggestion a-t-elle été REJOUÉE (simulée) et confirmée
 *   comme débloquant effectivement le créneau ? (false tant que non vérifiée).
 * - `action`   : action machine-applicable (cible = id de contrainte ou clé structurelle).
 */
export interface SuggestionAssouplissement {
  regle: RegleEnCause
  texte: string
  verifiee: boolean
  action: {
    type: 'assouplir_structurelle' | 'assouplir_contrainte' | 'desactiver_contrainte'
    cible: string
  }
}

/**
 * Diagnostic complet d'une impasse de génération.
 *
 * - `creneauBloquant` : le vrai créneau sans candidat (Lot 1, fiable).
 * - `reglesEnCause`   : agrégat des règles en cause au niveau du diagnostic (Lot 2 — vide au Lot 1).
 * - `suggestions`     : assouplissements proposés (Lot 3 — vide au Lot 1).
 * - `joursNonCouverts`: rétro-compat avec le rapport d'impasse existant (UI legacy).
 */
export interface DiagnosticImpasse {
  creneauBloquant: CreneauBloquant
  reglesEnCause: RegleEnCause[]
  suggestions: SuggestionAssouplissement[]
  joursNonCouverts: JourNonCouvert[]
}

// ============================================================
// LOT 2 — Raisons fiables (rejeu de isValid dans le VRAI contexte partiel)
// ============================================================
// Principe directeur (cohérence moteur ↔ validateur) : on rejoue EXACTEMENT
// le même `isValid` que le solver, avec le MÊME planning partiel capté au point
// de blocage et la MÊME `structureConfig`. C'est ce qui corrige le bug
// historique (ancien diagnostic qui rejouait sur un planning VIDE → raisons
// fausses). On agrège ensuite les raisons d'échec par CODE de règle.
//
// LOT 3 — Suggestions par re-simulation bornée (seed greedy uniquement).
// ============================================================

/** Étape minimale décrivant un créneau à valider (sous-ensemble du SolverStep). */
export interface CreneauStep {
  date: string
  type: CodeCreneau
  saison: Saison
  role: RoleGarde
  besoinSecond: boolean
}

/** Contexte d'entrée minimal requis par le diagnostic (sous-ensemble de SolverInput). */
export interface DiagnosticInput {
  vets: VetEngine[]
  calendrier?: CalendrierResolu
  structureConfig?: StructureConfig
}

/** Le blocage capté par le backtracking (créneau sans candidat + planning partiel). */
export interface BlocageDiag {
  step: CreneauStep
  planning: PlanningPartiel
}

/**
 * Callback de re-simulation (Lot 3) : relance UNIQUEMENT le seed greedy avec un
 * input modifié (règle relâchée) et renvoie `true` si un planning faisable est
 * trouvé. Injecté par le solver pour éviter une dépendance circulaire
 * diagnostic ↔ solver. NE doit JAMAIS rejouer le LNS (coûteux).
 */
export type ReSimuler = (vetsModifies: VetEngine[], structureModifiee: StructureConfig) => boolean

// ── Parsing du code de règle depuis la `raison` de isValid ─────────────────

/**
 * Extrait le code court depuis une raison française renvoyée par isValid.
 * Ex : "R3/R5 : Jean est en repos le vendredi" → "R3". "EFFECTIF" géré à part.
 * Renvoie null si aucun préfixe Rxx reconnaissable (jamais attendu en pratique).
 */
function extraireCode(raison: string): string | null {
  const m = /^R\d+/.exec(raison.trim())
  return m ? m[0] : null
}

/** Mappe un code de règle vers sa famille (origine) pour piloter l'assouplissement. */
function origineDeCode(code: string): RegleEnCause['origine'] {
  if (code === 'R16') return 'conge'
  if (code === 'R8' || code === 'R9') return 'structurelle'
  // R17/R18/R19/R21 sont des mécaniques d'effectif/rôle (pas une règle de cabinet).
  if (code === 'R17' || code === 'R18' || code === 'R19' || code === 'R21') return 'effectif'
  // R1/R2/R3/R6 (et R5 inclus dans R3) = règles individuelles configurées par véto.
  return 'individuelle'
}

/** Le type de contrainte (brique) correspondant à un code de règle individuelle. */
const CODE_VERS_TYPE_CONTRAINTE: Record<string, ContrainteEngine['type']> = {
  R1: 'jour_repos_fixe',
  R2: 'indisponibilite_cyclique',
  R3: 'jour_repos_conditionnel',
  R6: 'duo_interdit',
}

/** Le `brique` à utiliser pour rendreRegle (déduit du type, repli sur le type). */
function briqueDe(c: ContrainteEngine): string {
  const b = (c.config as Record<string, unknown>).brique
  return typeof b === 'string' ? b : c.type
}

/**
 * Retrouve la contrainte ACTIVE et DURE d'un véto qui correspond au code de règle
 * en cause sur ce créneau. Sert à récupérer `contrainteId` + produire un libellé
 * lisible via le catalogue (`rendreRegle`). Renvoie undefined si introuvable.
 */
function trouverContrainte(vet: VetEngine, code: string): ContrainteEngine | undefined {
  const typeAttendu = CODE_VERS_TYPE_CONTRAINTE[code]
  if (!typeAttendu) return undefined
  return vet.contraintes.find((c) => c.actif && c.type === typeAttendu)
}

/**
 * Construit un libellé lisible pour une règle individuelle. Réutilise EN PRIORITÉ
 * le catalogue (`rendreRegle`) — source unique des formulations françaises —, en
 * préfixant par le prénom du véto. Repli sur la raison brute de isValid si la
 * contrainte n'est pas retrouvée (jamais réécrit à la main).
 */
function libelleIndividuel(
  vet: VetEngine,
  contrainte: ContrainteEngine | undefined,
  raisonBrute: string,
  ctxRendu: { nomVeto?: (id: string) => string },
): string {
  if (contrainte) {
    const params = (contrainte.config as Record<string, unknown>).params
    const paramsRec = (params && typeof params === 'object' && !Array.isArray(params))
      ? (params as Record<string, unknown>)
      : (contrainte.config as Record<string, unknown>)
    const predicat = rendreRegle(briqueDe(contrainte), paramsRec, ctxRendu)
    return `${vet.prenom} ${predicat}`
  }
  return raisonBrute
}

/** Libellé d'une règle structurelle R8/R9 via le catalogue (brique liaison/inversion). */
function libelleStructurel(code: string): string {
  if (code === 'R9') {
    return rendreRegle('liaison_creneaux', { creneau_source: 'vendredi_soir', creneau_lie: 'weekend' })
  }
  // R8
  return rendreRegle('inversion_role', { creneau_a: 'vendredi_soir', creneau_b: 'weekend' })
}

// ── Agrégation des raisons sur un créneau ──────────────────────────────────

/** Une raison d'échec brute pour un véto sur un créneau donné. */
interface RaisonVet {
  code: string
  vetId: string
  raison: string
}

/**
 * Rejoue isValid pour CHAQUE véto sur un créneau dans son contexte partiel réel.
 * Renvoie la liste des raisons d'échec (une par véto écarté). Les vétos valides
 * (peu probable au créneau bloquant, mais possible aux autres créneaux) sont
 * ignorés.
 */
function raisonsSurCreneau(
  step: CreneauStep,
  planning: PlanningPartiel,
  input: DiagnosticInput,
  structure: StructureConfig,
): RaisonVet[] {
  const slot: SlotGarde = {
    date: step.date, type: step.type, saison: step.saison, besoinSecond: step.besoinSecond,
  }
  const out: RaisonVet[] = []
  // Auto-normalisation (idempotente) : isValid exige des vétos normalisés —
  // parade contre la cécité params (le diagnostic est un lecteur de règles).
  const vetsN = normaliserContraintesVets(input.vets)
  for (const vet of vetsN) {
    const res = isValid(slot, vet, step.role, vetsN, planning, input.calendrier, structure)
    if (res.valid) continue
    const raison = res.raison ?? 'créneau non couvert'
    const code = extraireCode(raison)
    if (!code) continue
    out.push({ code, vetId: vet.id, raison })
  }
  return out
}

/**
 * Compte combien de vétos ont été écartés par une « mécanique d'effectif »
 * (R17/R18/R19/R21) sur le créneau bloquant. Sert à détecter le cas EFFECTIF pur.
 */
function estCodeEffectifMecanique(code: string): boolean {
  return origineDeCode(code) === 'effectif'
}

// ── Construction du diagnostic complet (Lot 2 + Lot 3) ─────────────────────

export interface ConstruireDiagnosticArgs {
  blocage: BlocageDiag
  input: DiagnosticInput
  /** Tous les créneaux de la période (pour compter les occurrences globales). */
  steps: CreneauStep[]
  joursNonCouverts: JourNonCouvert[]
  structure: StructureConfig
  /** Re-simulation seed-greedy (Lot 3). Optionnel : sans lui, aucune suggestion. */
  resimuler?: ReSimuler
}

/** Nombre maximum de re-simulations (garde-fou perf strict — seed greedy only). */
const MAX_RESIMULATIONS = 3

/**
 * construireDiagnostic — remplit `reglesEnCause` (Lot 2) puis `suggestions`
 * (Lot 3) du diagnostic d'impasse. Appelée par le solver sur la branche échec
 * du seed greedy, avec le VRAI blocage capté pendant le backtracking.
 */
export function construireDiagnostic(args: ConstruireDiagnosticArgs): DiagnosticImpasse {
  const { blocage, input, steps, joursNonCouverts, structure, resimuler } = args

  const ctxRendu = {
    nomVeto: (id: string) => input.vets.find((v) => v.id === id)?.prenom ?? id,
  }

  // ── Lot 2.a — raisons sur le créneau bloquant (contexte partiel réel) ──────
  const raisonsBloquant = raisonsSurCreneau(blocage.step, blocage.planning, input, structure)

  // Détection EFFECTIF pur : aucune règle « réelle » (individuelle/structurelle/
  // congé) en cause — seules des mécaniques de rôle (R17/R18/R19/R21) écartent
  // les vétos, donc le vrai problème est qu'il n'y a pas assez de vétos distincts.
  const raisonsReelles = raisonsBloquant.filter((r) => !estCodeEffectifMecanique(r.code))

  // ── Lot 2.b — agrégation par code, en cumulant les occurrences sur TOUS les
  //     créneaux non encore couverts (balayage global) ───────────────────────
  // On part du créneau bloquant + des autres jours non couverts ; pour chacun on
  // rejoue isValid dans le planning partiel capté (approximation honnête : le
  // contexte exact d'un créneau futur n'existe pas, on utilise le même partiel).
  const autresSteps = steps.filter(
    (s) => !(s.date === blocage.step.date && s.type === blocage.step.type && s.role === blocage.step.role),
  )

  // clé d'agrégat : code + (vetId | structure) → RegleEnCause cumulée.
  const agregat = new Map<string, RegleEnCause>()

  const cumuler = (raisons: RaisonVet[]) => {
    for (const r of raisons) {
      // Les mécaniques d'effectif ne deviennent pas des RegleEnCause individuelles
      // (elles sont résumées par le fallback EFFECTIF si pertinent).
      if (estCodeEffectifMecanique(r.code)) continue

      const origine = origineDeCode(r.code)
      let cle: string
      let regle: RegleEnCause

      if (origine === 'structurelle') {
        const cleStructure: 'r8_inversion' | 'r9_liaison' = r.code === 'R8' ? 'r8_inversion' : 'r9_liaison'
        cle = `S:${r.code}`
        regle = agregat.get(cle) ?? {
          code: r.code,
          libelle: libelleStructurel(r.code),
          origine,
          occurrences: 0,
          cleStructure,
        }
      } else if (origine === 'conge') {
        cle = `C:${r.vetId}`
        regle = agregat.get(cle) ?? {
          code: r.code,
          libelle: r.raison, // R16 : la raison isValid contient déjà les dates du congé
          origine,
          vetId: r.vetId,
          occurrences: 0,
        }
      } else {
        // individuelle (R1/R2/R3/R6)
        const vet = input.vets.find((v) => v.id === r.vetId)
        const contrainte = vet ? trouverContrainte(vet, r.code) : undefined
        cle = `I:${r.code}:${r.vetId}:${contrainte?.id ?? ''}`
        regle = agregat.get(cle) ?? {
          code: r.code,
          libelle: vet ? libelleIndividuel(vet, contrainte, r.raison, ctxRendu) : r.raison,
          origine,
          vetId: r.vetId,
          occurrences: 0,
          contrainteId: contrainte?.id,
        }
      }

      regle.occurrences += 1
      agregat.set(cle, regle)
    }
  }

  cumuler(raisonsBloquant)
  for (const s of autresSteps) {
    cumuler(raisonsSurCreneau(s, blocage.planning, input, structure))
  }

  let reglesEnCause: RegleEnCause[] = [...agregat.values()].sort(
    (a, b) => b.occurrences - a.occurrences,
  )

  // ── Lot 2.c — Fallback EFFECTIF pur ───────────────────────────────────────
  // Si AUCUNE règle réelle n'écarte de candidat sur le créneau bloquant, c'est
  // un problème d'effectif (pas assez de vétos disponibles distincts).
  if (raisonsReelles.length === 0) {
    reglesEnCause = [
      {
        code: 'EFFECTIF',
        libelle: 'Pas assez de vétérinaires disponibles pour couvrir ce créneau',
        origine: 'effectif',
        occurrences: 1,
      },
      ...reglesEnCause,
    ]
  }

  // ── Lot 3 — Suggestions par re-simulation bornée ──────────────────────────
  const suggestions = resimuler
    ? construireSuggestions(reglesEnCause, input, structure, resimuler)
    : []

  return {
    creneauBloquant: {
      date: blocage.step.date,
      type: blocage.step.type,
      role: blocage.step.role,
      reglesEnCause,
    },
    reglesEnCause,
    suggestions,
    joursNonCouverts,
  }
}

// ── Lot 3 — Génération des suggestions ─────────────────────────────────────

/** Une règle est-elle AUTO-assouplissable (re-simulable) ? */
function estAssouplissable(regle: RegleEnCause): boolean {
  // Structurelle (R8/R9) → on peut passer son étage à souple.
  if (regle.origine === 'structurelle') return true
  // Individuelle d'étage ≤ 2 → on peut la passer en mou / la désactiver.
  if (regle.origine === 'individuelle' && regle.contrainteId) return true
  // Congé et effectif : NON auto-assouplissables (informatif honnête).
  return false
}

/** Relâche une contrainte véto (étage 3 = mou) en copiant les vétos (immutable). */
function relacherContrainte(vets: VetEngine[], contrainteId: string): VetEngine[] {
  return vets.map((v) => ({
    ...v,
    contraintes: v.contraintes.map((c) =>
      c.id === contrainteId
        ? { ...c, config: { ...(c.config as Record<string, unknown>), force: 3 } }
        : c,
    ),
  }))
}

/** Passe une règle structurelle de dure (étage ≤2) à souple (étage 3). */
function relacherStructure(
  structure: StructureConfig,
  cle: 'r8_inversion' | 'r9_liaison',
): StructureConfig {
  const r: StructureRegleConfig = { ...structure[cle], etage: 3 }
  return { ...structure, [cle]: r }
}

function construireSuggestions(
  reglesEnCause: RegleEnCause[],
  input: DiagnosticInput,
  structure: StructureConfig,
  resimuler: ReSimuler,
): SuggestionAssouplissement[] {
  const suggestions: SuggestionAssouplissement[] = []
  let resimulationsRestantes = MAX_RESIMULATIONS

  // Les 3 règles à plus fortes occurrences (déjà triées décroissant).
  for (const regle of reglesEnCause.slice(0, 3)) {
    if (!estAssouplissable(regle)) {
      // Congé / effectif → suggestion informative NON vérifiée (honnêteté).
      const texte =
        regle.origine === 'conge'
          ? `Un congé bloque ce créneau (${regle.libelle}). Décaler ou lever ce congé peut débloquer la génération — non vérifiable automatiquement.`
          : `Pas assez de vétérinaires disponibles pour ce créneau. Ajouter un véto disponible ou réduire l'effectif requis — non vérifiable automatiquement.`
      suggestions.push({
        regle,
        texte,
        verifiee: false,
        action: {
          type: 'assouplir_contrainte',
          cible: regle.contrainteId ?? regle.cleStructure ?? regle.code,
        },
      })
      continue
    }

    // Garde-fou perf strict : maximum 3 re-simulations seed-greedy.
    if (resimulationsRestantes <= 0) break
    resimulationsRestantes -= 1

    let faisable: boolean
    let action: SuggestionAssouplissement['action']

    if (regle.origine === 'structurelle' && regle.cleStructure) {
      const structureModifiee = relacherStructure(structure, regle.cleStructure)
      faisable = resimuler(input.vets, structureModifiee)
      action = { type: 'assouplir_structurelle', cible: regle.cleStructure }
    } else {
      // individuelle avec contrainteId
      const vetsModifies = relacherContrainte(input.vets, regle.contrainteId!)
      faisable = resimuler(vetsModifies, structure)
      action = { type: 'assouplir_contrainte', cible: regle.contrainteId! }
    }

    const nom = regleCourtNom(regle)
    suggestions.push({
      regle,
      texte: faisable
        ? `En assouplissant ${nom}, un planning redevient possible.`
        : `Assouplir ${nom} ne suffit pas seul à débloquer la génération.`,
      verifiee: faisable,
      action,
    })
  }

  return suggestions
}

/** Nom court et lisible d'une règle pour le texte de suggestion. */
function regleCourtNom(regle: RegleEnCause): string {
  if (regle.origine === 'structurelle') {
    return regle.cleStructure === 'r8_inversion'
      ? "la règle d'inversion des rôles (R8)"
      : 'la règle de liaison vendredi/week-end (R9)'
  }
  return `la règle « ${regle.libelle} »`
}
