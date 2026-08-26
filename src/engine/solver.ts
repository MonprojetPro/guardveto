// ============================================================
// GUARDVETO — Solver greedy V1 + LNS
// ============================================================
// Génère un planning complet et optimal pour une période donnée.
//
// Architecture (V2) :
//   1. genererSeedGreedy(input)  → solution initiale via backtracking
//   2. lnsHillClimbing(seed, input) → amélioration par LNS (destroy-repair)
//   3. genererPlanningPur(input) → orchestre seed + LNS
//
// Algorithme LNS (hill-climbing systématique, neighborhood = 1 semaine) :
//   - Détruire : supprimer toutes les attributions d'une semaine
//   - Réparer   : greedy pur sur les créneaux de cette semaine
//   - Accepter  : comparerScores(nouveau, actuel) < 0 (amélioration stricte)
//   - Itérer    : passes successives sur toutes les semaines → convergence
//
// API publique inchangée (compatible V1) :
//   - SolverInput   → ajoute le champ optionnel lnsTimeoutMs
//   - SolveResult   → inchangé
//   - genererPlanningPur(input)  → orchestration modifiée (seed + LNS)
//   - genererPlanning(periodeId) → inchangée (async, placeholder Supabase)
// ============================================================

import type {
  VetEngine,
  VetEngineNormalise,
  SlotGarde,
  PlanningPartiel,
  CodeCreneau,
  RoleGarde,
  Saison,
  AttributionGarde,
  CalendrierResolu,
} from './types'
import { jourIndex, addDays, estJourFerie, lundiDeSemaine } from './utils'
import { attributionVide, avecVet, clonerAttribution, estAttribue } from './attribution'
import { typeGardePourJour, plafondNuitSemaine } from './structure-creneaux'
import type { CreneauModele } from './creneau-modele'
import { normaliserContraintesVets } from './normaliserContraintes'
import { isValid } from './rules/hard-constraints'
import { penalite } from './rules/soft-constraints'
import { compterParVet, type CompteurVet } from './rules/optimization'
import { comparerScores, scorerPlanning, type VecteurScore, type BonusMalusMap } from './score-lexicographique'
import { DEFAULT_EQUITY_WEIGHTS, DEFAULT_ROLE_AVANTAGE_FINANCIER, type EquityWeights } from './equity-weights'
import {
  DEFAULT_STRUCTURE_CONFIG, compositionsSouples, rolesInterditsSouples,
  type StructureConfig, type PenalitesSouplesConfig,
  type CompositionEquipeRegle, type RoleInterditTagRegle,
} from './structure-config'
import { penaliteCompositionCandidat, penaliteRoleInterditCandidat } from './rules/composition-equipe'
import { penaliteDesiderataCandidat, biaisVolumeCandidat } from './rules/desiderata'
import { penaliteSeulementAvecCandidat } from './rules/seulement-avec'
import type { HistoriqueFetesResolu } from './historique-fete'
import type { DiagnosticImpasse } from './diagnostic'
import { construireDiagnostic, type CreneauStep, type ReSimuler } from './diagnostic'

// ── Types publics ────────────────────────────────────────

export interface SolverInput {
  /** Premier jour de la période — doit être un lundi */
  dateDebut: string
  /** Dernier jour de la période (inclusif) */
  dateFin: string
  saison: Saison
  vets: VetEngine[]
  /** Bonus/malus inter-périodes (R20). Passer {} si aucun. */
  bonusMalus: BonusMalusMap
  /**
   * BACKSTOP temps optionnel pour la phase LNS, en ms.
   *
   * Comportement (Lot 1 — déterminisme) :
   *   • `undefined` (défaut) → AUCUNE coupe au chrono. L'arrêt est 100 %
   *     déterministe : convergence (3 passes sèches) OU plafond `lnsMaxPasses`.
   *     C'est le mode recommandé (résultat reproductible → replay fiable).
   *   • `0` (sentinel) → SEED GREEDY SEUL. Le LNS n'est pas exécuté du tout.
   *   • `> 0` → garde-fou de sécurité EN PLUS du plafond de passes. ⚠️ Fournir
   *     une valeur > 0 RÉINTRODUIT du non-déterminisme (le nombre de passes
   *     dépend alors du CPU) : opt-in conscient, à réserver aux contextes où
   *     borner le temps prime sur la reproductibilité.
   */
  lnsTimeoutMs?: number
  /**
   * Plafond DÉTERMINISTE du nombre de passes LNS (garde-fou anti-boucle).
   * Une « passe » = un balayage complet de toutes les semaines. Le LNS
   * s'arrête au plus tard à `lnsMaxPasses` passes, indépendamment du CPU.
   * Défaut 40 (largement au-dessus de la convergence observée sur 12-17 sem).
   */
  lnsMaxPasses?: number
  /** Données calendaires résolues depuis Supabase. Fallback sur les listes en dur si absent. */
  calendrier?: CalendrierResolu
  /**
   * Effectif configurable : nombre de vétos la nuit en semaine (1 à 4).
   * Absent → repli sur la saison (hiver = 2, été = 1) — comportement historique.
   * Les vendredi_soir et week-ends suivent, eux, leur catalogue.
   *
   * Ce nombre PLAFONNE le `nbPlaces` du créneau `semaine_soir` : le moteur
   * retient le plus petit des deux. Il circule comme un nombre de bout en
   * bout — tant qu'il transitait en booléen « faut-il un second ? », tout
   * réglage ≥ 2 retombait à 2, et un cabinet réglé à 4 n'obtenait que 2 gardes
   * sans qu'aucun message ne le signale.
   */
  nbVetosSemaineSoir?: number
  /**
   * Poids d'équité configurables (curseurs par cabinet). Pilotent l'importance
   * relative de chaque dimension d'équité (week-ends, fériés, semaine…) à la
   * fois dans le scoring greedy/LNS (construction) et le scoreur global (départage).
   * Absent → DEFAULT_EQUITY_WEIGHTS (comportement historique, planning inchangé).
   */
  equityWeights?: EquityWeights
  /**
   * Config des règles structurelles R8/R9 (réglables). Désactivées → ignorées ;
   * fermes → bloquantes (comportement historique) ; souples → pénalité au scoring.
   * Absent → DEFAULT_STRUCTURE_CONFIG (les deux fermes/actives = planning inchangé).
   */
  structureConfig?: StructureConfig
  /**
   * Catalogue de créneaux du cabinet (fondamentaux universels — P1/P2). Absent
   * (contextes legacy / hors-cabinet) → le moteur retombe sur le mapping en dur
   * `typeGardePourJour`. Pour le catalogue par défaut, la dérivation est identique.
   */
  creneaux?: CreneauModele[]
  /**
   * Rôle portant l'AVANTAGE FINANCIER à équilibrer (R11b) — P4 slice 1.
   *   • absent (undefined) → défaut historique 'premier' (planning inchangé).
   *   • null → AUCUN rôle avantagé : le moteur n'équilibre pas le rôle (l'IA a
   *     appris qu'être 1er ne change rien pour ce cabinet).
   *   • autre label → l'avantage porte sur ce rôle.
   * Le WEIGHT reste la dimension d'équité `weekend_premier` (WE_PREMIER_ROLE).
   */
  roleAvantageFinancier?: string | null
  /**
   * Plafond de TEMPS (ms, horloge murale) du backtracking du seed — garde-fou
   * serverless (dette technique : pire cas infaisable vicieux non borné). Au-delà,
   * la recherche est COUPÉE proprement (échec `interrompu`), AVANT le timeout
   * serverless brutal. NON DÉTERMINISTE (dépend de la machine) : à ne fournir que
   * sur le chemin serveur (route /generate). Absent (undefined) → aucune coupe au
   * chrono (tests/bancs = 100 % reproductibles). Le plafond de NŒUDS, lui, est
   * toujours actif mais fixé très haut (jamais atteint par un cas réalisable).
   */
  seedDeadlineMs?: number
  /**
   * Plafond de NŒUDS du backtracking du seed (déterministe). Défaut interne très
   * élevé (`MAX_NOEUDS_SEED`) : jamais atteint par un cas réalisable → byte-identique.
   * Exposé surtout pour les tests (prouver la coupe sur un cas pathologique).
   */
  seedMaxNoeuds?: number
  /**
   * #17 (Vague 5) — LOOKBACK INTER-PÉRIODES. Attributions FIGÉES de la fin de la
   * période PRÉCÉDENTE (~10 jours avant `dateDebut`), chargées best-effort par le
   * loader. Sert UNIQUEMENT aux règles de RYTHME (R10, R3, au_plus_n fenêtre,
   * espacement_min, espacement_weekend) pour ne pas être aveugle à la jonction de
   * deux périodes (ex. deux week-ends consécutifs à cheval). Il ne crée AUCUN slot
   * et ne compte dans AUCUNE équité/couverture. Absent/vide → comportement
   * historique BYTE-IDENTIQUE (les golden tests passent sans modification).
   */
  contexteAnterieur?: AttributionGarde[]
}

// Le plafond d'une nuit de semaine vient de `plafondNuitSemaine`
// (structure-creneaux.ts), partagé avec le validateur, le pré-vol, le contexte
// de crise et les places attendues — cf. son en-tête pour le pourquoi.

export interface JourNonCouvert {
  date: string
  type: CodeCreneau
  role: RoleGarde
  /** Raison de blocage si identifiable */
  contrainteBloquante?: string
}

export type SolveResult =
  | {
      success: true
      planning: PlanningPartiel
      /** Nombre de millisecondes pour générer le planning */
      dureeMs: number
    }
  | {
      success: false
      joursNonCouverts: JourNonCouvert[]
      /** Planning partiel jusqu'au point d'impasse */
      planningPartiel: PlanningPartiel
      dureeMs: number
      /**
       * Diagnostic d'impasse COMPLET (Palier 2, lots 1+2+3) : le VRAI créneau
       * bloquant capté pendant le backtracking (premier step sans aucun candidat
       * valide), + `reglesEnCause` + `suggestions` vérifiées par re-simulation.
       * Optionnel pour rétro-compat ; `joursNonCouverts` reste toujours fourni.
       */
      diagnostic?: DiagnosticImpasse
      /**
       * `true` = la recherche a été COUPÉE par le plafond de nœuds/temps du
       * backtracking (dette technique : pire cas non borné sous le maxDuration
       * serverless), et NON par une vraie impasse structurelle. On coupe alors
       * proprement, AVANT le timeout serverless brutal, en le disant à l'admin.
       * Le diagnostic d'impasse n'est PAS calculé dans ce cas (il re-simule).
       */
      interrompu?: boolean
      /** Message clair d'interruption (présent uniquement si `interrompu`). */
      raisonInterruption?: string
    }

// ── Types internes ───────────────────────────────────────

// Exporté pour le module de gestion de crise (crise/reparer.ts) qui réutilise
// `scorerCandidatLNS` afin de garantir une cohérence EXACTE entre le score de
// construction (greedy/LNS) et le score d'un remplaçant proposé. Type structurel
// minimal d'un créneau à pourvoir — ne PAS confondre avec CreneauStep (diagnostic).
export interface SolverStep {
  date: string
  type: CodeCreneau
  saison: Saison
  role: RoleGarde
  /** Ce créneau a-t-il besoin d'un 2nd ? (propagé au SlotGarde pour R17/R18). */
  besoinSecond: boolean
  /**
   * Liste COMPLÈTE des rôles du créneau (catalogue) — sert à créer l'attribution
   * avec les bonnes places déclarées (plus de places fantômes premier/second sur
   * un créneau à rôles custom). Absent (legacy) → défaut ['premier','second'].
   */
  rolesCreneau?: string[]
  /**
   * Nombre de places que le solver VA pourvoir sur ce créneau (backlog n°6 —
   * composition d'équipe). ≠ rolesCreneau.length quand l'effectif plafonne
   * (semaine_soir à 1 malgré 2 places déclarées) : c'est CE nombre qui décide
   * la « pose complétante » du check de composition. Absent (appels legacy,
   * crise) → le check lit les places de l'attribution réelle.
   */
  nbPlaces?: number
}

/**
 * Capture du PREMIER créneau réellement sans candidat valide rencontré par le
 * backtracking, AVEC l'état du planning partiel à ce moment-là.
 *
 * C'est le vrai point d'impasse (un step où `candidates.length === 0`), bien
 * plus fiable que `deepest` (step le plus profond atteint, qui peut être au-delà
 * du vrai blocage via des branches explorées puis abandonnées). Le `planning`
 * est une copie du contexte partiel au moment du blocage — les lots 2/3 s'en
 * serviront pour rejouer `isValid` dans le VRAI contexte (et non sur un planning
 * vide comme l'ancien diagnostic bogué).
 */
interface Blocage {
  step: SolverStep
  planning: PlanningPartiel
}

// ── Génération des créneaux ──────────────────────────────

/**
 * Génère la liste ordonnée des étapes à planifier.
 *
 * Ordre : vendredi_soir + weekend (tous les WE en chronologique)
 *         puis semaine_soir (tous les jours Mon-Thu en chronologique).
 *
 * Raison : les WE sont les créneaux les plus contraints (R9 lie
 * vendredi et WE, R3/R5 conditionne les repos de semaine sur le WE).
 * Les traiter en premier maximise l'élagage précoce du backtracking.
 */
/**
 * Étapes (slots à pourvoir) portées par UN jour donné. Source unique du mapping
 * jour→type pour le MOTEUR : genererSteps ET genererStepsSemaine y passent toutes
 * deux (c'étaient deux copies identiques). Le validateur indépendant garde, lui,
 * sa propre dérivation — cf. typeGardePourJour (structure-creneaux).
 */
function stepsForDay(
  date: string, saison: Saison, effectifSemaineSoir: number, creneaux?: CreneauModele[],
): SolverStep[] {
  const idx = jourIndex(date) // 0=dim … 6=sam

  // ── Chemin CATALOGUE (P3a-2, généralisé P3b) : slots pilotés par la donnée ──
  // TOUS les créneaux actifs non-fériés couvrant le jour émettent leurs places
  // (plus de « premier créneau seulement ») — l'unicité (cabinet, profil, code)
  // en base garantit qu'aucune paire (date, type) ne collisionne. Un code
  // SUR-MESURE est planifié génériquement ; seul un code null (jamais codifié)
  // ou 'ferie' (reclassification au scoring, pas un slot) est sans slot propre.
  // RÉCONCILIATION effectif : seul `semaine_soir` est plafonné par l'effectif
  // configurable — les autres créneaux émettent toutes leurs places. Pour le
  // catalogue par DÉFAUT (un seul créneau par jour, codes historiques), le
  // résultat est byte-identique à l'ancien comportement (banc d'équivalence).
  //
  // ⚠️ L'effectif circule ici comme un NOMBRE (1 à 4), plus comme un booléen
  // « il faut un second ». Tant qu'il transitait en booléen, l'information
  // était écrasée en route : un cabinet réglé à 3 vétérinaires le soir voyait
  // `effectif >= 2` devenir `true`, puis `true` redevenir `2`. Le plafond
  // rabotait donc à 2 un créneau qui en demandait 3 ou 4, sans que rien ne le
  // signale — le planning sortait simplement plus petit que demandé.
  if (creneaux && creneaux.length > 0) {
    const steps: SolverStep[] = []
    for (const c of creneaux) {
      if (!c.actif || c.surFeries || !c.joursSemaine.includes(idx)) continue
      const t = c.code
      if (t === null || t === 'ferie') continue
      const nbAEmettre = t === 'semaine_soir'
        ? Math.min(c.nbPlaces, effectifSemaineSoir)
        : c.nbPlaces
      const roles = c.roles.slice(0, nbAEmettre)
      const besoinSecond = nbAEmettre >= 2 // « le créneau a-t-il ≥ 2 places ? » (R17/R18)
      for (const role of roles) {
        steps.push({ date, type: t, saison, role, besoinSecond, rolesCreneau: c.roles, nbPlaces: nbAEmettre })
      }
    }
    return steps
  }

  // ── Chemin LEGACY (hors-catalogue) : mapping + 2 rôles en dur, INCHANGÉ ──
  const t = typeGardePourJour(idx)
  if (t === 'vendredi_soir' || t === 'weekend') {
    // Vendredi soir / week-end → toujours 2 de garde.
    return [
      { date, type: t, saison, role: 'premier', besoinSecond: true, nbPlaces: 2 },
      { date, type: t, saison, role: 'second', besoinSecond: true, nbPlaces: 2 },
    ]
  }
  if (t === 'semaine_soir') {
    // Lundi à jeudi. Effectif : 2 (1er + 2nd) ou 1 (1er seul).
    //
    // Ce chemin ne connaît QUE ces deux rôles — il sert les contextes sans
    // catalogue de créneaux, où il n'existe aucun libellé de 3ᵉ ni de 4ᵉ place
    // à donner aux gardes. On borne donc à 2 : au-delà, c'est le catalogue qui
    // décrit l'organisation, et c'est le chemin du dessus qui s'applique.
    const besoinSecondSemaine = effectifSemaineSoir >= 2
    const nbPlaces = besoinSecondSemaine ? 2 : 1
    const steps: SolverStep[] = [
      { date, type: t, saison, role: 'premier', besoinSecond: besoinSecondSemaine, nbPlaces },
    ]
    if (besoinSecondSemaine) {
      steps.push({ date, type: t, saison, role: 'second', besoinSecond: true, nbPlaces })
    }
    return steps
  }
  return [] // dimanche : couvert par le weekend du samedi → aucun slot propre
}

function genererSteps(
  dateDebut: string, dateFin: string, saison: Saison, nbVetosSemaineSoir?: number,
  creneaux?: CreneauModele[],
): SolverStep[] {
  const weSteps: SolverStep[] = []
  const semaineSteps: SolverStep[] = []
  // Le NOMBRE, pas « faut-il un second » : c'est lui que le plafond du
  // catalogue doit comparer à `nbPlaces` (cf. `stepsForDay`).
  const effectifSoir = plafondNuitSemaine(
    saison, nbVetosSemaineSoir, Boolean(creneaux && creneaux.length > 0),
  )

  let current = dateDebut
  while (current <= dateFin) {
    for (const s of stepsForDay(current, saison, effectifSoir, creneaux)) {
      (s.type === 'semaine_soir' ? semaineSteps : weSteps).push(s)
    }
    current = addDays(current, 1)
  }

  return [...weSteps, ...semaineSteps]
}

// ── Scoring des candidats ────────────────────────────────

/**
 * La PLACE qu'occupe ce step dans son créneau (0 = première). On la lit dans le
 * catalogue (`rolesCreneau`) et non dans le nom du rôle : un cabinet renomme
 * ses places comme il veut, et un scoring qui dépendrait de ces mots ne
 * survivrait pas au premier renommage. Repli sur les noms historiques quand le
 * step vient du chemin legacy (pas de catalogue).
 */
function placeDuStep(step: SolverStep): number {
  const i = step.rolesCreneau?.indexOf(step.role)
  if (typeof i === 'number' && i >= 0) return i
  return step.role === 'premier' ? 0 : 1
}


/**
 * Malus d'équité du rôle portant l'AVANTAGE FINANCIER (R11b) — P4 slice 1.
 *
 * Le rôle avantagé est équilibré : un véto qui l'a déjà eu souvent
 * (`compteurRoleAvantage`) est déprioritisé pour l'obtenir encore (+poids) et
 * priorisé pour les autres rôles (−poids). N'agit que sur `vendredi_soir` (le
 * duo du week-end via R9), comme historiquement. `roleAvantage === null` →
 * aucun équilibrage (le rôle ne confère aucun avantage pour ce cabinet).
 *
 * ÉQUIVALENCE : avec le défaut `roleAvantage = 'premier'`, redonne EXACTEMENT
 * l'ancien code (premier → −w, second → +w) — prouvé par le banc.
 */
/**
 * Équité v1 des créneaux SUR-MESURE (P3b) : étalement simple par code.
 * Les 6 dimensions d'équité nommées ne connaissent pas ces créneaux ; à défaut,
 * on compte les gardes du MÊME code déjà tenues par le véto — le moins servi
 * est prioritaire. Poids SEMAINE_PREMIER (proxy raisonnable d'une garde
 * « ordinaire »). Ne s'applique JAMAIS aux codes historiques → byte-identique.
 */
function compterGardesDuCode(planning: PlanningPartiel, type: string, vetId: string): number {
  let n = 0
  for (const a of planning.attributions) {
    if (a.type === type && estAttribue(a, vetId)) n++
  }
  return n
}

/** Le code fait-il partie des types HISTORIQUES à sémantique câblée ? */
function estCodeHistorique(type: string): boolean {
  return type === 'semaine_soir' || type === 'vendredi_soir' || type === 'weekend' || type === 'ferie'
}

function malusAvantageFinancier(
  step: SolverStep,
  roleAvantage: string | null,
  compteurRoleAvantage: number,
  poids: number,
): number {
  if (step.type !== 'vendredi_soir' || roleAvantage === null) return 0
  return step.role === roleAvantage
    ? -compteurRoleAvantage * poids
    : compteurRoleAvantage * poids
}

/**
 * Score d'un vétérinaire pour un créneau donné.
 * Score plus bas = vétérinaire prioritaire (moins de gardes, équité à rétablir).
 *
 * Composantes :
 *  - Compteur dans la dimension principale du créneau × son poids
 *  - Pénalité souple (R10 : WE consécutifs)
 *  - Bonus/malus inter-périodes (R20) : réduit le compteur effectif
 *  - Anne-Cat (dernier recours) → score maximal = essayée en dernier
 */
function scorerCandidat(
  step: SolverStep,
  vet: VetEngine,
  planning: PlanningPartiel,
  bonusMalus: BonusMalusMap,
  allVets: VetEngine[],
  weights: EquityWeights,
  calendrier?: CalendrierResolu,
  roleAvantageFinancier: string | null = DEFAULT_ROLE_AVANTAGE_FINANCIER,
  // Perf (audit 2026-07-03) : les compteurs ne dépendent QUE du planning —
  // identiques pour tous les candidats d'un même step. Le caller peut les
  // pré-calculer UNE fois par step au lieu d'une fois par comparaison de tri.
  compteursPrecalcules?: CompteurVet[],
  // Réglage des pénalités souples R10/R10c/R10b/R8b (backlog n°16).
  // Absent → poids historiques (byte-identique).
  penalitesSouples?: PenalitesSouplesConfig,
  // Historique des fêtes (backlog n°14). Absent/vide → 0 (byte-identique).
  historiqueFetes?: HistoriqueFetesResolu,
  // Composition d'équipe SOUPLE (backlog n°6). Absent/vide → 0 (byte-identique).
  compositions?: CompositionEquipeRegle[],
  // Rôle interdit par tag SOUPLE (backlog n°22). Absent/vide → 0 (byte-identique).
  rolesInterdits?: RoleInterditTagRegle[],
  // #17 — lookback inter-périodes. Absent/vide → 0 (byte-identique).
  contexteAnterieur?: AttributionGarde[],
): number {
  // Dernier recours → toujours en dernier.
  // Depuis B-046 (26/08/2026), ce score ne sert PLUS pendant une génération :
  // l'effectif y est filtré en amont (`engine/effectif.ts`) et aucun véto
  // dernier recours n'arrive jusqu'ici. Il sert toujours sur les chemins de
  // DÉPANNAGE (réparation d'absence, appel aux volontaires), qui gardent le
  // dernier recours dans l'effectif et se contentent de le proposer en dernier.
  if (vet.dernier_recours) return 1_000_000

  const compteurs =
    compteursPrecalcules ?? compterParVet(planning, allVets, roleAvantageFinancier, calendrier)
  const c = compteurs.find((x) => x.vetId === vet.id) ?? {
    vetId: vet.id,
    weGardes: 0,
    weekendPremier: 0,
    feriesGardes: 0,
    semainePremier: 0,
    semaineSecond: 0,
    semaineRenfort: 0,
    grandsWePerdus: 0,
  }
  const bm = bonusMalus[vet.id] ?? 0
  const pen = penalite(
    { date: step.date, type: step.type, saison: step.saison },
    vet,
    step.role,
    planning,
    calendrier,
    penalitesSouples,
    historiqueFetes,
    contexteAnterieur,
  ) + penaliteCompositionCandidat(
    // Composition d'équipe souple (n°6) — même « pose complétante » que le
    // gardien dur, à l'étage configuré (le scoreur global reste cohérent).
    { date: step.date, type: step.type, saison: step.saison, nbPlaces: step.nbPlaces },
    step.role, vet, planning, allVets, compositions,
  ) + penaliteRoleInterditCandidat(
    // Rôle interdit par tag souple (n°22).
    step.type, step.role, vet, rolesInterdits,
  ) + penaliteDesiderataCandidat(
    // Desiderata (n°7) : préférences positives du véto (jours/créneaux, avec X).
    { date: step.date, type: step.type, saison: step.saison, nbPlaces: step.nbPlaces },
    step.role, vet, planning,
  ) + penaliteSeulementAvecCandidat(
    // seulement_avec SOUPLE (#15b) : « A seulement avec B » à la pose complétante,
    // à l'étage configuré (le scoreur global reste cohérent). Dur → géré par isValid.
    { date: step.date, type: step.type, saison: step.saison, nbPlaces: step.nbPlaces },
    step.role, vet, planning,
  ) + biaisVolumeCandidat(vet) // « veut plus/moins de gardes » (terme signé du tri)

  // Créneau SUR-MESURE : équité d'étalement par code (jamais pour les codes
  // historiques — leurs branches nommées ci-dessous restent byte-identiques).
  if (!estCodeHistorique(step.type)) {
    return compterGardesDuCode(planning, step.type, vet.id) * weights.SEMAINE_PREMIER + pen
  }

  if (step.type === 'weekend' || step.type === 'vendredi_soir') {
    // R11 + R20 : équité WE — bonus/malus réduit le compteur effectif
    // Si bm > 0 (véto doit plus de gardes), son score est réduit → essayé avant
    const weEffectif = c.weGardes - bm

    // R11b : équité du rôle portant l'avantage financier (réglable — P4).
    // Défaut roleAvantageFinancier='premier' → byte-identique à l'historique
    // (premier → -w, second → +w). null → aucun équilibrage du rôle.
    const malusRole = malusAvantageFinancier(
      step, roleAvantageFinancier, c.weekendPremier, weights.WE_PREMIER_ROLE,
    )

    return weEffectif * weights.WE_GARDE + malusRole + pen
  }

  // Garde de semaine : priorité selon le type de jour et le rôle
  if (estJourFerie(step.date, calendrier)) {
    // R12 : équité fériés
    return c.feriesGardes * weights.FERIES + pen
  }

  const place = placeDuStep(step)
  if (place === 0) {
    // R13 : équité gardes semaine en 1er
    return c.semainePremier * weights.SEMAINE_PREMIER + pen
  }
  if (place === 1) {
    // R14 : équité 2nd de garde
    return c.semaineSecond * weights.SEMAINE_SECOND + pen
  }

  // 3ᵉ place et au-delà. Ce cas retombait dans la branche du 2nd : le candidat
  // était donc départagé sur un compteur qui ne comptait PAS ses gardes de
  // renfort — un coût figé, identique pour tout le monde, donc aucune raison
  // de répartir ces gardes équitablement.
  return c.semaineRenfort * weights.SEMAINE_RENFORT + pen
}

// ── Gestion du planning ──────────────────────────────────

/**
 * Retourne un nouveau planning avec le vétérinaire assigné au créneau+rôle.
 * Crée l'attribution si absente, ou complète premier_id / second_id.
 */
function assignerStep(
  planning: PlanningPartiel,
  step: SolverStep,
  vetId: string
): PlanningPartiel {
  const attributions = [...planning.attributions]
  const idx = attributions.findIndex(
    (a) => a.date === step.date && a.type === step.type
  )

  if (idx >= 0) {
    attributions[idx] = avecVet(attributions[idx], step.role, vetId)
  } else {
    // Places déclarées = rôles du créneau (catalogue). Legacy sans catalogue →
    // défaut ['premier','second'], miroir exact de l'ancien objet à 2 champs.
    attributions.push(
      avecVet(attributionVide(step.date, step.type, step.rolesCreneau), step.role, vetId)
    )
  }

  return { attributions }
}

// ── Backtracking ─────────────────────────────────────────

/**
 * Plafond de NŒUDS par défaut du backtracking du seed (déterministe).
 * Fixé TRÈS haut : un planning réalisable est trouvé de façon greedy en quelques
 * centaines à quelques milliers de nœuds (banc d'essai : 12 sem < 5 s). Ce plafond
 * n'est atteint QUE par un cas pathologique (infaisable vicieux à explosion
 * combinatoire) → zéro impact sur un cas réel (byte-identique).
 */
const MAX_NOEUDS_SEED = 2_000_000

/**
 * Budget de recherche du backtracking (garde-fou anti-explosion, dette technique).
 * Mutable, partagé par toute la récursion d'UN seed. `depasse` une fois vrai fait
 * remonter la pile SANS explorer davantage (échec `interrompu`, pas une impasse).
 */
interface SeedBudget {
  noeuds: number
  maxNoeuds: number
  /** Horloge murale absolue (performance.now) au-delà de laquelle on coupe, ou Infinity. */
  deadline: number
  depasse: boolean
}

/**
 * Backtracking récursif.
 *
 * @param steps     Liste ordonnée de toutes les étapes à planifier
 * @param index     Index courant dans `steps`
 * @param planning  Planning partiellement construit (immuable)
 * @param vets      Tous les vétérinaires
 * @param bonusMalus  Bonus/malus inter-périodes
 * @param deepest   Référence mutable : index le plus profond atteint (pour diagnostics)
 * @param blocage   Référence mutable : premier créneau réellement sans candidat
 *                  (avec son contexte partiel) — vrai point d'impasse (Lot 1)
 * @param budget    Référence mutable : plafond de nœuds/temps (coupe propre)
 * @returns         Planning complet si succès, null sinon
 */
function backtrack(
  steps: SolverStep[],
  index: number,
  planning: PlanningPartiel,
  vets: VetEngineNormalise[],
  bonusMalus: BonusMalusMap,
  weights: EquityWeights,
  structure: StructureConfig,
  deepest: { value: number },
  blocage: { value: Blocage | null },
  calendrier: CalendrierResolu | undefined,
  roleAvantageFinancier: string | null,
  budget: SeedBudget,
  // #17 — lookback inter-périodes (attributions figées de la période précédente).
  contexteAnterieur: AttributionGarde[] | undefined,
): PlanningPartiel | null {
  // Garde-fou de budget (plafond de nœuds/temps). Une fois dépassé, on remonte
  // la pile immédiatement sans explorer : coupe PROPRE avant le timeout serverless.
  if (budget.depasse) return null
  budget.noeuds++
  if (
    budget.noeuds > budget.maxNoeuds ||
    (budget.deadline !== Infinity && performance.now() > budget.deadline)
  ) {
    budget.depasse = true
    return null
  }

  // Cas de base : toutes les étapes sont planifiées
  if (index === steps.length) return planning

  // Trace de profondeur pour les diagnostics d'impasse
  if (index > deepest.value) deepest.value = index

  const step = steps[index]
  const slot: SlotGarde = { date: step.date, type: step.type, saison: step.saison, besoinSecond: step.besoinSecond, nbPlaces: step.nbPlaces }

  // Candidats valides (contraintes dures, R8/R9 selon config) triés par score.
  // Perf : compteurs calculés UNE fois par step + score UNE fois par candidat
  // (l'ancien comparateur recalculait tout à chaque comparaison de tri).
  // Ordre STRICTEMENT identique : mêmes valeurs, tri stable → byte-identique.
  const valides = vets.filter(
    (vet) => isValid(slot, vet, step.role, vets, planning, calendrier, structure, contexteAnterieur).valid
  )
  const compteursStep =
    valides.length > 1 ? compterParVet(planning, vets, roleAvantageFinancier, calendrier) : undefined
  const compositionsSouplesStep = compositionsSouples(structure)
  const rolesInterditsSouplesStep = rolesInterditsSouples(structure)
  const candidates = valides
    .map((vet) => ({
      vet,
      score: scorerCandidat(step, vet, planning, bonusMalus, vets, weights, calendrier, roleAvantageFinancier, compteursStep, structure.penalitesSouples, structure.historiqueFetes, compositionsSouplesStep, rolesInterditsSouplesStep, contexteAnterieur),
    }))
    .sort((a, b) => a.score - b.score)
    .map(({ vet }) => vet)

  // Aucun candidat valide DANS CE CONTEXTE PARTIEL RÉEL → vrai créneau bloquant.
  // On capte le PREMIER rencontré, avec une copie de l'état courant. C'est plus
  // fiable que `deepest` (qui peut pointer un step exploré au-delà du blocage).
  if (candidates.length === 0 && blocage.value === null) {
    blocage.value = {
      step,
      planning: { attributions: planning.attributions.map(clonerAttribution) },
    }
  }

  // Essaie chaque candidat dans l'ordre de priorité
  for (const vet of candidates) {
    const newPlanning = assignerStep(planning, step, vet.id)
    const result = backtrack(steps, index + 1, newPlanning, vets, bonusMalus, weights, structure, deepest, blocage, calendrier, roleAvantageFinancier, budget, contexteAnterieur)
    if (result !== null) return result
    // Budget épuisé pendant la descente → on arrête d'essayer d'autres candidats.
    if (budget.depasse) return null
  }

  // Aucun candidat n'a mené à une solution → backtrack
  return null
}

// ── Seed greedy (wrapper du backtracking existant) ────────

/**
 * genererSeedGreedy — Génère la solution initiale via backtracking greedy.
 * Renommé depuis l'ancien genererPlanningPur ; sert de seed pour le LNS.
 *
 * @param avecDiagnostic  Quand true (défaut), construit le diagnostic Lot 2/3 sur
 *   la branche échec (raisons fiables + suggestions par re-simulation). Mis à
 *   false lors des re-simulations internes (Lot 3) pour éviter toute récursion
 *   coûteuse (un seul niveau de re-sim, seed greedy uniquement).
 */
function genererSeedGreedy(input: SolverInput, avecDiagnostic = true): SolveResult {
  const { dateDebut, dateFin, saison, bonusMalus, calendrier } = input
  // Normalisation à l'entrée (idempotente) : les vétos passés à isValid DOIVENT
  // être normalisés (type VetEngineNormalise) — parade contre la cécité params.
  const vets = normaliserContraintesVets(input.vets)
  const weights = input.equityWeights ?? DEFAULT_EQUITY_WEIGHTS
  const structure = input.structureConfig ?? DEFAULT_STRUCTURE_CONFIG
  // R11b (P4) : absent → défaut historique 'premier' ; null explicite → aucun avantage.
  const roleAvantage = input.roleAvantageFinancier === undefined
    ? DEFAULT_ROLE_AVANTAGE_FINANCIER
    : input.roleAvantageFinancier
  const t0 = Date.now()

  const steps = genererSteps(dateDebut, dateFin, saison, input.nbVetosSemaineSoir, input.creneaux)
  const deepest = { value: -1 }
  const blocage: { value: Blocage | null } = { value: null }

  // Budget de recherche (garde-fou anti-explosion). Plafond de nœuds toujours
  // actif (déterministe, très haut → jamais atteint par un cas réalisable) ;
  // plafond de TEMPS optionnel (opt-in via input.seedDeadlineMs, chemin serveur).
  const budget: SeedBudget = {
    noeuds: 0,
    maxNoeuds: input.seedMaxNoeuds ?? MAX_NOEUDS_SEED,
    deadline:
      typeof input.seedDeadlineMs === 'number' && input.seedDeadlineMs > 0
        ? performance.now() + input.seedDeadlineMs
        : Infinity,
    depasse: false,
  }

  const planning = backtrack(
    steps,
    0,
    { attributions: [] },
    vets,
    bonusMalus,
    weights,
    structure,
    deepest,
    blocage,
    calendrier,
    roleAvantage,
    budget,
    input.contexteAnterieur,
  )

  const dureeMs = Date.now() - t0

  if (planning !== null) {
    return { success: true, planning, dureeMs }
  }

  // ── Interruption par le budget (nœuds/temps) ─────────
  // La recherche a été coupée AVANT de conclure : ce n'est PAS une impasse
  // structurelle prouvée. On renvoie un échec EXPLICITE et clair, sans calculer
  // le diagnostic d'impasse (qui re-simule le seed → re-explosion). L'admin est
  // invité à assouplir des règles ou réduire la période.
  if (budget.depasse) {
    return {
      success: false,
      joursNonCouverts: [],
      planningPartiel: { attributions: [] },
      dureeMs,
      interrompu: true,
      raisonInterruption:
        'La génération a été interrompue : le planning est trop contraint pour être ' +
        'résolu dans le temps imparti (recherche trop longue). Assouplissez certaines ' +
        'règles obligatoires, libérez des disponibilités ou réduisez la période, puis relancez.',
    }
  }

  // ── Impasse ──────────────────────────────────────────
  // Rapport legacy des jours non couverts (rétro-compat UI), basé sur le step
  // le plus profond atteint. Conservé tel quel pour ne rien casser en aval.
  const indexImpasse = Math.max(0, deepest.value)
  const joursNonCouverts: JourNonCouvert[] = steps.slice(indexImpasse).map((s) => {
    let contrainteBloquante: string | undefined
    if (s === steps[indexImpasse]) {
      const slot: SlotGarde = { date: s.date, type: s.type, saison: s.saison, besoinSecond: s.besoinSecond, nbPlaces: s.nbPlaces }
      const premierKo = vets
        // Défauts historiques (calendrier undefined, structure défaut) conservés
        // pour ne pas altérer ce message d'impasse legacy ; on ajoute seulement le
        // lookback #17 pour que la raison reflète la jonction de périodes.
        .map((v) => isValid(slot, v, s.role, vets, { attributions: [] }, undefined, DEFAULT_STRUCTURE_CONFIG, input.contexteAnterieur))
        .find((r) => !r.valid)
      contrainteBloquante = premierKo?.raison
    }
    return { date: s.date, type: s.type, role: s.role, contrainteBloquante }
  })

  // Le VRAI créneau bloquant = celui capté par le backtracking (premier step
  // sans candidat valide), AVEC son planning partiel réel. Repli défensif sur le
  // step `deepest` (planning vide) si — cas théorique — aucun blocage n'a été
  // capté (ex : aucun step du tout).
  const stepBloquant: SolverStep | undefined = blocage.value?.step ?? steps[indexImpasse]
  const planningBloquant: PlanningPartiel = blocage.value?.planning ?? { attributions: [] }

  let diagnostic: DiagnosticImpasse | undefined
  if (avecDiagnostic && stepBloquant) {
    // CreneauStep + steps complets (sous-ensemble structurel des SolverStep).
    const stepDiag: CreneauStep = {
      date: stepBloquant.date, type: stepBloquant.type,
      saison: stepBloquant.saison, role: stepBloquant.role, besoinSecond: stepBloquant.besoinSecond,
    }
    const stepsDiag: CreneauStep[] = steps.map((s) => ({
      date: s.date, type: s.type, saison: s.saison, role: s.role, besoinSecond: s.besoinSecond,
    }))

    // Re-simulation Lot 3 : relance UNIQUEMENT le seed greedy (jamais le LNS,
    // jamais de diagnostic récursif) avec les vétos / la structure modifiés.
    const resimuler: ReSimuler = (vetsModifies, structureModifiee) =>
      genererSeedGreedy(
        { ...input, vets: vetsModifies, structureConfig: structureModifiee },
        false,
      ).success

    diagnostic = construireDiagnostic({
      blocage: { step: stepDiag, planning: planningBloquant },
      input: { vets, calendrier, structureConfig: structure },
      steps: stepsDiag,
      joursNonCouverts,
      structure,
      resimuler,
    })
  }

  return {
    success: false,
    joursNonCouverts,
    planningPartiel: { attributions: [] },
    dureeMs,
    diagnostic,
  }
}

// ── LNS — utilitaires internes ───────────────────────────

/** Extrait tous les lundis de la période (borne inclusive). */
function extraireLundis(dateDebut: string, dateFin: string): string[] {
  const lundis: string[] = []
  let current = lundiDeSemaine(dateDebut)
  if (current < dateDebut) current = addDays(current, 7)
  while (current <= dateFin) {
    lundis.push(current)
    current = addDays(current, 7)
  }
  return lundis
}

/** Renvoie un planning sans les attributions de la semaine commençant par `lundi`. */
function supprimerSemaine(planning: PlanningPartiel, lundi: string): PlanningPartiel {
  const dimanche = addDays(lundi, 6)
  return {
    attributions: planning.attributions.filter(
      (a) => a.date < lundi || a.date > dimanche
    ),
  }
}

/** Génère les étapes (steps) d'une semaine donnée (lundi → dimanche inclus). */
function genererStepsSemaine(
  lundi: string, saison: Saison, nbVetosSemaineSoir?: number, creneaux?: CreneauModele[],
): SolverStep[] {
  const weSteps: SolverStep[] = []
  const semaineSteps: SolverStep[] = []
  // Le NOMBRE, pas « faut-il un second » : c'est lui que le plafond du
  // catalogue doit comparer à `nbPlaces` (cf. `stepsForDay`).
  const effectifSoir = plafondNuitSemaine(
    saison, nbVetosSemaineSoir, Boolean(creneaux && creneaux.length > 0),
  )

  for (let i = 0; i <= 6; i++) {
    const date = addDays(lundi, i)
    for (const s of stepsForDay(date, saison, effectifSoir, creneaux)) {
      (s.type === 'semaine_soir' ? semaineSteps : weSteps).push(s)
    }
  }

  return [...weSteps, ...semaineSteps]
}

/**
 * Scoring LNS — indépendant du bonusMalus (optim intra-période).
 * Poids d'équité passés en paramètre (curseurs cabinet) — mêmes poids que le
 * scoreur global via equity-weights.ts (source unique, repli DEFAULT).
 */
export function scorerCandidatLNS(
  step: SolverStep,
  vet: VetEngine,
  planning: PlanningPartiel,
  allVets: VetEngine[],
  weights: EquityWeights,
  calendrier?: CalendrierResolu,
  roleAvantageFinancier: string | null = DEFAULT_ROLE_AVANTAGE_FINANCIER,
  // Perf (audit 2026-07-03) : pré-calculables une fois par step (cf. scorerCandidat).
  compteursPrecalcules?: CompteurVet[],
  // Réglage des pénalités souples R10/R10c/R10b/R8b (backlog n°16).
  // Absent → poids historiques (byte-identique — les appels crise inchangés).
  penalitesSouples?: PenalitesSouplesConfig,
  // Historique des fêtes (backlog n°14). Absent/vide → 0 (byte-identique —
  // la crise ne le passe pas : réparation ciblée sans équité inter-annuelle).
  historiqueFetes?: HistoriqueFetesResolu,
  // Composition d'équipe SOUPLE (backlog n°6). Absent/vide → 0 (byte-identique).
  compositions?: CompositionEquipeRegle[],
  // Rôle interdit par tag SOUPLE (backlog n°22). Absent/vide → 0 (byte-identique).
  rolesInterdits?: RoleInterditTagRegle[],
  // #17 — lookback inter-périodes. Absent/vide → 0 (byte-identique — crise inchangée).
  contexteAnterieur?: AttributionGarde[],
): number {
  // Cf. `scorerCandidat` : inopérant en génération depuis B-046 (l'effectif y
  // est filtré en amont), toujours actif sur les chemins de dépannage.
  if (vet.dernier_recours) return 1_000_000

  const compteurs =
    compteursPrecalcules ?? compterParVet(planning, allVets, roleAvantageFinancier, calendrier)
  const c = compteurs.find((x) => x.vetId === vet.id) ?? {
    vetId: vet.id,
    weGardes: 0,
    weekendPremier: 0,
    feriesGardes: 0,
    semainePremier: 0,
    semaineSecond: 0,
    semaineRenfort: 0,
    grandsWePerdus: 0,
  }

  const pen = penalite(
    { date: step.date, type: step.type, saison: step.saison },
    vet,
    step.role,
    planning,
    calendrier,
    penalitesSouples,
    historiqueFetes,
    contexteAnterieur,
  ) + penaliteCompositionCandidat(
    // Composition d'équipe souple (n°6) — cohérente avec scorerCandidat.
    { date: step.date, type: step.type, saison: step.saison, nbPlaces: step.nbPlaces },
    step.role, vet, planning, allVets, compositions,
  ) + penaliteRoleInterditCandidat(
    // Rôle interdit par tag souple (n°22) — cohérente avec scorerCandidat.
    step.type, step.role, vet, rolesInterdits,
  ) + penaliteDesiderataCandidat(
    // Desiderata (n°7) — cohérente avec scorerCandidat.
    { date: step.date, type: step.type, saison: step.saison, nbPlaces: step.nbPlaces },
    step.role, vet, planning,
  ) + penaliteSeulementAvecCandidat(
    // seulement_avec SOUPLE (#15b) — cohérente avec scorerCandidat.
    { date: step.date, type: step.type, saison: step.saison, nbPlaces: step.nbPlaces },
    step.role, vet, planning,
  ) + biaisVolumeCandidat(vet)

  // Créneau SUR-MESURE : même équité d'étalement par code que scorerCandidat.
  if (!estCodeHistorique(step.type)) {
    return compterGardesDuCode(planning, step.type, vet.id) * weights.SEMAINE_PREMIER + pen
  }

  if (step.type === 'weekend' || step.type === 'vendredi_soir') {
    const malusRole = malusAvantageFinancier(
      step, roleAvantageFinancier, c.weekendPremier, weights.WE_PREMIER_ROLE,
    )
    return c.weGardes * weights.WE_GARDE + malusRole + pen
  }
  if (estJourFerie(step.date, calendrier)) return c.feriesGardes * weights.FERIES + pen
  const place = placeDuStep(step)
  if (place === 0) return c.semainePremier * weights.SEMAINE_PREMIER + pen
  if (place === 1) return c.semaineSecond * weights.SEMAINE_SECOND + pen
  return c.semaineRenfort * weights.SEMAINE_RENFORT + pen
}

/** Réparation greedy d'une semaine détruite. Retourne null si impasse. */
function repairerSemaine(
  partialPlanning: PlanningPartiel,
  steps: SolverStep[],
  vets: VetEngineNormalise[],
  weights: EquityWeights,
  structure: StructureConfig,
  calendrier: CalendrierResolu | undefined,
  roleAvantageFinancier: string | null,
  // #17 — lookback inter-périodes (mêmes règles de rythme qu'à la construction).
  contexteAnterieur?: AttributionGarde[],
): PlanningPartiel | null {
  let planning = partialPlanning

  for (const step of steps) {
    const slot: SlotGarde = { date: step.date, type: step.type, saison: step.saison, besoinSecond: step.besoinSecond, nbPlaces: step.nbPlaces }
    const valids = vets.filter((v) => isValid(slot, v, step.role, vets, planning, calendrier, structure, contexteAnterieur).valid)

    if (valids.length === 0) return null

    // Perf : compteurs UNE fois par step + score UNE fois par candidat
    // (byte-identique — cf. backtrack).
    const compteursStep =
      valids.length > 1 ? compterParVet(planning, vets, roleAvantageFinancier, calendrier) : undefined
    const sorted = valids
      .map((v) => ({
        v,
        score: scorerCandidatLNS(step, v, planning, vets, weights, calendrier, roleAvantageFinancier, compteursStep, structure.penalitesSouples, structure.historiqueFetes, compositionsSouples(structure), rolesInterditsSouples(structure), contexteAnterieur),
      }))
      .sort((a, b) => a.score - b.score)
      .map(({ v }) => v)

    const attributions = [...planning.attributions]
    const idx = attributions.findIndex(
      (a) => a.date === step.date && a.type === step.type
    )
    if (idx >= 0) {
      attributions[idx] = avecVet(attributions[idx], step.role, sorted[0].id)
    } else {
      attributions.push(
        avecVet(attributionVide(step.date, step.type, step.rolesCreneau), step.role, sorted[0].id)
      )
    }
    planning = { attributions }
  }

  return planning
}

// ── Score incrémental par semaine ────────────────────────

/**
 * scorerSemaine — calcule le VecteurScore en ne considérant que
 * les attributions appartenant à la semaine commençant par `lundi`.
 *
 * C'est le delta incrémental : évite de recalculer tout le planning
 * à chaque itération LNS. Retourne un vecteur partiel (étage EQUITE
 * non inclus car la variance est globale — on utilise scorerPlanning
 * complet pour les comparaisons finales).
 */
export function scorerSemaine(
  planning: PlanningPartiel,
  lundi: string,
  vets: VetEngineNormalise[],
  saison: Saison,
  weights: EquityWeights = DEFAULT_EQUITY_WEIGHTS,
  structure: StructureConfig = DEFAULT_STRUCTURE_CONFIG,
  roleAvantageFinancier: string | null = DEFAULT_ROLE_AVANTAGE_FINANCIER,
  calendrier?: CalendrierResolu,
  // #17 — lookback inter-périodes (transmis au scoreur pour R10 à la jonction).
  contexteAnterieur?: AttributionGarde[],
): VecteurScore {
  const dimanche = addDays(lundi, 6)
  const planSemaine: PlanningPartiel = {
    attributions: planning.attributions.filter(
      (a) => a.date >= lundi && a.date <= dimanche
    ),
  }
  return scorerPlanning(planSemaine, vets, saison, weights, structure, roleAvantageFinancier, calendrier, contexteAnterieur)
}

// ── LNS hill-climbing ────────────────────────────────────

interface LNSHillResult {
  planning: PlanningPartiel
  ameliorations: number
  passesSeches: number
  /** Le plafond déterministe de passes (lnsMaxPasses) a-t-il été atteint ? */
  plafondAtteint: boolean
  /** Le backstop temps OPTIONNEL (lnsTimeoutMs > 0) a-t-il coupé ? */
  timeoutAtteint: boolean
}

/** Plafond déterministe par défaut de passes LNS (garde-fou anti-boucle). */
const DEFAULT_LNS_MAX_PASSES = 40

/**
 * lnsHillClimbing — améliore `seedPlanning` par passes successives LNS.
 * Neighborhood = 1 semaine (destroy-repair greedy).
 * Critère d'acceptation : comparerScores(nouveau, actuel) < 0 (strict).
 *
 * ARRÊT (Lot 1 — déterminisme) :
 *   1. Convergence : `maxPassesSansAmelioration` passes sèches consécutives (3).
 *   2. Plafond déterministe : `lnsMaxPasses` passes totales (défaut 40).
 *   3. Backstop temps OPTIONNEL : seulement si `lnsTimeoutMs > 0` est fourni.
 *      Non fourni (undefined) → aucune coupe au chrono → résultat reproductible.
 *
 * IMPORTANT : ce wrapper n'est appelé que lorsque le LNS doit tourner. Le
 * sentinel `lnsTimeoutMs === 0` (= seed greedy seul) est intercepté EN AMONT
 * dans genererPlanningPur, qui ne nous appelle pas dans ce cas.
 */
function lnsHillClimbing(
  seedPlanning: PlanningPartiel,
  input: SolverInput,
  t0: number
): LNSHillResult {
  const { dateDebut, dateFin, saison, calendrier } = input
  // Normalisation à l'entrée (idempotente) — vétos exigés normalisés par isValid.
  const vets = normaliserContraintesVets(input.vets)
  const weights = input.equityWeights ?? DEFAULT_EQUITY_WEIGHTS
  const structure = input.structureConfig ?? DEFAULT_STRUCTURE_CONFIG
  const roleAvantage = input.roleAvantageFinancier === undefined
    ? DEFAULT_ROLE_AVANTAGE_FINANCIER
    : input.roleAvantageFinancier
  const contexteAnterieur = input.contexteAnterieur
  // Backstop temps : actif UNIQUEMENT si fourni > 0. Sinon, aucune coupe chrono
  // (déterministe). Le sentinel 0 ne nous parvient jamais (intercepté en amont).
  const timeoutMs =
    typeof input.lnsTimeoutMs === 'number' && input.lnsTimeoutMs > 0
      ? input.lnsTimeoutMs
      : Infinity
  const maxPasses =
    typeof input.lnsMaxPasses === 'number' && input.lnsMaxPasses > 0
      ? input.lnsMaxPasses
      : DEFAULT_LNS_MAX_PASSES
  const maxPassesSansAmelioration = 3

  let meilleur = seedPlanning
  let scoreMeilleur = scorerPlanning(meilleur, vets, saison, weights, structure, roleAvantage, calendrier, contexteAnterieur)

  const lundis = extraireLundis(dateDebut, dateFin)

  let passesSansAmelioration = 0
  let passesTotales = 0
  let ameliorations = 0
  let passesSeches = 0
  let plafondAtteint = false
  let timeoutAtteint = false

  while (passesSansAmelioration < maxPassesSansAmelioration) {
    // ── Plafond déterministe de passes (garde-fou anti-boucle) ──
    if (passesTotales >= maxPasses) {
      plafondAtteint = true
      break
    }
    // ── Backstop temps OPTIONNEL (non-déterministe, opt-in via lnsTimeoutMs>0) ──
    if (performance.now() - t0 >= timeoutMs) {
      timeoutAtteint = true
      break
    }

    let ameliorationCettePasse = false

    for (const lundi of lundis) {
      if (performance.now() - t0 >= timeoutMs) {
        timeoutAtteint = true
        break
      }

      // Détruire : supprimer la semaine
      const partial = supprimerSemaine(meilleur, lundi)
      const steps = genererStepsSemaine(lundi, saison, input.nbVetosSemaineSoir, input.creneaux).filter(
        (s) => s.date >= dateDebut && s.date <= dateFin
      )
      if (steps.length === 0) continue

      // Réparer : greedy LNS sur la semaine
      const repaired = repairerSemaine(partial, steps, vets, weights, structure, calendrier, roleAvantage, contexteAnterieur)
      if (repaired === null) continue

      // Comparer : garder si strictement amélioré
      const scoreNew = scorerPlanning(repaired, vets, saison, weights, structure, roleAvantage, calendrier, contexteAnterieur)
      if (comparerScores(scoreNew, scoreMeilleur) < 0) {
        meilleur = repaired
        scoreMeilleur = scoreNew
        ameliorations++
        ameliorationCettePasse = true
      }
    }

    passesTotales++

    if (ameliorationCettePasse) {
      passesSansAmelioration = 0
    } else {
      passesSansAmelioration++
      passesSeches++
    }
  }

  return { planning: meilleur, ameliorations, passesSeches, plafondAtteint, timeoutAtteint }
}

// ── API publique ─────────────────────────────────────────

/**
 * genererPlanningPur — Solver pur (sans Supabase).
 *
 * Orchestre :
 *   1. Seed greedy (backtracking) → solution initiale équitable
 *   2. LNS hill-climbing → amélioration du score lexicographique
 *
 * Retourne un planning complet ou un rapport d'impasse détaillé.
 * API publique compatible V1 (SolverInput + SolveResult inchangés).
 */
export function genererPlanningPur(input: SolverInput): SolveResult {
  const t0 = performance.now()

  // ── Normalisation des contraintes ────────────────────
  // Hisse config.params.* à la racine pour que TOUS les contrôles lisent la
  // règle, qu'elle soit V1 (plate) ou V2 (sous params). Sans ça, seul le duo
  // était appliqué (bug F4-002). Cf. normaliserContraintes.ts.
  // La normalisation est faite À L'ENTRÉE de genererSeedGreedy ET de
  // lnsHillClimbing (idempotente) : les vétos passés à isValid sont garantis
  // normalisés par le type VetEngineNormalise (impossible de l'oublier).

  // ── 1. Seed greedy ───────────────────────────────────
  const seed = genererSeedGreedy(input)

  if (!seed.success) {
    // Impasse backtracking → retourner directement le rapport d'impasse
    return {
      ...seed,
      dureeMs: performance.now() - t0,
    }
  }

  // ── Sentinel : lnsTimeoutMs === 0 → SEED GREEDY SEUL ──
  // On NE rentre PAS dans le LNS (saut total). Plusieurs filets en dépendent
  // (golden, golden-enforcement, diagnostic-impasse, équité, effectif) :
  // ils exigent le seed greedy pur, 100 % déterministe. Préservé explicitement
  // car le critère d'arrêt n'est plus piloté par le temps.
  if (input.lnsTimeoutMs === 0) {
    return {
      success: true,
      planning: seed.planning,
      dureeMs: performance.now() - t0,
    }
  }

  // ── 2. LNS hill-climbing (arrêt déterministe par défaut) ──
  const lnsResult = lnsHillClimbing(seed.planning, input, t0)

  return {
    success: true,
    planning: lnsResult.planning,
    dureeMs: performance.now() - t0,
  }
}

// ── Wrapper Supabase (à compléter après STORY-006) ───────

/**
 * genererPlanning — Charge les données depuis Supabase et génère le planning.
 *
 * TODO : implémenter le chargement Supabase quand le schéma est disponible.
 * Requiert les tables : periodes, veterinaires, contraintes, conges, bonus_malus.
 *
 * @param _periodeId  UUID de la période à planifier
 */
export async function genererPlanning(_periodeId: string): Promise<SolveResult> {
  throw new Error(
    'genererPlanning() nécessite le schéma Supabase (STORY-006). Utiliser genererPlanningPur() pour les tests.'
  )
}
