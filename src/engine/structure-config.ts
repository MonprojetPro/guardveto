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
