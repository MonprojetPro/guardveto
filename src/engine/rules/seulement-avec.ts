// ============================================================
// GUARDVETO — Garde conditionnelle ORIENTÉE « seulement avec B » (backlog #15b)
// ============================================================
// Prédicats PURS consommés par le MOTEUR (isValid + les deux scoreurs de
// candidats). Le validateur indépendant ré-implémente les siens
// (validerPlanning.ts) — ne JAMAIS importer ce module là-bas (indépendance
// des deux gardiens).
//
// BESOIN MÉTIER : « moi (A) seulement si B est de garde » — un véto A ne veut
// être posé sur un créneau QUE si le véto B est dans l'équipe du MÊME créneau
// (même date + même type). Cas type : un jeune véto qui ne prend des gardes
// qu'accompagné d'un senior précis.
//
// ORIENTATION (le cœur de la brique) : A dépend de B, jamais l'inverse. B peut
// être de garde sans A ; A ne peut pas être de garde sans B. UNE SEULE ligne
// en base (refs[0] = A porteur, params.avec_veterinaire_id = B) — PAS de miroir,
// contrairement au duo_interdit (symétrique, 2 lignes). Précédent d'orientation :
// preferer_avec (une ligne, non symétrique — mais toujours souple ; cette brique
// est sa version conditionnelle dur/mou).
//
// SÉMANTIQUE « POSE COMPLÉTANTE » (gabarit composition_equipe, Vague 4 #6) :
// le greedy pose les places d'un slot UNE PAR UNE. Si A est posé en premier sur
// un slot 2 places, B n'y est pas ENCORE → un check naïf refuserait A à tort.
// On ne juge donc l'équipe QUE lorsque le créneau devient COMPLET (la dernière
// place se pourvoit). Avant ce moment, l'avenir peut encore amener B.
//
// Total de places du créneau, par ordre de fiabilité (identique à composition) :
//   1. slot.nbPlaces — le nombre de places QUE LE SOLVER VA POURVOIR (porté par
//      le step / la reconstruction étage 0). Un semaine_soir plafonné par
//      l'effectif déclare 2 places au catalogue mais n'en pourvoit qu'une :
//      l'équipe se fige à la 1re pose.
//   2. les places DÉCLARÉES de l'attribution (contextes hors-solver).
//   Inconnu → jamais « complétante » → aucun blocage (le validateur reste le
//   juge de paix : mieux vaut un faux négatif moteur qu'un faux blocage).
//
// CAS SLOT 1 PLACE : la pose de A EST complétante et B ne peut PAS y être →
// A refusé (conséquence assumée de la sémantique « même créneau » ; le pré-vol
// et la garde à la création avertissent en amont).
// ============================================================

import type {
  VetEngine, SlotGarde, PlanningPartiel, RoleGarde, ContrainteEngine,
} from '../types'
import { penaliteStructureEtage } from '../structure-config'

/** Étage au-delà duquel une règle est MOLLE (pénalité). Aligné hard-constraints. */
const ETAGE_DUR_MAX = 2

/** Lit l'étage (0..5) d'une contrainte ; 2 (dur) par défaut si absent. */
function etageDe(c: ContrainteEngine): number {
  const f = (c.config as Record<string, unknown>).force
  return typeof f === 'number' ? f : ETAGE_DUR_MAX
}

/** Le partenaire REQUIS B (id) d'une règle `seulement_avec`, ou null si absente. */
export function lirePartenaireRequis(c: ContrainteEngine): string | null {
  const v = (c.config as Record<string, unknown>).avec_veterinaire_id
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** La règle cible-t-elle ce type de créneau ? (absent/vide = tous). */
export function seulementAvecCibleType(c: ContrainteEngine, type: string): boolean {
  const cr = (c.config as Record<string, unknown>).creneaux
  if (!Array.isArray(cr)) return true
  const codes = cr.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  return codes.length === 0 || codes.includes(type)
}

/**
 * Poser `vet` (= A) sur `slot` violerait-il la règle `seulement_avec` ?
 * Ne juge que la POSE COMPLÉTANTE (cf. en-tête). L'occupant éventuel de
 * `roleVisé` est exclu de l'équipe déjà pourvue (cas remplacement).
 * Règle mal configurée (partenaire absent) ou hors ciblage → jamais de violation.
 */
export function violeSeulementAvecPose(
  c: ContrainteEngine,
  slot: SlotGarde,
  roleVisé: RoleGarde,
  planning: PlanningPartiel,
): boolean {
  const partenaire = lirePartenaireRequis(c)
  if (!partenaire) return false // inerte
  if (!seulementAvecCibleType(c, slot.type)) return false

  const attr = planning.attributions.find((a) => a.date === slot.date && a.type === slot.type)
  const total = slot.nbPlaces ?? attr?.placements.length
  if (total === undefined) return false // total inconnu → jamais complétante

  // Places déjà pourvues, HORS la place visée (remplacement inclus).
  const dejaIds = attr
    ? attr.placements
        .filter((p) => p.role !== roleVisé && p.vetId !== null)
        .map((p) => p.vetId as string)
    : []

  // Pose complétante ? (les places pourvues + celle-ci couvrent tout le slot)
  if (dejaIds.length + 1 < total) return false

  // À la complétion, l'équipe finale = {A} ∪ dejaIds. B doit y figurer.
  // (A ≠ B garanti à l'écriture ; même si B == A par erreur, dejaIds ne peut
  //  contenir A — R21 l'interdit — donc la règle resterait cohérente.)
  return !dejaIds.includes(partenaire)
}

/**
 * checkSeulementAvec — volet DUR (isValid). À la pose complétante d'un slot où
 * A est posé sans B (dans le ciblage) → refus. Souple (étage ≥ 3) → ne bloque
 * pas (pénalité au scoring). Renvoie un message d'invalidité, ou null si OK.
 */
export function raisonSeulementAvecDur(
  vet: VetEngine,
  slot: SlotGarde,
  roleVisé: RoleGarde,
  planning: PlanningPartiel,
  allVets: readonly VetEngine[],
): string | null {
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'seulement_avec') continue
    if (etageDe(c) > ETAGE_DUR_MAX) continue // souple → pas de blocage
    if (violeSeulementAvecPose(c, slot, roleVisé, planning)) {
      // Résolution du prénom de B UNIQUEMENT en cas de refus : isValid est le
      // chemin le plus chaud du moteur (LNS) — aucun travail avant la violation.
      const b = lirePartenaireRequis(c)
      const nomB = (b && allVets.find((v) => v.id === b)?.prenom) || 'son binôme requis'
      return `SEULEMENT_AVEC : ${vet.prenom} ne peut être de garde que si ${nomB} est de garde sur le même créneau`
    }
  }
  return null
}

/**
 * penaliteSeulementAvecCandidat — volet MOU, gardien de CANDIDAT (greedy + LNS).
 * Pénalité à la POSE COMPLÉTANTE quand A est posé sans B pour une règle SOUPLE
 * (étage ≥ 3). Même prédicat que le gardien dur — les deux scoreurs cohérents.
 * 0 = aucune règle souple violée par cette pose.
 */
export function penaliteSeulementAvecCandidat(
  slot: SlotGarde,
  roleVisé: RoleGarde,
  vet: VetEngine,
  planning: PlanningPartiel,
): number {
  let pen = 0
  for (const c of vet.contraintes) {
    if (!c.actif || c.type !== 'seulement_avec') continue
    const etage = etageDe(c)
    if (etage <= ETAGE_DUR_MAX) continue // dur → géré par isValid
    if (violeSeulementAvecPose(c, slot, roleVisé, planning)) {
      pen += penaliteStructureEtage(etage)
    }
  }
  return pen
}

/**
 * scorerSeulementAvec — volet MOU, gardien GLOBAL (scorerPlanning). Une pénalité
 * par créneau (dans le ciblage) où A est présent SANS B, pour chaque règle
 * SOUPLE. MÊME jugement que le gardien de candidat (« équipe complète sans B »)
 * — le LNS ne défait pas ce que le greedy construit. Aucune règle → [].
 */
export interface ContributionSeulementAvec {
  etage: number
  cout: number
}

export function scorerSeulementAvec(
  planning: PlanningPartiel,
  vets: VetEngine[],
): ContributionSeulementAvec[] {
  const out: ContributionSeulementAvec[] = []
  for (const vet of vets) {
    for (const c of vet.contraintes) {
      if (!c.actif || c.type !== 'seulement_avec') continue
      const etage = etageDe(c)
      if (etage <= ETAGE_DUR_MAX) continue // dur → jamais une pénalité de score
      const partenaire = lirePartenaireRequis(c)
      if (!partenaire) continue // inerte
      const poids = penaliteStructureEtage(etage)
      for (const a of planning.attributions) {
        if (!seulementAvecCibleType(c, a.type)) continue
        const equipe = a.placements.filter((p) => p.vetId !== null).map((p) => p.vetId as string)
        if (!equipe.includes(vet.id)) continue // A pas sur ce créneau
        if (!equipe.includes(partenaire)) {
          out.push({ etage, cout: poids })
        }
      }
    }
  }
  return out
}
