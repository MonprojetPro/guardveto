// ============================================================
// GUARDVETO — Composition d'équipe par tag (backlog n°6)
// ============================================================
// Prédicats PURS consommés par le MOTEUR (isValid + les deux scoreurs).
// Le validateur indépendant ré-implémente les siens (validerPlanning.ts) —
// ne JAMAIS importer ce module là-bas (indépendance des deux gardiens).
//
// SÉMANTIQUE « POSE COMPLÉTANTE » : la composition d'une équipe ne se juge
// que lorsque le créneau devient COMPLET (la dernière place se pourvoit).
// Avant ce moment, l'avenir peut encore réparer (un senior posé sur la place
// suivante satisfait « au moins un senior ») — bloquer plus tôt éliminerait
// des solutions valides. Le backtracking/LNS explore donc librement et se
// heurte au mur uniquement sur la pose qui fige l'équipe.
//
// Total de places du créneau, par ordre de fiabilité :
//   1. slot.nbPlaces — le nombre de places QUE LE SOLVER VA POURVOIR (porté
//      par le step / la reconstruction étage 0). C'est LA bonne référence :
//      un semaine_soir plafonné par l'effectif DÉCLARE 2 places au catalogue
//      mais n'en pourvoit qu'une — l'équipe se fige à la 1re pose.
//   2. les places DÉCLARÉES de l'attribution (contextes hors-solver : crise,
//      édition manuelle — attributions réelles rechargées de la base).
//   Inconnu → jamais « complétante » → aucun blocage (le validateur reste le
//   juge de paix : mieux vaut un faux négatif moteur qu'un faux blocage).
// ============================================================

import type { VetEngine, SlotGarde, PlanningPartiel, RoleGarde } from '../types'
import {
  penaliteStructureEtage,
  type CompositionEquipeRegle, type RoleInterditTagRegle,
} from '../structure-config'

/** Normalise un tag pour comparaison (mêmes règles que le mapper/l'écriture). */
export function normaliserTag(tag: string): string {
  return tag.trim().toLowerCase()
}

/** Le véto porte-t-il le tag (déjà normalisé) ? */
export function vetPorteTag(vet: Pick<VetEngine, 'tags'>, tagNormalise: string): boolean {
  return (vet.tags ?? []).some((t) => normaliserTag(t) === tagNormalise)
}

/** La règle cible-t-elle ce type de créneau ? (absent/vide = tous) */
export function compositionCibleType(regle: CompositionEquipeRegle, type: string): boolean {
  return !regle.creneaux || regle.creneaux.length === 0 || regle.creneaux.includes(type)
}

/**
 * L'ÉQUIPE COMPLÈTE d'un créneau viole-t-elle la règle ?
 *   • au_moins_un : aucun porteur du tag dans l'équipe.
 *   • pas_seuls   : des porteurs présents, et personne SANS le tag.
 * Équipe vide → jamais de violation (la couverture est jugée ailleurs).
 */
export function violeCompositionEquipe(
  regle: CompositionEquipeRegle,
  equipe: ReadonlyArray<Pick<VetEngine, 'tags'>>,
): boolean {
  if (equipe.length === 0) return false
  const porteurs = equipe.filter((v) => vetPorteTag(v, regle.tag)).length
  if (regle.mode === 'au_moins_un') return porteurs === 0
  // pas_seuls
  return porteurs > 0 && porteurs === equipe.length
}

/**
 * Poser `vet` sur (slot, roleVisé) violerait-il `regle` ?
 * Ne juge que la POSE COMPLÉTANTE (cf. en-tête). L'occupant éventuel de
 * `roleVisé` est exclu de l'équipe (cas remplacement : crise / édition).
 */
export function violeCompositionPose(
  regle: CompositionEquipeRegle,
  slot: SlotGarde,
  roleVisé: RoleGarde,
  vet: VetEngine,
  planning: PlanningPartiel,
  vetsById: ReadonlyMap<string, VetEngine>,
): boolean {
  if (!compositionCibleType(regle, slot.type)) return false

  const attr = planning.attributions.find((a) => a.date === slot.date && a.type === slot.type)
  const total = slot.nbPlaces ?? attr?.placements.length
  if (total === undefined) return false // total inconnu → jamais complétante

  // Places déjà pourvues, HORS la place visée (remplacement inclus).
  const dejaIds = attr
    ? attr.placements
        .filter((p) => p.role !== roleVisé && p.vetId !== null)
        .map((p) => p.vetId as string)
    : []

  // Pose complétante ? (les places pourvues + celle-ci couvrent tout)
  if (dejaIds.length + 1 < total) return false

  const equipe: VetEngine[] = [vet]
  for (const id of dejaIds) {
    const v = vetsById.get(id)
    if (v) equipe.push(v)
  }
  return violeCompositionEquipe(regle, equipe)
}

/**
 * Pénalité SOUPLE d'un candidat pour les règles de composition d'étage ≥ 3
 * (mêmes valeurs d'étage que R8/R9 souples). Consommée par les DEUX scoreurs
 * de candidats (greedy + LNS) — le scoreur global juge, lui, les attributions
 * complètes (scorerPlanning). 0 = aucune règle souple violée par cette pose.
 */
export function penaliteCompositionCandidat(
  slot: SlotGarde,
  roleVisé: RoleGarde,
  vet: VetEngine,
  planning: PlanningPartiel,
  allVets: VetEngine[],
  regles?: CompositionEquipeRegle[],
): number {
  if (!regles || regles.length === 0) return 0
  const vetsById = new Map(allVets.map((v) => [v.id, v]))
  let pen = 0
  for (const regle of regles) {
    if (violeCompositionPose(regle, slot, roleVisé, vet, planning, vetsById)) {
      pen += penaliteStructureEtage(regle.etage)
    }
  }
  return pen
}

/** Message d'invalidité lisible (préfixe COMPOSITION — même style que R6/R17). */
export function messageComposition(
  regle: CompositionEquipeRegle,
  prenom: string,
): string {
  if (regle.mode === 'au_moins_un') {
    return `COMPOSITION : ce créneau doit compter au moins un vétérinaire « ${regle.tag} »`
  }
  return `COMPOSITION : ${prenom} porte le tag « ${regle.tag} » — il faut au moins un vétérinaire sans ce tag à ses côtés`
}

// ═══════════════════════════════════════════════════════════════
// Rôle interdit par TAG (backlog n°22 — « un junior jamais 1er »)
// ═══════════════════════════════════════════════════════════════
// Prédicat PLACE PAR PLACE (gabarit R17) : contrairement à la composition,
// pas de « pose complétante » — la pose viole dès que le rôle visé est le
// rôle interdit et que le candidat porte le tag.

/** La règle cible-t-elle ce type de créneau ? (absent/vide = tous) */
export function roleInterditCibleType(regle: RoleInterditTagRegle, type: string): boolean {
  return !regle.creneaux || regle.creneaux.length === 0 || regle.creneaux.includes(type)
}

/** Poser `vet` sur (slot.type, roleVisé) violerait-il `regle` ? */
export function violeRoleInterdit(
  regle: RoleInterditTagRegle,
  slotType: string,
  roleVisé: RoleGarde,
  vet: Pick<VetEngine, 'tags'>,
): boolean {
  if (roleVisé !== regle.role) return false
  if (!roleInterditCibleType(regle, slotType)) return false
  return vetPorteTag(vet, regle.tag)
}

/**
 * Pénalité SOUPLE d'un candidat pour les règles de rôle interdit d'étage ≥ 3.
 * Consommée par les DEUX scoreurs de candidats (greedy + LNS) — le scoreur
 * global juge, lui, chaque (slot, rôle) du planning complet (scorerPlanning).
 */
export function penaliteRoleInterditCandidat(
  slotType: string,
  roleVisé: RoleGarde,
  vet: Pick<VetEngine, 'tags'>,
  regles?: RoleInterditTagRegle[],
): number {
  if (!regles || regles.length === 0) return 0
  let pen = 0
  for (const regle of regles) {
    if (violeRoleInterdit(regle, slotType, roleVisé, vet)) {
      pen += penaliteStructureEtage(regle.etage)
    }
  }
  return pen
}

/** Message d'invalidité lisible (préfixe ROLE_TAG). */
export function messageRoleInterdit(regle: RoleInterditTagRegle, prenom: string): string {
  return `ROLE_TAG : ${prenom} porte le tag « ${regle.tag} » — le rôle « ${regle.role} » lui est interdit`
}
