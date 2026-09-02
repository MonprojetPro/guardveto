// ============================================================
// GUARDVETO — QUI VAUT LA PEINE D'ÊTRE BOUGÉ (B-096)
// ============================================================
// Le calcul des mouvements est combinatoire : sans filtre, un planning de 118
// places produit des milliers de candidats. Le calcul tient, mais le dossier
// envoyé à Filou exploserait et noierait le signal. On ne garde donc que les
// mouvements touchant les personnes « aux extrêmes ».
//
// ── LE CRITÈRE ÉTAIT LA CHARGE TOTALE, ET IL RATAIT SA CIBLE ───────────────
//
// Jusqu'au 2026-09-02 : les 2 plus chargés et les 2 moins chargés, mesurés sur
// le NOMBRE TOTAL de places. Un seul chiffre, pour un produit dont tous les
// déséquilibres vivent sur des DIMENSIONS distinctes.
//
// Mesuré sur Hiver P2, le jour où MiKL a repéré le problème : Antoine 27 gardes
// et Fanny 24, soit trois d'écart sur le total — mais 5 week-ends contre 3, et
// 3 fois 1er du week-end contre 1. Le déséquilibre qui saute aux yeux était
// invisible dans le critère de sélection. Antoine n'a été ciblé que par hasard
// (2ᵉ au total), et Fanny pas du tout. Deux personnes au total médian se
// partageant tous les week-ends n'auraient été ciblées par personne.
//
// On prend donc les extrêmes de CHAQUE dimension d'équité, plus ceux du total.
// La liste s'allonge un peu (une poignée de personnes sur un cabinet), et elle
// vise enfin ce qu'on cherche à corriger.
//
// ── QUI N'EST JAMAIS CIBLÉ ──────────────────────────────────────────────────
//
// Le « dernier recours » : le moteur ne le programme jamais spontanément, il
// est donc à zéro sur toutes les dimensions et serait le minimum de chacune.
// Il occuperait toutes les places de la liste sans qu'aucun mouvement le
// concernant n'ait de sens — et le prompt dit d'ailleurs à Filou de ne pas le
// proposer. L'inclure reviendrait à jeter le filtre.
// ============================================================

import type { CalendrierResolu, PlanningPartiel, VetEngine } from '../types'
import { compterParVet, type CompteurVet } from '../rules/optimization'

/** Les dimensions sur lesquelles on cherche des extrêmes. */
const DIMENSIONS: ReadonlyArray<keyof Omit<CompteurVet, 'vetId'>> = [
  'weGardes',
  'weekendPremier',
  'feriesGardes',
  'semainePremier',
  'semaineSecond',
  'semaineRenfort',
]

export interface OptionsCibles {
  vets: VetEngine[]
  roleAvantageFinancier?: string | null
  calendrier?: CalendrierResolu
  /** Combien de personnes retenir à chaque extrémité de chaque dimension. */
  parExtremite?: number
}

/** Le nombre total de places tenues, par personne. */
function totalParVet(planning: PlanningPartiel): Map<string, number> {
  const total = new Map<string, number>()
  for (const a of planning.attributions) {
    for (const p of a.placements) {
      if (p.vetId) total.set(p.vetId, (total.get(p.vetId) ?? 0) + 1)
    }
  }
  return total
}

/**
 * Les personnes aux extrêmes — sur le total ET sur chaque dimension d'équité.
 *
 * Le tri est stabilisé par l'identifiant : à égalité de compteur, deux appels
 * successifs doivent désigner les mêmes personnes. Sans ça, deux relectures du
 * même planning proposeraient des mouvements différents sans qu'aucune donnée
 * n'ait bougé, et il deviendrait impossible de savoir si un changement de
 * comportement vient du produit ou du hasard de tri.
 */
export function personnesAuxExtremes(
  planning: PlanningPartiel,
  options: OptionsCibles,
): string[] {
  const n = options.parExtremite ?? 2

  // Le dernier recours est hors-jeu : à zéro partout, il serait le minimum de
  // toutes les dimensions et remplirait la liste à lui seul.
  const eligibles = options.vets.filter((v) => !v.dernier_recours)
  if (eligibles.length === 0) return []

  const compteurs = compterParVet(
    planning, eligibles, options.roleAvantageFinancier, options.calendrier,
  )
  const total = totalParVet(planning)

  const cibles = new Set<string>()

  const retenirExtremes = (valeurDe: (c: CompteurVet) => number) => {
    const tries = [...compteurs].sort(
      (a, b) => valeurDe(b) - valeurDe(a) || a.vetId.localeCompare(b.vetId),
    )
    for (const c of tries.slice(0, n)) cibles.add(c.vetId)
    for (const c of tries.slice(-n)) cibles.add(c.vetId)
  }

  retenirExtremes((c) => total.get(c.vetId) ?? 0)
  for (const dim of DIMENSIONS) retenirExtremes((c) => c[dim])

  return [...cibles].sort()
}
