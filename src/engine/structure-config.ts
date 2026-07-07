// ============================================================
// GUARDVETO — Config des règles STRUCTURELLES R8/R9 (réglables)
// ============================================================
// R8 (inversion des rôles 1er/2nd vendredi↔WE) et R9 (même binôme vendredi
// soir = week-end) étaient des contraintes DURES codées en dur. Elles
// deviennent RÉGLABLES, comme les autres règles : un cabinet peut les
// DÉSACTIVER (toggle) ou en changer le NIVEAU d'importance (ferme → préférence).
//
// Mécanique unifiée (briques catalogue) :
//   • R9 = brique `liaison_creneaux` (vendredi soir ↔ week-end, même duo)
//   • R8 = brique `inversion_role`   (1er/2nd inversés entre les deux)
//
// Forme différente des règles par-véto : ce sont des règles GLOBALES (pas de
// « qui »). On les modélise donc par une config résolue une fois, threadée
// au moteur ET au validateur indépendant (les DEUX gardiens — sinon violations
// fantômes). Pas de React ici.
//
// ÉTAGE (cf. score lexicographique / P1-B dur-mou) :
//   ≤ 2 (jamais/ferme) → DUR : isValid bloque, le validateur signale.
//   ≥ 3 (sauf_crise/evitee/si_possible) → MOU : pénalité, ne bloque pas, le
//       validateur ne signale PAS (ce n'est plus une violation dure).
//   actif = false → la règle est ignorée partout.
// ============================================================

import type { HistoriqueFetesResolu } from './historique-fete'

/** Étage au-delà duquel une règle structurelle devient MOLLE (pénalité). */
export const ETAGE_STRUCTURE_DUR_MAX = 2

/** Une règle structurelle : active ou non, et son étage (2=ferme … 5=si_possible). */
export interface StructureRegleConfig {
  actif: boolean
  etage: number
}

// ── Relations entre créneaux EN DONNÉE (RG tranche 2 — verrou n°4 doc 09) ──
//
// Le COUPLE vendredi_soir↔weekend n'est plus câblé : les couples viennent de
// `relation_creneau` (résolus ids → codes par le loader). Le moteur applique
// chaque relation génériquement ; le réglage dur/mou reste porté PAR GENRE via
// r9_liaison (meme_binome) et r8_inversion (inversion_role) — la config par
// relation individuelle viendra en tranche 4.

/** Genre de relation appliqué par le moteur (repos_apres : pas encore consommé). */
export type GenreRelationStructure = 'meme_binome' | 'inversion_role'

/** Un couple de créneaux liés, résolu en CODES (le langage des slots moteur). */
export interface RelationStructure {
  sourceCode: string
  cibleCode: string
  genre: GenreRelationStructure
}

/**
 * Relations par DÉFAUT = le couple historique. Utilisées quand `relations`
 * est `undefined` (contextes legacy sans catalogue, snapshots ≤ v3 — fidèle :
 * ces plannings ont été générés quand le couple était câblé). Un cabinet dont
 * la DONNÉE dit « zéro relation » ([]) n'a, lui, AUCUN couple appliqué.
 */
export const RELATIONS_STRUCTURE_DEFAUT: readonly RelationStructure[] = [
  { sourceCode: 'vendredi_soir', cibleCode: 'weekend', genre: 'meme_binome' },
  { sourceCode: 'vendredi_soir', cibleCode: 'weekend', genre: 'inversion_role' },
]

/** Config des deux règles structurelles réglables. */
export interface StructureConfig {
  /** R9 — même binôme vendredi soir = week-end (brique liaison_creneaux). */
  r9_liaison: StructureRegleConfig
  /** R8 — inversion des rôles 1er/2nd vendredi↔WE (brique inversion_role). */
  r8_inversion: StructureRegleConfig
  /**
   * Couples de créneaux liés, EN DONNÉE (relation_creneau résolue en codes).
   * `undefined` → repli RELATIONS_STRUCTURE_DEFAUT (couple historique) ;
   * `[]` → aucun couple (le cabinet a explicitement zéro relation).
   * Voyage DANS StructureConfig pour être propagé partout où elle l'est déjà
   * (resoudreContexte, crise, replay, diagnostic) sans nouveau threading.
   */
  relations?: RelationStructure[]
  /**
   * Réglage des 4 pénalités SOUPLES historiques (R10/R10c/R10b/R8b — backlog
   * n°16). `undefined` / entrée absente → défaut historique (actif, étage et
   * poids d'origine) → byte-identique. Voyage DANS StructureConfig (même
   * principe que `relations` : propagé partout sans nouveau threading).
   */
  penalitesSouples?: PenalitesSouplesConfig
  /**
   * Historique des fêtes de fin d'année (backlog n°14 — équité inter-annuelle
   * « qui a fait Noël l'an dernier ne le refait pas cette année »). Résolu à
   * la SOURCE par le loader (table `historique_fete` → Set canonique, cf.
   * historique-fete.ts) et consommé en PÉNALITÉ SOUPLE par les deux scoreurs
   * (greedy/LNS via penalite(), scoreur global via scorerPlanning) — jamais
   * par le validateur indépendant. `undefined` ou vide → aucune pénalité →
   * byte-identique. Voyage DANS StructureConfig (même principe que `relations`).
   */
  historiqueFetes?: HistoriqueFetesResolu
  /**
   * Règles de COMPOSITION D'ÉQUIPE par tag (backlog n°6 — « un junior jamais
   * seul », « au moins un senior par week-end »). Extraites des lignes
   * `regles_cabinet` de brique `composition_equipe` (une ligne par règle).
   * Dures (étage ≤ 2) → isValid bloque + validateur signale ; souples →
   * pénalité dans les DEUX scoreurs. `undefined`/vide → aucune règle →
   * byte-identique. Voyage DANS StructureConfig (même principe que `relations`).
   */
  compositions?: CompositionEquipeRegle[]
  /**
   * Règles de RÔLE INTERDIT PAR TAG (backlog n°22 — « un junior jamais 1er »).
   * Extraites des lignes `regles_cabinet` de brique `role_interdit_tag`.
   * Même mécanique dur/mou que `compositions`. `undefined`/vide → aucune
   * règle → byte-identique.
   */
  rolesInterdits?: RoleInterditTagRegle[]
}

// ═══════════════════════════════════════════════════════════════
// Rôle interdit par TAG (backlog n°22 — « un junior jamais 1er »)
// ═══════════════════════════════════════════════════════════════
// Un véto portant le TAG ne peut pas tenir le RÔLE (label de place, ex.
// 'premier') sur les créneaux ciblés. Contrairement à la composition (qui se
// juge sur l'équipe complète), ce prédicat se juge PLACE PAR PLACE — gabarit
// R17 : le check reçoit le rôle visé et bloque la pose.

/** Une règle « rôle interdit selon attribut », résolue et consommable moteur. */
export interface RoleInterditTagRegle {
  /** id de la ligne regles_cabinet (trace / ciblage UI). */
  regleId: string
  /** Tag ciblé, NORMALISÉ (minuscules, sans espaces parasites). */
  tag: string
  /** Label du rôle interdit (place du catalogue, ex. 'premier'). */
  role: string
  /** Codes de créneaux ciblés — absent/vide = tous les créneaux. */
  creneaux?: string[]
  actif: boolean
  /** Étage lexicographique (≤ 2 = dur, ≥ 3 = pénalité souple). */
  etage: number
}

/** Les règles de rôle interdit DURES effectives (actives + étage ≤ 2). */
export function rolesInterditsDurs(structure: StructureConfig): RoleInterditTagRegle[] {
  return (structure.rolesInterdits ?? []).filter((r) => r.actif && r.etage <= ETAGE_STRUCTURE_DUR_MAX)
}

/** Les règles de rôle interdit SOUPLES effectives (actives + étage ≥ 3). */
export function rolesInterditsSouples(structure: StructureConfig): RoleInterditTagRegle[] {
  return (structure.rolesInterdits ?? []).filter((r) => r.actif && r.etage > ETAGE_STRUCTURE_DUR_MAX)
}

// ═══════════════════════════════════════════════════════════════
// Composition d'équipe par TAG (backlog n°6)
// ═══════════════════════════════════════════════════════════════
// Le « qui » de ces règles n'est pas un véto nominal mais une ÉTIQUETTE
// (veterinaires.tags — ex. 'junior', 'senior'). Deux modes :
//   • au_moins_un : chaque créneau ciblé compte ≥ 1 véto portant le tag.
//   • pas_seuls   : les porteurs du tag n'ont jamais un créneau à eux seuls
//     (il faut toujours ≥ 1 véto SANS le tag à leurs côtés ; sur un créneau
//     à une place, un porteur du tag est donc exclu).
// La composition se juge sur l'ÉQUIPE COMPLÈTE d'un créneau, jamais sur une
// place isolée — cf. rules/composition-equipe.ts (pose complétante).

export type ModeComposition = 'au_moins_un' | 'pas_seuls'

/** Une règle de composition d'équipe, résolue et consommable moteur. */
export interface CompositionEquipeRegle {
  /** id de la ligne regles_cabinet (trace / ciblage UI). */
  regleId: string
  mode: ModeComposition
  /** Tag ciblé, NORMALISÉ (minuscules, sans espaces parasites). */
  tag: string
  /** Codes de créneaux ciblés — absent/vide = tous les créneaux. */
  creneaux?: string[]
  actif: boolean
  /** Étage lexicographique (≤ 2 = dur, ≥ 3 = pénalité souple). */
  etage: number
}

/** Les règles de composition DURES effectives (actives + étage ≤ 2). */
export function compositionsDures(structure: StructureConfig): CompositionEquipeRegle[] {
  return (structure.compositions ?? []).filter((r) => r.actif && r.etage <= ETAGE_STRUCTURE_DUR_MAX)
}

/** Les règles de composition SOUPLES effectives (actives + étage ≥ 3). */
export function compositionsSouples(structure: StructureConfig): CompositionEquipeRegle[] {
  return (structure.compositions ?? []).filter((r) => r.actif && r.etage > ETAGE_STRUCTURE_DUR_MAX)
}

/** Relations effectivement appliquées (donnée si chargée, sinon couple historique). */
export function relationsEffectives(structure: StructureConfig): readonly RelationStructure[] {
  return structure.relations ?? RELATIONS_STRUCTURE_DEFAUT
}

/** Défaut = comportement historique : les deux FERMES et ACTIVES (dur, étage 2). */
export const DEFAULT_STRUCTURE_CONFIG: StructureConfig = {
  r9_liaison: { actif: true, etage: ETAGE_STRUCTURE_DUR_MAX },
  r8_inversion: { actif: true, etage: ETAGE_STRUCTURE_DUR_MAX },
}

/** La règle est-elle appliquée en DUR (bloque) ? (active ET étage ≤ 2) */
export function estStructureDure(r: StructureRegleConfig): boolean {
  return r.actif && r.etage <= ETAGE_STRUCTURE_DUR_MAX
}

/** La règle est-elle une PRÉFÉRENCE souple (active ET étage ≥ 3) ? */
export function estStructureSouple(r: StructureRegleConfig): boolean {
  return r.actif && r.etage > ETAGE_STRUCTURE_DUR_MAX
}

/** Pénalité souple selon l'étage (mêmes valeurs que les règles par-véto). */
const PENALITE_ETAGE_STRUCTURE: Record<number, number> = { 3: 100, 4: 50, 5: 20 }
export function penaliteStructureEtage(etage: number): number {
  return PENALITE_ETAGE_STRUCTURE[etage] ?? 0
}

// ═══════════════════════════════════════════════════════════════
// Pénalités SOUPLES réglables (backlog n°16 — R10/R10c/R10b/R8b)
// ═══════════════════════════════════════════════════════════════
// Les 4 règles souples historiques (poids 50/45/30/20 en dur) deviennent
// réglables comme R8/R9 : un cabinet peut les DÉSACTIVER ou changer leur
// NIVEAU (l'étage lexicographique où elles pèsent). Contrairement à R8/R9,
// elles restent STRUCTURELLEMENT SOUPLES (étage ≥ 3) : il n'existe AUCUN
// contrôle dur (isValid / validateur indépendant) pour elles — les rendre
// « fermes » serait une coquille vide. L'écriture (setStructureRegle) refuse
// donc `jamais`, et la résolution ci-dessous CLAMP tout étage < 3 à 3
// (défense en profondeur : une ligne posée en dur en base reste souple).
//
// Le POIDS intra-étage de chaque règle reste sa constante historique : le
// réglage porte le NIVEAU (étage, ce qui compte lexicographiquement) et
// l'ACTIVATION — pas de chiffres abstraits exposés (leçon UX équité).
// Défaut (aucune ligne en base) = étage + poids historiques → byte-identique.

/** Identifiants internes des 4 pénalités souples réglables. */
export const PENALITES_SOUPLES_IDS = [
  'we_consecutif',     // R10  — 2 week-ends de garde consécutifs
  'we_avant_vacances', // R10c — garde le WE qui précède des vacances du véto
  'fete_fin_annee',    // R10b — garde un soir de réveillon (24/31 déc)
  'inversion_ferie',   // R8b  — même rôle la veille d'un jour férié
] as const
export type PenaliteSoupleId = (typeof PENALITES_SOUPLES_IDS)[number]

/** Réglage d'une pénalité souple (absence = défaut historique). */
export type PenalitesSouplesConfig = Partial<Record<PenaliteSoupleId, StructureRegleConfig>>

/** Défauts HISTORIQUES : étage lexicographique + poids intra-étage d'origine. */
export const PENALITE_SOUPLE_DEFAUT: Record<PenaliteSoupleId, { etage: number; poids: number }> = {
  we_consecutif:     { etage: 3, poids: 50 }, // 🟠 SAUF_CRISE
  we_avant_vacances: { etage: 4, poids: 45 }, // 🟡 EVITEE
  fete_fin_annee:    { etage: 4, poids: 30 }, // 🟡 EVITEE
  inversion_ferie:   { etage: 5, poids: 20 }, // ⚪ SI_POSSIBLE
}

/** Une pénalité souple entièrement résolue (consommable moteur + scoreur). */
export interface PenaliteSoupleResolue {
  actif: boolean
  /** Étage lexicographique où la règle pèse (clampé 3..5 : toujours souple). */
  etage: number
  /** Poids intra-étage (constante historique de la règle ; 0 si inactive). */
  poids: number
}

/**
 * resoudrePenaliteSouple — résout le réglage effectif d'une des 4 pénalités.
 * `cfg` absent → défaut historique (actif + étage/poids d'origine).
 * Étage configuré < 3 → clampé à 3 (ces règles n'ont pas de gardien dur).
 */
export function resoudrePenaliteSouple(
  id: PenaliteSoupleId,
  config?: PenalitesSouplesConfig,
): PenaliteSoupleResolue {
  const defaut = PENALITE_SOUPLE_DEFAUT[id]
  const cfg = config?.[id]
  if (!cfg) return { actif: true, etage: defaut.etage, poids: defaut.poids }
  const etage = Math.min(5, Math.max(3, cfg.etage))
  return {
    actif: cfg.actif,
    etage,
    poids: cfg.actif ? defaut.poids : 0,
  }
}

/**
 * poidsPenaliteSouple — poids effectif à sommer par le solver greedy
 * (0 si la règle est désactivée ; poids historique sinon).
 */
export function poidsPenaliteSouple(
  id: PenaliteSoupleId,
  config?: PenalitesSouplesConfig,
): number {
  return resoudrePenaliteSouple(id, config).poids
}
