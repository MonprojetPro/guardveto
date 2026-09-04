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
import { compterParVet, ecartMaxMin, type CompteurVet } from './rules/optimization'
import { comparerScores, scorerPlanning, type VecteurScore, type BonusMalusMap } from './score-lexicographique'
import {
  DEFAULT_EQUITY_WEIGHTS, DEFAULT_ROLE_AVANTAGE_FINANCIER, SEUILS_CRITIQUES_DEFAUT,
  type EquityWeights, type EquityDimension,
} from './equity-weights'
import {
  DEFAULT_STRUCTURE_CONFIG, compositionsSouples, rolesInterditsSouples, relationsEffectives,
  type StructureConfig, type PenalitesSouplesConfig,
  type CompositionEquipeRegle, type RoleInterditTagRegle,
} from './structure-config'
import { penaliteCompositionCandidat, penaliteRoleInterditCandidat } from './rules/composition-equipe'
import { penaliteDesiderataCandidat, biaisVolumeCandidat } from './rules/desiderata'
import { penaliteSeulementAvecCandidat } from './rules/seulement-avec'
import {
  indexerFigees, stepsHorsFigees, attributionsDesFigees, reposerFigees, estFigee,
  prioriserCasesFigees, type PlaceFigee, type IndexFigees,
} from './figees'
import type { HistoriqueFetesResolu } from './historique-fete'
import type { DiagnosticImpasse } from './diagnostic'
import {
  construireDiagnostic, raisonsSurCreneau,
  type CreneauStep, type ReSimuler, type RaisonVet,
} from './diagnostic'

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
  /**
   * B-111 — LES PLACES CADENASSÉES PAR L'ADMIN. Elles sont posées d'emblée,
   * jamais reprises par aucune phase, et comptées dans l'équité comme dans les
   * règles de rythme (c'est tout l'objet : le moteur compose AUTOUR).
   *
   * Absent/vide → comportement historique byte-identique (les primitives de
   * `figees.ts` rendent l'entrée telle quelle quand l'index est vide).
   *
   * ⚠️ Une place figée n'est PAS un `contexteAnterieur` : celui-ci ne crée aucun
   * slot et ne compte dans aucune équité, alors qu'une figée occupe une place
   * réelle de la période et pèse sur tous les compteurs.
   */
  placesFigees?: PlaceFigee[]
  /**
   * B-060 — la passe de RATTRAPAGE qui reprend les cases vides une fois le
   * planning posé. Absente → aucune reprise.
   *
   * OPT-IN délibéré : le diagnostic d'impasse re-simule le moteur pour tester
   * ses suggestions, et une reprise déclenchée à chaque re-simulation
   * multiplierait le temps de calcul sans rien apporter à ce qu'il cherche.
   */
  rattrapage?: OptionsRattrapage
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
      /**
       * B-053 — CE QUE LE MOTEUR A QUAND MÊME PU REMPLIR.
       *
       * Ce champ existait depuis toujours dans ce type… et valait `{ attributions: [] }`
       * en dur, jamais lu par personne : une coquille vide. Il porte désormais le
       * résultat de `remplirAuMieux` — un planning presque complet, sans aucune
       * règle dure enfreinte. Une génération ne rend plus jamais les mains vides.
       */
      planningPartiel: PlanningPartiel
      /**
       * Les créneaux VRAIMENT impossibles, un par un, avec le pourquoi de chaque
       * vétérinaire écarté. À ne pas confondre avec `joursNonCouverts`, qui est
       * le rapport legacy : celui-ci liste tout ce qui SUIT le point d'arrêt du
       * backtracking, donc un seul blocage y rougit trois semaines (B-049).
       */
      creneauxVides?: CreneauVide[]
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

/**
 * Toutes les places à pourvoir sur une période — LA source unique de « ce que
 * le planning doit contenir ».
 *
 * Exportée (B-053) : la gate de publication doit savoir s'il reste des cases
 * vides, et elle DOIT le savoir avec la même règle que le moteur. Un second
 * calcul « places attendues » écrit à côté finirait par diverger, et on
 * publierait un planning troué en croyant l'inverse.
 */
export function genererSteps(
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

/** Moyenne d'une série. Vide → 0. */
function moyenne(valeurs: number[]): number {
  if (valeurs.length === 0) return 0
  return valeurs.reduce((t, v) => t + v, 0) / valeurs.length
}

/**
 * R11c (B-061) — LES WEEK-ENDS TENUS SANS JAMAIS AVOIR L'AVANTAGE.
 *
 * MiKL, en recette le 26/08 : « pourquoi Fanny ne fait pas un WE 1re de garde ?
 * Elle en fait 2 en 2nde, ce qui déséquilibre en plus le compteur ».
 *
 * CE QUE LA SONDE A MONTRÉ. Au week-end du 10/10, il ne restait que Fanny et
 * Anne-Sophie — et toutes deux à ZÉRO sur le compteur « 1er WE ». Leurs scores
 * étaient identiques (100 / 100) : rien ne les départageait. Le rôle se
 * décidait donc en amont, au vendredi, pour des raisons sans aucun rapport avec
 * l'avantage financier — et l'inversion R8 reléguait Fanny en 2nde.
 *
 * ⚠️ DEUX CORRECTIFS ONT ÉCHOUÉ AVANT CELUI-CI (écart à la moyenne sur « 1er
 * WE », puis malus étendu au week-end). Aucun ne pouvait marcher : ils pesaient
 * un compteur sur lequel les deux candidates étaient À ÉGALITÉ. Un écart nul ne
 * départage rien.
 *
 * CE QUI MANQUAIT VRAIMENT. Le moteur comptait combien de fois on a EU le rôle
 * avantagé, jamais combien de fois on l'a RATÉ. Fanny avait 1 week-end pour 0
 * fois le rôle — une occasion manquée ; Anne-Sophie 0 week-end — aucune. C'est
 * ce déséquilibre-là que voyait MiKL : pas « 0 », mais « 2 week-ends et 0 ».
 *
 * On équilibre donc `week-ends tenus − fois où on avait l'avantage`. Celui qui
 * en accumule sans jamais l'avantage devient prioritaire pour l'obtenir, et
 * déprioritaire pour reprendre l'autre rôle.
 */
function malusRoleRate(
  step: SolverStep,
  roleAvantage: string | null,
  weGardes: number,
  compteurRoleAvantage: number,
  moyenneRates: number,
  poids: number,
): number {
  if (step.type !== 'weekend' || roleAvantage === null) return 0
  const rates = weGardes - compteurRoleAvantage
  const ecart = rates - moyenneRates
  // Beaucoup de week-ends sans l'avantage → prioritaire pour l'obtenir (score
  // plus bas), et pénalisé pour reprendre le rôle qu'il a déjà trop tenu.
  return step.role === roleAvantage ? -ecart * poids : ecart * poids
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
 * AMPLIFICATION quand une dimension d'équité DÉCROCHE.
 *
 * POURQUOI CE FACTEUR EXISTE — et pourquoi l'étage lexicographique ne suffisait
 * pas (mesuré le 2026-09-01, avant de l'annoncer fait).
 *
 * L'étage `EQUITE_CRITIQUE` avait été posé dans `score-lexicographique` : il
 * classe correctement deux plannings. Mesure sur une génération complète, écart
 * de 6 gardes sur « second de semaine », soit le double du seuil : **aucune
 * différence.** Le correctif était inerte.
 *
 * La raison : le LNS détruit une semaine et la RÉPARE avec `scorerCandidat`
 * (ci-dessous), qui est déterministe et n'avait pas changé. Il reconstruisait
 * donc toujours la même semaine — et `comparerScores`, si bien ordonné soit-il,
 * n'avait jamais deux plannings différents à départager.
 *
 * Le classement ne sert à rien sans diversité à classer. Il faut donc que le
 * choix du candidat connaisse lui aussi le décrochage : au-delà du seuil, le
 * terme d'équité est amplifié pour qu'une pénalité souple (20 à 100 points) ne
 * puisse plus renverser un écart de garde (poids × 1). En dessous du seuil,
 * facteur 1 → byte-identique à l'historique.
 *
 * ⚠️ Leçon déjà payée sur ce projet : un correctif écrit n'est pas un correctif
 * exécuté. Celui-ci a été mesuré avant / après sur une vraie génération.
 */
const AMPLIFICATION_CRITIQUE = 10

/**
 * Le terme d'équité doit-il être amplifié pour cette dimension ?
 * Renvoie 1 (rien ne change) ou AMPLIFICATION_CRITIQUE.
 */
function facteurCritique(
  compteurs: CompteurVet[],
  dimension: EquityDimension,
  champ: 'weGardes' | 'weekendPremier' | 'feriesGardes' | 'semainePremier' | 'semaineSecond' | 'semaineRenfort',
  weights: EquityWeights,
): number {
  const seuil = weights.seuilsCritiques?.[dimension] ?? SEUILS_CRITIQUES_DEFAUT[dimension]
  if (!Number.isFinite(seuil) || seuil <= 0) return 1 // dimension désactivée
  return ecartMaxMin(compteurs.map((c) => c[champ])) > seuil ? AMPLIFICATION_CRITIQUE : 1
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

    return weEffectif * weights.WE_GARDE * facteurCritique(compteurs, 'weekend', 'weGardes', weights)
      + malusRole + pen
  }

  // Garde de semaine : priorité selon le type de jour et le rôle
  if (estJourFerie(step.date, calendrier)) {
    // R12 : équité fériés
    return c.feriesGardes * weights.FERIES
      * facteurCritique(compteurs, 'ferie', 'feriesGardes', weights) + pen
  }

  const place = placeDuStep(step)
  if (place === 0) {
    // R13 : équité gardes semaine en 1er
    return c.semainePremier * weights.SEMAINE_PREMIER
      * facteurCritique(compteurs, 'semaine_premier', 'semainePremier', weights) + pen
  }
  if (place === 1) {
    // R14 : équité 2nd de garde
    return c.semaineSecond * weights.SEMAINE_SECOND
      * facteurCritique(compteurs, 'semaine_second', 'semaineSecond', weights) + pen
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

// ── Remplissage AU MIEUX (B-053) ─────────────────────────
//
// Le backtracking est TOUT OU RIEN : un seul créneau sans candidat et il défait
// tout, jusqu'à ne rien rendre. Pour une admin, ça veut dire perdre l'intégralité
// du travail du moteur — trois semaines en rouge — à cause d'un enchaînement
// impossible sur un week-end. MiKL, le 26/08 : « t'imagine un client qui tombe
// là-dessus, il panique ».
//
// Cette passe est le filet : elle parcourt les créneaux DANS L'ORDRE, pose à
// chaque fois le meilleur candidat valide (mêmes règles dures, même scoring
// d'équité que le backtracking), et quand il n'y en a aucun, elle LAISSE LA CASE
// VIDE et continue. Aucun retour en arrière — donc linéaire, jamais d'explosion
// combinatoire, et le résultat est déterministe.
//
// Ce qu'elle n'est PAS : une solution optimale. Un choix glouton pris tôt peut
// créer un trou qu'un backtracking aurait évité. Elle ne s'exécute donc QUE
// lorsque la recherche complète a déjà échoué — jamais à la place.
//
// Effet de bord précieux : les créneaux vides qu'elle renvoie sont les VRAIS
// trous, un par un, avec le pourquoi de chaque véto écarté. C'est ce qui remplace
// le « 25 créneaux non couverts » de l'ancien rapport, qui comptait en réalité
// tout ce qui suivait le point d'arrêt (cf. B-049).

/**
 * Ce qu'on sait vraiment d'une case restée vide (B-060).
 *
 * `impossible_certain` — AUCUN vétérinaire ne peut tenir ce créneau, quelle que
 *   soit l'organisation du reste : chacun en est écarté par une règle qui ne
 *   dépend pas du planning (congé, repos fixe, indisponibilité). On peut donc
 *   affirmer « pas de solution sans intervention humaine ».
 * `non_trouve` — la recherche s'est arrêtée sans trouver. Une réorganisation
 *   plus large existe peut-être.
 *
 * ⚠️ La distinction n'est pas cosmétique. Dire « impossible » quand on a
 * seulement cherché sans trouver ferait lever un congé pour rien — c'est la
 * faute que toute la journée du 26/08 a consisté à corriger.
 */
export type StatutCaseVide = 'impossible_certain' | 'non_trouve'

/** Un créneau que le remplissage au mieux n'a pas pu pourvoir. */
export interface CreneauVide {
  date: string
  type: CodeCreneau
  role: RoleGarde
  /**
   * Pourquoi CHAQUE vétérinaire est écarté de CE créneau, dans le contexte réel
   * du planning au moment où on a essayé de le pourvoir. C'est le « pourquoi »
   * que l'écran doit montrer — jamais un code machine seul.
   */
  raisons: RaisonVet[]
  /** Ce qu'on peut honnêtement affirmer de cette case. Absent = pas encore jugé. */
  statut?: StatutCaseVide
}

export interface RemplissageAuMieux {
  /** Tout ce qui a pu être pourvu. */
  planning: PlanningPartiel
  /** Les créneaux réellement impossibles, dans l'ordre du calendrier. */
  creneauxVides: CreneauVide[]
}

// ── Les créneaux qui se décident ENSEMBLE (B-059) ────────
//
// MESURE DU 26/08 QUI A IMPOSÉ CE DÉCOUPAGE. Le remplissage pas-à-pas donnait :
//   vendredi 25/09 → Fanny (1re) + Antoine (2e)
//   week-end 26/09 → PERSONNE, les deux places
// alors que Victor et Jean étaient libres tout ce week-end-là. Pourquoi : R9
// impose au week-end le duo du vendredi, R8 impose l'inversion (Fanny doit
// passer 2e), et FREQ_WE interdit à Antoine un second week-end. Le choix du
// vendredi — pris AVANT, sans regarder plus loin — condamnait le week-end.
//
// MiKL, en recette : « pourquoi Victor ne fait pas la garde du week-end du 25 ?
// Il n'a aucun WE au compteur et n'est pas absent ». Il avait raison : le
// planning n'était pas contraint, il était mal ordonné.
//
// Un vendredi soir et son week-end ne sont pas deux décisions, c'en est UNE.
// Idem pour les deux places d'un même créneau : choisir le 1er sans regarder
// qui pourra être 2nd, c'est se condamner de la même façon.
//
// On regroupe donc les steps liés, et on décide le groupe d'un bloc — en
// minimisant d'abord le nombre de cases vides, puis le score d'équité. Les
// groupes sont minuscules (2 à 4 places), l'exploration reste bornée.

/** Fenêtre d'appariement des créneaux liés — miroir de `relations-structure`. */
const FENETRE_GROUPE_JOURS = 3

/** Plafond de nœuds par groupe. Jamais atteint sur un groupe réel (≤ 4 places). */
const MAX_NOEUDS_GROUPE = 20_000

/**
 * Regroupe les steps qui doivent se décider ensemble :
 *   • toutes les places d'un même créneau (même date + même type) ;
 *   • les créneaux unis par une relation de structure (vendredi ↔ week-end).
 *
 * L'ordre des groupes suit celui du premier step de chaque groupe : le
 * calendrier reste parcouru dans le même sens qu'avant.
 */
function grouperStepsLies(steps: SolverStep[], structure: StructureConfig): SolverStep[][] {
  const cle = (s: SolverStep) => `${s.date}|${s.type}`

  // Union-find minimal : chaque créneau pointe vers le représentant de son groupe.
  const parent = new Map<string, string>()
  const racine = (k: string): string => {
    let r = k
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const unir = (a: string, b: string) => {
    const ra = racine(a)
    const rb = racine(b)
    if (ra !== rb) parent.set(rb, ra)
  }

  for (const s of steps) if (!parent.has(cle(s))) parent.set(cle(s), cle(s))

  // Les créneaux liés par une relation : on cherche la SOURCE en arrière depuis
  // la cible, exactement comme `apparierSourcePourCible` le fait sur un planning.
  const creneaux = new Set(steps.map(cle))
  for (const rel of relationsEffectives(structure)) {
    for (const s of steps) {
      if (s.type !== rel.cibleCode) continue
      for (let k = 1; k <= FENETRE_GROUPE_JOURS; k++) {
        const source = `${addDays(s.date, -k)}|${rel.sourceCode}`
        if (creneaux.has(source)) {
          unir(source, cle(s))
          break
        }
      }
    }
  }

  const groupes = new Map<string, SolverStep[]>()
  const ordre: string[] = []
  for (const s of steps) {
    const r = racine(cle(s))
    if (!groupes.has(r)) {
      groupes.set(r, [])
      ordre.push(r)
    }
    groupes.get(r)!.push(s)
  }
  return ordre.map((r) => groupes.get(r)!)
}

/** Le meilleur remplissage d'un groupe : le moins de cases vides possible. */
interface ChoixGroupe {
  /** Une entrée par step du groupe, dans l'ordre : l'id posé, ou `null`. */
  affectation: (string | null)[]
  nbVides: number
  scoreTotal: number
}

/**
 * Décide un groupe d'un bloc, par exploration exhaustive bornée.
 *
 * Critère, dans cet ordre : ① le moins de cases vides — une garde pourvue vaut
 * mieux qu'un planning élégant ; ② le meilleur score d'équité à nombre de cases
 * égal. Les règles DURES ne sont jamais enfreintes : « laisser vide » est une
 * option, « poser quelqu'un qui n'a pas le droit » n'en est pas une.
 */
function resoudreGroupe(
  groupe: SolverStep[],
  planningInitial: PlanningPartiel,
  vets: VetEngineNormalise[],
  bonusMalus: BonusMalusMap,
  weights: EquityWeights,
  structure: StructureConfig,
  calendrier: CalendrierResolu | undefined,
  roleAvantage: string | null,
  contexteAnterieur: AttributionGarde[] | undefined,
): ChoixGroupe {
  let meilleur: ChoixGroupe = {
    affectation: groupe.map(() => null),
    nbVides: groupe.length,
    scoreTotal: Number.POSITIVE_INFINITY,
  }
  let noeuds = 0

  const explorer = (
    index: number,
    planning: PlanningPartiel,
    affectation: (string | null)[],
    nbVides: number,
    scoreTotal: number,
  ) => {
    if (noeuds++ > MAX_NOEUDS_GROUPE) return

    // Élagage : cette branche a déjà plus de trous que la meilleure connue.
    if (nbVides > meilleur.nbVides) return

    if (index === groupe.length) {
      if (nbVides < meilleur.nbVides || (nbVides === meilleur.nbVides && scoreTotal < meilleur.scoreTotal)) {
        meilleur = { affectation: [...affectation], nbVides, scoreTotal }
      }
      return
    }

    const step = groupe[index]
    const slot: SlotGarde = {
      date: step.date, type: step.type, saison: step.saison,
      besoinSecond: step.besoinSecond, nbPlaces: step.nbPlaces,
    }

    const valides = vets.filter(
      (v) => isValid(slot, v, step.role, vets, planning, calendrier, structure, contexteAnterieur).valid,
    )
    const compteurs =
      valides.length > 1 ? compterParVet(planning, vets, roleAvantage, calendrier) : undefined
    const candidats = valides
      .map((vet) => ({
        vet,
        score: scorerCandidat(
          step, vet, planning, bonusMalus, vets, weights, calendrier, roleAvantage,
          compteurs, structure.penalitesSouples, structure.historiqueFetes,
          compositionsSouples(structure), rolesInterditsSouples(structure), contexteAnterieur,
        ),
      }))
      .sort((a, b) => a.score - b.score)

    for (const { vet, score } of candidats) {
      affectation[index] = vet.id
      explorer(index + 1, assignerStep(planning, step, vet.id), affectation, nbVides, scoreTotal + score)
      affectation[index] = null
    }

    // Laisser la place vide — dernière option, jamais la première : on ne
    // renonce à une garde qu'après avoir essayé tout le monde.
    const planningAvecVide = planning.attributions.some((a) => a.date === step.date && a.type === step.type)
      ? planning
      : { attributions: [...planning.attributions, attributionVide(step.date, step.type, step.rolesCreneau)] }
    affectation[index] = null
    explorer(index + 1, planningAvecVide, affectation, nbVides + 1, scoreTotal)
  }

  explorer(0, planningInitial, groupe.map(() => null), 0, 0)
  return meilleur
}

/**
 * Le pourquoi de TOUS les vétérinaires écartés — sans exception.
 *
 * `raisonsSurCreneau` (diagnostic.ts) jette silencieusement toute raison qui ne
 * commence pas par un code `R<n>` (`extraireCode` renvoie null → `continue`).
 * C'est acceptable là où elle sert à compter des familles de règles ; ça ne l'est
 * pas ici, où la liste est MONTRÉE à l'admin comme la réponse à « pourquoi cette
 * case est vide ». Une exclusion muette laisserait croire que le vétérinaire
 * absent de la liste était disponible — la coquille vide que ce projet refuse.
 *
 * On garde donc `raisonsSurCreneau` comme source (mêmes libellés, aucune
 * ré-implémentation) et on complète les manquants avec leur raison brute.
 */
function raisonsCompletes(
  step: SolverStep,
  slot: SlotGarde,
  planning: PlanningPartiel,
  vets: VetEngineNormalise[],
  calendrier: CalendrierResolu | undefined,
  structure: StructureConfig,
  contexteAnterieur: AttributionGarde[] | undefined,
): RaisonVet[] {
  const raisons = raisonsSurCreneau(
    { date: step.date, type: step.type, saison: step.saison, role: step.role, besoinSecond: step.besoinSecond },
    planning,
    { vets, calendrier, structureConfig: structure },
    structure,
  )
  const deja = new Set(raisons.map((r) => r.vetId))
  for (const vet of vets) {
    if (deja.has(vet.id)) continue
    const res = isValid(slot, vet, step.role, vets, planning, calendrier, structure, contexteAnterieur)
    if (res.valid) continue // ne devrait pas arriver : la case est vide
    raisons.push({ code: 'AUTRE', vetId: vet.id, raison: res.raison ?? 'indisponible sur ce créneau' })
  }
  return raisons
}

/**
 * remplirAuMieux — pose le maximum de gardes, laisse vides celles qui n'ont
 * aucun candidat, et dit pourquoi pour chacune.
 *
 * Aucune règle DURE n'est enfreinte : un créneau vide est toujours préféré à une
 * garde illégale. Le produit informe, il n'invente pas — même principe que R21
 * (« si une règle ne peut pas être respectée, SIGNALER, ne jamais inventer »).
 */
export function remplirAuMieux(input: SolverInput): RemplissageAuMieux {
  const { dateDebut, dateFin, saison, bonusMalus, calendrier } = input
  const vets = normaliserContraintesVets(input.vets)
  const weights = input.equityWeights ?? DEFAULT_EQUITY_WEIGHTS
  const structure = input.structureConfig ?? DEFAULT_STRUCTURE_CONFIG
  const roleAvantage = input.roleAvantageFinancier === undefined
    ? DEFAULT_ROLE_AVANTAGE_FINANCIER
    : input.roleAvantageFinancier

  // B-111 — même principe qu'au seed : les cadenassées sont le point de départ,
  // et ne figurent pas dans ce qu'il reste à pourvoir. Elles ne peuvent donc pas
  // non plus être recensées comme « cases vides » — ce qu'elles ne sont pas.
  const figees = indexerFigees(input.placesFigees)
  const tousLesSteps = genererSteps(dateDebut, dateFin, saison, input.nbVetosSemaineSoir, input.creneaux)
  const steps = stepsHorsFigees(tousLesSteps, figees)

  let planning: PlanningPartiel = { attributions: attributionsDesFigees(figees, tousLesSteps) }
  const creneauxVides: CreneauVide[] = []

  // On avance GROUPE par groupe, et non place par place (B-059) : un vendredi
  // soir et son week-end se décident ensemble, comme les deux places d'un même
  // créneau. Décidés séparément, le premier choix condamne le second.
  for (const groupeBrut of grouperStepsLies(steps, structure)) {
    // Même raison qu'au seed : dans un bloc vendredi ↔ week-end dont une place
    // est cadenassée, la place restante de CETTE case se décide en premier.
    // `resoudreGroupe` explore dans l'ordre reçu, et l'affectation qu'il rend
    // est indexée dessus — on garde donc le groupe réordonné pour la relire.
    const groupe = prioriserCasesFigees(groupeBrut, figees)
    const choix = resoudreGroupe(
      groupe, planning, vets, bonusMalus, weights, structure, calendrier,
      roleAvantage, input.contexteAnterieur,
    )

    // ① On pose d'abord tout ce qui est pourvu. Les raisons des cases vides se
    //    lisent ENSUITE, dans le planning complété : sinon on expliquerait un
    //    trou par l'absence de ses propres voisins (« le 1er doit être désigné
    //    avant le 2nd »), qui est une conséquence et non une cause.
    groupe.forEach((step, i) => {
      const vetId = choix.affectation[i]
      if (vetId) planning = assignerStep(planning, step, vetId)
    })

    // ② Les cases restées vides : la garde EXISTE, elle est à pourvoir. Sans
    //    cette ligne, un créneau dont aucune place n'est pourvue n'apparaîtrait
    //    NULLE PART — ni en base, ni au calendrier. Le trou serait invisible.
    groupe.forEach((step) => {
      const existe = planning.attributions.some((a) => a.date === step.date && a.type === step.type)
      if (!existe) {
        planning = {
          attributions: [...planning.attributions, attributionVide(step.date, step.type, step.rolesCreneau)],
        }
      }
    })

    groupe.forEach((step, i) => {
      if (choix.affectation[i]) return
      const slot: SlotGarde = {
        date: step.date, type: step.type, saison: step.saison,
        besoinSecond: step.besoinSecond, nbPlaces: step.nbPlaces,
      }
      creneauxVides.push({
        date: step.date,
        type: step.type,
        role: step.role,
        raisons: raisonsCompletes(step, slot, planning, vets, calendrier, structure, input.contexteAnterieur),
      })
    })
  }

  return { planning, creneauxVides }
}

// ── LA PASSE DE RATTRAPAGE (B-060) ───────────────────────
//
// Idée de MiKL, le 26/08 : « pourquoi ne pas créer une étape supplémentaire qui
// viendrait vérifier ce qui a été produit et qui remplirait le reste des cases
// vides — ou en tout cas qui vérifierait une dernière fois qu'aucune solution
// n'est possible sauf intervention humaine ? »
//
// CE QU'ELLE RATTRAPE. Le remplissage décide bloc par bloc, dans l'ordre du
// calendrier. Le regroupement (B-059) a supprimé les trous causés par l'ordre à
// l'INTÉRIEUR d'un bloc (un vendredi qui condamne son week-end). Restent ceux
// causés par l'ordre ENTRE les blocs : une case du 14 octobre peut être vide à
// cause d'un choix fait le 3. Aucune passe unique ne peut voir ça — il faudrait
// tout réessayer, et c'est exactement ce qui fait exploser le calcul.
//
// COMMENT. On ne réessaie pas tout : pour chaque case vide, on défait ce qui
// l'ENTOURE (les jours voisins, les créneaux liés), on force un candidat sur la
// case, et on reconstruit ce petit morceau. On ne garde le résultat que si le
// nombre de places pourvues augmente STRICTEMENT — jamais un échange qui
// déshabille Pierre pour habiller Paul.
//
// CE QU'ELLE NE PROMET PAS. Ne rien trouver ne prouve rien. C'est pourquoi
// chaque case restante repart avec un statut honnête : `impossible_certain`
// quand personne ne peut y aller quoi qu'il arrive, `non_trouve` sinon.

/** Fenêtre de jours défaite autour d'une case vide, de part et d'autre. */
const FENETRE_RATTRAPAGE_JOURS = 7

export interface OptionsRattrapage {
  /** Temps maximum accordé. Épuisé → on s'arrête et on le DIT (`budgetEpuise`). */
  budgetMs?: number
  /** Progression, pour que l'écran raconte ce qui se passe vraiment. */
  onProgres?: (message: string) => void
}

export interface ResultatRattrapage extends RemplissageAuMieux {
  /** Nombre de places gagnées par la passe. */
  gagnees: number
  /** `true` = le temps a manqué. On ne peut donc RIEN conclure sur ce qui reste. */
  budgetEpuise: boolean
}

/**
 * Les vétérinaires qu'une règle INDÉPENDANTE DU PLANNING écarte de ce créneau.
 *
 * On rejoue `isValid` sur un planning VIDE : ce qui refuse encore là ne dépend
 * ni des autres gardes ni de l'ordre — congé, repos fixe, indisponibilité
 * cyclique. C'est ce qui permet de dire « impossible » sans mentir.
 */
function ecartesQuoiQuIlArrive(
  step: SolverStep,
  vets: VetEngineNormalise[],
  calendrier: CalendrierResolu | undefined,
  structure: StructureConfig,
): Set<string> {
  const slot: SlotGarde = {
    date: step.date, type: step.type, saison: step.saison,
    besoinSecond: step.besoinSecond, nbPlaces: step.nbPlaces,
  }
  const out = new Set<string>()
  for (const vet of vets) {
    // Rôle « premier » et planning vide : aucune règle de position ni de rythme
    // ne peut s'appliquer, seules les indisponibilités propres à la personne
    // subsistent. Un refus ici est donc structurel.
    const r = isValid(slot, vet, 'premier', vets, { attributions: [] }, calendrier, structure)
    if (!r.valid) out.add(vet.id)
  }
  return out
}

export function rattraperCasesVides(
  input: SolverInput,
  depart: RemplissageAuMieux,
  options?: OptionsRattrapage,
): ResultatRattrapage {
  const vets = normaliserContraintesVets(input.vets)
  const weights = input.equityWeights ?? DEFAULT_EQUITY_WEIGHTS
  const structure = input.structureConfig ?? DEFAULT_STRUCTURE_CONFIG
  const roleAvantage = input.roleAvantageFinancier === undefined
    ? DEFAULT_ROLE_AVANTAGE_FINANCIER
    : input.roleAvantageFinancier
  const calendrier = input.calendrier

  // B-111 — une place cadenassée n'est jamais « une case vide à combler » : elle
  // sort de `steps`, donc ni le recensement ni la reprise ne la voient comme un
  // trou. Les groupes, eux, gardent TOUS leurs steps : la reconstruction du
  // voisinage doit continuer de raisonner sur des blocs entiers (B-059), et
  // c'est `essayerDePourvoir` qui protège les places figées à l'intérieur.
  const figees = indexerFigees(input.placesFigees)
  const tousLesSteps = genererSteps(
    input.dateDebut, input.dateFin, input.saison, input.nbVetosSemaineSoir, input.creneaux,
  )
  const steps = stepsHorsFigees(tousLesSteps, figees)
  const groupes = grouperStepsLies(tousLesSteps, structure)

  const echeance = Date.now() + (options?.budgetMs ?? 15_000)
  const tempsEcoule = () => Date.now() > echeance

  let planning = depart.planning
  let vides = [...depart.creneauxVides]
  const departPourvues = comptePlacesPourvues(planning)
  let budgetEpuise = false

  // Point fixe : on recommence tant qu'un tour a gagné quelque chose. Une case
  // comblée peut en débloquer une autre.
  let tour = 0
  let progression = true
  while (progression && vides.length > 0 && !tempsEcoule()) {
    progression = false
    tour++
    options?.onProgres?.(
      `Reprise ${tour} — j'essaie de combler ${vides.length} case${vides.length > 1 ? 's' : ''} restante${vides.length > 1 ? 's' : ''}`,
    )

    for (const vide of [...vides]) {
      if (tempsEcoule()) { budgetEpuise = true; break }

      const step = steps.find(
        (s) => s.date === vide.date && s.type === vide.type && s.role === vide.role,
      )
      if (!step) continue

      const bloques = ecartesQuoiQuIlArrive(step, vets, calendrier, structure)
      const candidats = vets.filter((v) => !bloques.has(v.id))
      if (candidats.length === 0) continue // personne, quoi qu'on réorganise

      for (const candidat of candidats) {
        if (tempsEcoule()) { budgetEpuise = true; break }

        const essai = essayerDePourvoir(
          step, candidat, planning, groupes, vets, input.bonusMalus, weights,
          structure, calendrier, roleAvantage, input.contexteAnterieur, figees,
        )
        if (!essai) continue

        // On ne garde QUE si on a gagné des places. Un échange à somme nulle
        // rebattrait les cartes sans rien apporter — et rendrait le résultat
        // instable d'une génération à l'autre.
        if (comptePlacesPourvues(essai) > comptePlacesPourvues(planning)) {
          planning = essai
          progression = true
          options?.onProgres?.(`${candidat.prenom} peut finalement prendre le ${vide.date}`)
          break
        }
      }
    }

    if (progression) {
      vides = recenserVides(steps, planning, vets, calendrier, structure, input.contexteAnterieur)
    }
  }

  if (tempsEcoule()) budgetEpuise = true

  // Le statut de chaque case restante — dit une fois, à la fin, sur le planning
  // définitif. Si le temps a manqué, on ne conclut RIEN : on ne peut pas
  // affirmer l'impossible quand on n'a pas fini de chercher.
  const videsJugees = vides.map((v) => {
    const step = steps.find((s) => s.date === v.date && s.type === v.type && s.role === v.role)
    if (!step || budgetEpuise) return { ...v, statut: 'non_trouve' as StatutCaseVide }
    const bloques = ecartesQuoiQuIlArrive(step, vets, calendrier, structure)
    return {
      ...v,
      statut: (bloques.size === vets.length ? 'impossible_certain' : 'non_trouve') as StatutCaseVide,
    }
  })

  // R11c — dernier geste : rééquilibrer les rôles, sans jamais perdre une garde.
  options?.onProgres?.('Je vérifie le partage des premiers de garde…')
  const equilibre = equilibrerRolesWeekEnd(planning, input)

  return {
    planning: equilibre,
    creneauxVides: videsJugees,
    gagnees: comptePlacesPourvues(equilibre) - departPourvues,
    budgetEpuise,
  }
}

/** Le remplissage, puis la reprise — seulement si l'appelant l'a demandée. */
function avecRattrapage(input: SolverInput, depart: RemplissageAuMieux): RemplissageAuMieux {
  if (!input.rattrapage) return depart
  return rattraperCasesVides(input, depart, input.rattrapage)
}

/**
 * R11c (B-061) — RÉÉQUILIBRER LES RÔLES SANS JAMAIS PERDRE UNE GARDE.
 *
 * MiKL, en recette : « pourquoi Fanny ne fait pas un WE 1re de garde ? Elle en
 * fait 2 en 2nde, ce qui déséquilibre en plus le compteur ». Le compteur mesure
 * combien de fois on a EU le rôle avantagé ; il ne dit jamais combien de fois on
 * l'a RATÉ. Fanny avait 2 week-ends pour 0 fois le rôle.
 *
 * POURQUOI UNE PASSE SÉPARÉE, ET NON UN TERME DE SCORE. Le terme a été essayé
 * et MESURÉ : il donnait bien le rôle à Fanny, mais faisait passer le
 * remplissage de 3 à 5 cases vides. Mélanger « remplir » et « répartir » dans un
 * même score, c'est laisser l'un se payer sur l'autre — et le principe posé le
 * 26/08 est clair : une garde pourvue prime sur l'élégance de la répartition.
 *
 * Ici, on ne touche QUE des week-ends déjà complets, et on se contente
 * d'échanger les deux rôles entre les mêmes personnes. Le nombre de gardes
 * pourvues ne peut donc pas bouger — c'est une propriété de la transformation,
 * pas une précaution qu'on espère.
 *
 * L'échange respecte l'inversion R8 : échanger les rôles du week-end oblige à
 * échanger ceux du vendredi lié, sinon la paire devient illégale.
 */
function equilibrerRolesWeekEnd(
  planning: PlanningPartiel,
  input: SolverInput,
): PlanningPartiel {
  const roleAvantage = input.roleAvantageFinancier === undefined
    ? DEFAULT_ROLE_AVANTAGE_FINANCIER
    : input.roleAvantageFinancier
  if (roleAvantage === null) return planning

  const vets = normaliserContraintesVets(input.vets)
  const structure = input.structureConfig ?? DEFAULT_STRUCTURE_CONFIG
  const figees = indexerFigees(input.placesFigees)

  /** L'écart entre le plus et le moins servi sur le rôle avantagé. */
  const desequilibre = (p: PlanningPartiel): number => {
    const compteurs = compterParVet(p, vets, roleAvantage, input.calendrier)
    // On mesure le RATIO manqué : « des week-ends tenus, combien sans
    // l'avantage ». C'est ce que voit MiKL — pas « 0 », mais « 2 et 0 ».
    const rates = compteurs.map((c) => c.weGardes - c.weekendPremier)
    return Math.max(...rates, 0) - Math.min(...rates, 0)
  }

  let courant = planning
  let ameliore = true
  let tours = 0

  while (ameliore && tours < 10) {
    ameliore = false
    tours++

    for (const we of courant.attributions.filter((a) => a.type === 'weekend')) {
      const places = we.placements
      if (places.length < 2) continue
      if (places.some((p) => !p.vetId)) continue // week-end incomplet : on n'y touche pas

      // B-111 — le cadenas porte sur la PLACE, pas sur la personne : échanger le
      // 1er et le 2nd d'un week-end dont une place est cadenassée déplacerait
      // précisément ce que l'admin a fixé. On laisse le bloc tranquille — y
      // compris le vendredi lié, que `echangerRolesDuBloc` retournerait avec lui.
      if (blocFige(courant, we.date, structure, figees)) continue

      const essai = echangerRolesDuBloc(courant, we.date, structure)
      if (!essai) continue

      // Aucune règle dure enfreinte, et un déséquilibre moindre : on adopte.
      const gagne = desequilibre(essai) < desequilibre(courant)
      const nAjoutePasDInfraction =
        nbPlacesIllegales(essai, input, vets, structure) <=
        nbPlacesIllegales(courant, input, vets, structure)

      if (gagne && nAjoutePasDInfraction) {
        courant = essai
        ameliore = true
      }
    }
  }

  return courant
}

/**
 * Échange les deux premiers rôles d'un week-end ET du créneau qui lui est lié
 * (le vendredi soir), pour rester cohérent avec l'inversion R8.
 * `null` si le bloc n'est pas échangeable en l'état.
 */
function clesDuBloc(
  planning: PlanningPartiel,
  dateWeekEnd: string,
  structure: StructureConfig,
): Set<string> {
  const cles = new Set<string>([`${dateWeekEnd}|weekend`])

  for (const rel of relationsEffectives(structure)) {
    if (rel.cibleCode !== 'weekend') continue
    for (let k = 1; k <= FENETRE_GROUPE_JOURS; k++) {
      const cle = `${addDays(dateWeekEnd, -k)}|${rel.sourceCode}`
      if (planning.attributions.some((a) => `${a.date}|${a.type}` === cle)) {
        cles.add(cle)
        break
      }
    }
  }

  return cles
}

/**
 * B-111 — le bloc contient-il au moins une place cadenassée ?
 *
 * On interroge le MÊME ensemble de cases que l'échange retournerait : le
 * week-end et le créneau lié. Tester le seul week-end laisserait échanger les
 * rôles d'un vendredi cadenassé, que R8 emporte avec lui.
 */
function blocFige(
  planning: PlanningPartiel,
  dateWeekEnd: string,
  structure: StructureConfig,
  figees: IndexFigees,
): boolean {
  if (figees.size === 0) return false
  const cles = clesDuBloc(planning, dateWeekEnd, structure)
  return planning.attributions.some(
    (a) => cles.has(`${a.date}|${a.type}`) &&
      a.placements.some((p) => estFigee(figees, a.date, a.type, p.role)),
  )
}

function echangerRolesDuBloc(
  planning: PlanningPartiel,
  dateWeekEnd: string,
  structure: StructureConfig,
): PlanningPartiel | null {
  const aEchanger = clesDuBloc(planning, dateWeekEnd, structure)

  let touche = false
  const attributions = planning.attributions.map((a) => {
    if (!aEchanger.has(`${a.date}|${a.type}`)) return a
    const places = a.placements
    if (places.length < 2 || !places[0].vetId || !places[1].vetId) return a
    touche = true
    const echange = places.map((p, i) => {
      if (i === 0) return { ...p, vetId: places[1].vetId }
      if (i === 1) return { ...p, vetId: places[0].vetId }
      return p
    })
    return { ...a, placements: echange }
  })

  return touche ? { attributions } : null
}

/**
 * Combien de places posées seraient refusées par les règles dures ?
 *
 * ⚠️ On COMPTE, on ne juge pas en tout-ou-rien — et c'est indispensable.
 * Rejouer `isValid` sur un planning déjà complet fait ressortir les règles
 * d'ORDRE (R18/R19 : « le 1er doit être désigné avant le 2nd ») : elles
 * refusent la place du 1er dès lors que le 2nd est déjà là. Un contrôle absolu
 * déclarait donc TOUS les plannings illégaux, y compris celui en cours — et
 * l'échange de rôles était systématiquement rejeté, en silence.
 *
 * En comparant deux plannings avec la MÊME mesure, ce biais s'annule : ce qui
 * compte est qu'un échange n'AJOUTE pas d'infraction.
 */
function nbPlacesIllegales(
  planning: PlanningPartiel,
  input: SolverInput,
  vets: VetEngineNormalise[],
  structure: StructureConfig,
): number {
  let illegales = 0
  for (const a of planning.attributions) {
    for (const place of a.placements) {
      if (!place.vetId) continue
      const vet = vets.find((v) => v.id === place.vetId)
      if (!vet) { illegales++; continue }
      // On juge la place dans un planning AMPUTÉ d'elle-même : sinon la personne
      // qu'on teste se verrait reprocher sa propre présence (R21).
      const sans: PlanningPartiel = {
        attributions: planning.attributions.map((x) =>
          x === a
            ? { ...x, placements: x.placements.map((p) => (p === place ? { ...p, vetId: null } : p)) }
            : x,
        ),
      }
      const slot: SlotGarde = { date: a.date, type: a.type, saison: input.saison, besoinSecond: a.placements.length > 1 }
      if (!isValid(slot, vet, place.role, vets, sans, input.calendrier, structure, input.contexteAnterieur).valid) {
        illegales++
      }
    }
  }
  return illegales
}

/** Places réellement pourvues d'un planning. */
function comptePlacesPourvues(planning: PlanningPartiel): number {
  return planning.attributions.reduce(
    (n, a) => n + a.placements.filter((p) => p.vetId).length, 0,
  )
}

/**
 * Défait les jours autour d'une case, y force un candidat, puis reconstruit.
 * Renvoie le planning obtenu, ou `null` si le candidat ne peut pas y aller même
 * une fois le voisinage libéré.
 */
function essayerDePourvoir(
  cible: SolverStep,
  candidat: VetEngineNormalise,
  planning: PlanningPartiel,
  groupes: SolverStep[][],
  vets: VetEngineNormalise[],
  bonusMalus: BonusMalusMap,
  weights: EquityWeights,
  structure: StructureConfig,
  calendrier: CalendrierResolu | undefined,
  roleAvantage: string | null,
  contexteAnterieur: AttributionGarde[] | undefined,
  // B-111 — les places cadenassées : ni défaites par la libération du
  // voisinage, ni re-choisies par la reconstruction qui suit.
  figees: IndexFigees,
): PlanningPartiel | null {
  const debut = addDays(cible.date, -FENETRE_RATTRAPAGE_JOURS)
  const fin = addDays(cible.date, FENETRE_RATTRAPAGE_JOURS)

  // Les groupes concernés : ceux dont au moins une place tombe dans la fenêtre.
  // On raisonne en GROUPES et non en jours pour ne jamais couper un bloc
  // vendredi ↔ week-end en deux — ce serait rouvrir le défaut de B-059.
  const dansLaFenetre = (g: SolverStep[]) => g.some((s) => s.date >= debut && s.date <= fin)
  const aRefaire = groupes.filter(dansLaFenetre)
  const datesLiberees = new Set(aRefaire.flatMap((g) => g.map((s) => `${s.date}|${s.type}`)))

  // Planning amputé du voisinage (le reste de la période ne bouge pas) — puis
  // les places cadenassées y sont remises (B-111). Le rattrapage défait tout
  // l'entourage d'une case vide : sans cette remise, combler un trou du mardi
  // effacerait la garde que l'admin avait fixée le lundi.
  let essai: PlanningPartiel = reposerFigees(
    { attributions: planning.attributions.filter((a) => !datesLiberees.has(`${a.date}|${a.type}`)) },
    figees,
    groupes.flat(),
  )

  // La case cible d'abord : c'est elle qu'on cherche à pourvoir, elle passe
  // donc avant tout le monde dans la reconstruction.
  const slotCible: SlotGarde = {
    date: cible.date, type: cible.type, saison: cible.saison,
    besoinSecond: cible.besoinSecond, nbPlaces: cible.nbPlaces,
  }
  if (!isValid(slotCible, candidat, cible.role, vets, essai, calendrier, structure, contexteAnterieur).valid) {
    return null
  }
  essai = assignerStep(essai, cible, candidat.id)

  // Puis on reconstruit le voisinage, la place forcée étant désormais figée.
  for (const groupe of aRefaire) {
    const restants = prioriserCasesFigees(
      stepsHorsFigees(groupe, figees).filter(
        (s) => !(s.date === cible.date && s.type === cible.type && s.role === cible.role),
      ),
      figees,
    )
    if (restants.length === 0) continue

    const choix = resoudreGroupe(
      restants, essai, vets, bonusMalus, weights, structure, calendrier,
      roleAvantage, contexteAnterieur,
    )
    restants.forEach((step, i) => {
      const vetId = choix.affectation[i]
      if (vetId) essai = assignerStep(essai, step, vetId)
    })
  }

  // Les créneaux vides doivent continuer d'exister (sinon ils disparaissent du
  // calendrier — cf. B-053).
  for (const groupe of aRefaire) {
    for (const step of groupe) {
      if (!essai.attributions.some((a) => a.date === step.date && a.type === step.type)) {
        essai = {
          attributions: [...essai.attributions, attributionVide(step.date, step.type, step.rolesCreneau)],
        }
      }
    }
  }

  return essai
}

/** Recense les places vides d'un planning, avec le pourquoi de chacune. */
function recenserVides(
  steps: SolverStep[],
  planning: PlanningPartiel,
  vets: VetEngineNormalise[],
  calendrier: CalendrierResolu | undefined,
  structure: StructureConfig,
  contexteAnterieur: AttributionGarde[] | undefined,
): CreneauVide[] {
  const out: CreneauVide[] = []
  for (const step of steps) {
    const attr = planning.attributions.find((a) => a.date === step.date && a.type === step.type)
    const place = attr?.placements.find((p) => p.role === step.role)
    if (place?.vetId) continue

    const slot: SlotGarde = {
      date: step.date, type: step.type, saison: step.saison,
      besoinSecond: step.besoinSecond, nbPlaces: step.nbPlaces,
    }
    out.push({
      date: step.date,
      type: step.type,
      role: step.role,
      raisons: raisonsCompletes(step, slot, planning, vets, calendrier, structure, contexteAnterieur),
    })
  }
  return out
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

  // B-111 — les places cadenassées sont POSÉES avant que la recherche commence,
  // et retirées de ce qu'il reste à pourvoir. Deux effets, tous deux voulus :
  // le backtracking ne peut plus les remettre en cause, et tout ce qu'il pose
  // ensuite les VOIT (compteurs d'équité, repos, enchaînements, duos).
  const figees = indexerFigees(input.placesFigees)
  const tousLesSteps = genererSteps(dateDebut, dateFin, saison, input.nbVetosSemaineSoir, input.creneaux)
  // Les places restantes d'une case à moitié cadenassée passent en premier :
  // sans ça, R9 juge le créneau lié contre une équipe incomplète et bloque tout
  // (cf. `prioriserCasesFigees`, qui porte la mesure et le raisonnement).
  const steps = prioriserCasesFigees(stepsHorsFigees(tousLesSteps, figees), figees)
  const planningDepart: PlanningPartiel = {
    attributions: attributionsDesFigees(figees, tousLesSteps),
  }
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
    planningDepart,
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
    // B-053 — même coupé, on ne rend pas les mains vides. Le remplissage au
    // mieux est LINÉAIRE : il ne peut pas ré-exploser là où la recherche
    // complète vient d'être coupée.
    const secours = avecRattrapage(input, remplirAuMieux(input))
    return {
      success: false,
      joursNonCouverts: [],
      planningPartiel: secours.planning,
      creneauxVides: secours.creneauxVides,
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

  // B-053 — LE FILET. La recherche complète a prouvé qu'aucun planning entier
  // n'existe ; on repasse en glouton tolérant pour rendre tout ce qui EST
  // possible, et la liste des créneaux réellement impossibles (avec leur
  // pourquoi). C'est ce que l'admin reçoit désormais à la place d'un mur.
  const secours = avecRattrapage(input, remplirAuMieux(input))

  return {
    success: false,
    joursNonCouverts,
    planningPartiel: secours.planning,
    creneauxVides: secours.creneauxVides,
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
  // B-111 — les places cadenassées, que la destroy-repair ne doit jamais perdre.
  const figees = indexerFigees(input.placesFigees)
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

      // Détruire : supprimer la semaine — SAUF les places cadenassées, qui sont
      // remises aussitôt (B-111). Sans ce `reposerFigees`, le LNS effacerait le
      // choix de l'admin une semaine sur deux, et la réparation reposerait
      // quelqu'un d'autre à sa place : le cadenas tiendrait à l'écriture, mais
      // le planning aurait été composé sans lui.
      const tousLesStepsSemaine = genererStepsSemaine(
        lundi, saison, input.nbVetosSemaineSoir, input.creneaux,
      ).filter((s) => s.date >= dateDebut && s.date <= dateFin)

      const partial = reposerFigees(supprimerSemaine(meilleur, lundi), figees, tousLesStepsSemaine)
      const steps = stepsHorsFigees(tousLesStepsSemaine, figees)
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
