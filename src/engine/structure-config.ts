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

/** Config des deux règles structurelles réglables. */
export interface StructureConfig {
  /** R9 — même binôme vendredi soir = week-end (brique liaison_creneaux). */
  r9_liaison: StructureRegleConfig
  /** R8 — inversion des rôles 1er/2nd vendredi↔WE (brique inversion_role). */
  r8_inversion: StructureRegleConfig
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
