// ============================================================
// GUARDVETO — Contraintes souples (R10, R10b, R8b)
// ============================================================
// Retourne un score de pénalité numérique (0 = parfait).
// Contrairement aux contraintes dures, une pénalité non nulle
// ne bloque pas l'attribution — elle aide le solver à choisir
// la meilleure solution parmi plusieurs valides.
//
// RÉGLABLES (backlog n°16) : les 4 poids historiques ne sont plus câblés —
// chaque fonction accepte la config `penalitesSouples` (StructureConfig) et
// résout son poids effectif (0 si la règle est désactivée par le cabinet).
// Sans config → poids historiques (PENALITE_SOUPLE_DEFAUT) → byte-identique.
// ============================================================

import type { SlotGarde, VetEngine, PlanningPartiel, RoleGarde, CalendrierResolu, AttributionGarde } from '../types'
import { samediDeSemaine, addDays, estJourFerie, estFeteFinAnnee, attributionsAvecContexte } from '../utils'
import {
  penaliteContraintesConfig, violeReposFixe, estVeilleDeRepos,
  // B-132 — les SITUATIONS visees par R10c / R10b / R8b vivent desormais
  // dans `hard-constraints`, partagees entre la penalite et le gardien.
  // Une seule definition : deux lectures cote a cote finissent par diverger.
  estWeekEndAvantVacances, estSoirDeFeteFinAnnee, memeRoleQueLaVeilleDeFerie,
} from './hard-constraints'
import { estAttribue, vetPourRole } from '../attribution'
import {
  PENALITE_SOUPLE_DEFAUT, poidsPenaliteSouple, type PenalitesSouplesConfig,
} from '../structure-config'
import { penaliteFeteHistorique, type HistoriqueFetesResolu } from '../historique-fete'

// ── Scores de pénalité (défauts historiques — source unique structure-config) ──

export const PENALITE = {
  /** R10c — Garde le week-end qui précède immédiatement des vacances du véto */
  WE_AVANT_VACANCES: PENALITE_SOUPLE_DEFAUT.we_avant_vacances.poids,
  /** R10b — Garde un soir de réveillon (24 déc ou 31 déc) — à éviter si possible */
  FETE_FIN_ANNEE: PENALITE_SOUPLE_DEFAUT.fete_fin_annee.poids,
  /** R8b — Même rôle (1er/2nd) la veille d'un jour férié — inversion "si possible" (§7) */
  INVERSION_FERIE: PENALITE_SOUPLE_DEFAUT.inversion_ferie.poids,
} as const

// ── Contraintes souples individuelles ────────────────────

// ── B-135 (26/09) : R10 « pas 2 week-ends de suite » A ÉTÉ RETIRÉE ──────────
// Vivaient ici `penaliteR10WEConsecutif` et ses deux helpers `samediPrecedent`
// et `aGardeWE`, tous trois supprimés avec elle : plus aucun autre appelant
// (vérifié par grep sur `src/` avant retrait).
//
// MiKL, le 26/09 : « tu peux enlever la règle "éviter 2 WE de garde de suite",
// car on peut déjà créer une règle plus personnalisée plus haut ». Le besoin est
// couvert, en mieux, par `espacement_weekend` et `cadencement_weekend` —
// paramétrables, ciblables, et dotées d'un vrai gardien dur. R10 valait 50
// points et n'interdisait rien : « une pénalité n'est pas une interdiction ».
//
// ⚠️ Elle voyait le week-end du lookback inter-périodes à la jonction (#17).
//    `espacement_weekend` lit le même contexte étendu, donc la jonction reste
//    surveillée — mais par une règle qui, elle, peut refuser.

/**
 * R10c — Pas de garde le week-end qui précède des vacances (« au maximum du possible »).
 * Si le véto part en vacances la semaine qui suit immédiatement ce week-end
 * (congé de type 'vacances' débutant du lundi au vendredi suivant), on pénalise
 * fortement le fait de le mettre de garde ce week-end-là — pour qu'il parte reposé.
 * Le congé lui-même reste géré en dur par R16 (aucune garde pendant le congé).
 */
function penaliteWEAvantVacances(
  slot: SlotGarde,
  vet: VetEngine,
  planning: PlanningPartiel,
  penalitesSouples?: PenalitesSouplesConfig
): number {
  void planning
  return estWeekEndAvantVacances(slot, vet)
    ? poidsPenaliteSouple('we_avant_vacances', penalitesSouples)
    : 0
}

// B-132 — `estWeekEndAvantVacances` vivait ici (extraite a B-063 pour que R10d
// puisse ceder le pas sur la SITUATION, et non sur le fait que R10c ait produit
// un chiffre — la nuance compte : R10c desactivee renvoie 0, et R10d aurait
// alors pris le relais, faisant revenir par la bande une regle que le cabinet
// avait eteinte). Elle est desormais dans `hard-constraints`, partagee avec le
// gardien `checkWeAvantVacances` : `soft` importe `hard`, jamais l'inverse.

/**
 * R10b — Pénalité pour les veilles de fête (24 déc, 31 déc)
 * On essaie de dégager des repos autour de Noël et du Jour de l'An (§6).
 * Seules les veilles (soirs "normaux") sont pénalisées — Dec 25 et Jan 1
 * sont déjà des fériés gérés par le système d'équité.
 */
function penaliteFeteFinAnnee(slot: SlotGarde, penalitesSouples?: PenalitesSouplesConfig): number {
  // B-132 — la detection passe par le predicat PARTAGE avec le gardien.
  return estSoirDeFeteFinAnnee(slot)
    ? poidsPenaliteSouple('fete_fin_annee', penalitesSouples)
    : 0
}

/**
 * R10d (B-063) — ÉVITER UNE GARDE LA VEILLE D'UN JOUR D'ABSENCE.
 *
 * Demandé par MiKL le 26/08 : « éviter les jours de garde la veille d'un repos ».
 * Une garde de nuit déborde sur le lendemain matin — elle mord donc sur le repos
 * qui suit, et la personne le perd en partie.
 *
 * CE QUI COMPTE COMME ABSENCE. Précision de MiKL : *« c'est valable dès qu'une
 * personne est en congé DANS LE PLANNING, pas que dans les règles »*. On regarde
 * donc les deux :
 *   • un CONGÉ posé au planning, quel qu'en soit le type — pas seulement les
 *     vacances (une formation ou un arrêt se respectent autant) ;
 *   • un REPOS FIXE déclaré en règle (`interdire_creneau` sur un jour).
 *
 * ⚠️ Elle GÉNÉRALISE `we_avant_vacances` (R10c), qui ne regardait qu'un cas :
 * le week-end précédant des vacances. Les deux cohabitent — la plus ancienne
 * reste réglable seule, et un cabinet qui l'a montée plus haut garde son
 * réglage. Sur un week-end avant vacances, les deux pénalités s'ajoutent : le
 * moteur y voit deux bonnes raisons de s'abstenir, ce qui est exact.
 */
function penaliteVeilleRepos(
  slot: SlotGarde,
  vet: VetEngine,
  calendrier?: CalendrierResolu,
  penalitesSouples?: PenalitesSouplesConfig,
): number {
  // ⚠️ PAS DE DOUBLE PEINE AVEC R10c. Le week-end qui précède des vacances est
  // déjà pénalisé par `we_avant_vacances`, et son lendemain (le lundi) tombe
  // dans le congé : les deux règles se déclencheraient sur la MÊME situation.
  // Deux pénalités pour un seul motif fausseraient l'arbitrage — et un cabinet
  // qui baisse R10c verrait son réglage sans effet, l'autre prenant le relais.
  // R10d cède donc le pas là où R10c couvre déjà.
  if (estWeekEndAvantVacances(slot, vet)) return 0

  // La DÉTECTION vit dans `hard-constraints` depuis B-127 : le gardien dur et
  // cette pénalité doivent reconnaître exactement le même repos. Deux lectures
  // écrites côte à côte finiraient par diverger, et l'une porterait alors sur
  // un repos que l'autre ne voit plus.
  if (!estVeilleDeRepos(slot, vet, calendrier)) return 0
  return poidsPenaliteSouple('veille_repos', penalitesSouples)
}

/**
 * R8b — Inversion 1er/2nd sur jours fériés "si possible" (§7)
 * Pour une garde sur un jour férié en semaine, si le véto avait un rôle
 * la nuit précédente → pénalité pour qu'il prenne le rôle inverse.
 * Analogue à R8 (vendredi/WE) mais en contrainte souple car "si possible".
 */
function penaliteInversionFerie(
  slot: SlotGarde,
  vet: VetEngine,
  role: RoleGarde,
  planning: PlanningPartiel,
  calendrier?: CalendrierResolu,
  penalitesSouples?: PenalitesSouplesConfig
): number {
  // B-132 — la detection passe par le predicat PARTAGE avec le gardien.
  return memeRoleQueLaVeilleDeFerie(slot, vet, role, planning, calendrier)
    ? poidsPenaliteSouple('inversion_ferie', penalitesSouples)
    : 0
}

// ── Point d'entrée ───────────────────────────────────────

/**
 * penalite — Score de pénalité souple pour une attribution candidate.
 *
 * @param slot      Le créneau candidat
 * @param vet       Le vétérinaire candidat
 * @param role      Le rôle visé (premier ou second)
 * @param planning  Le planning partiellement construit
 * @returns         Score ≥ 0 (0 = aucune pénalité souple)
 */
export function penalite(
  slot: SlotGarde,
  vet: VetEngine,
  role: RoleGarde,
  planning: PlanningPartiel,
  calendrier?: CalendrierResolu,
  penalitesSouples?: PenalitesSouplesConfig,
  // Backlog n°14 — équité inter-annuelle des fêtes. Absent/vide → 0 (byte-identique).
  historiqueFetes?: HistoriqueFetesResolu,
  // #17 (Vague 5) — lookback inter-périodes. Absent/vide → byte-identique.
  // Consommé UNIQUEMENT par les pénalités de RYTHME (R10, et les règles molles
  // au_plus_n/espacement via penaliteContraintesConfig) — jamais R10c/R10b/R8b.
  contexteAnterieur?: AttributionGarde[],
): number {
  // Vue étendue = lookback + planning courant, pour les seules règles de rythme.
  const planningRythme = attributionsAvecContexte(planning, contexteAnterieur)
  return (
    penaliteWEAvantVacances(slot, vet, planning, penalitesSouples) +
    penaliteFeteFinAnnee(slot, penalitesSouples) +
    // R10d (B-063) — la veille d'un jour d'absence : congé posé OU repos fixe.
    penaliteVeilleRepos(slot, vet, calendrier, penalitesSouples) +
    penaliteInversionFerie(slot, vet, role, planning, calendrier, penalitesSouples) +
    // Backlog n°14 : le véto a tenu cette fête L'AN DERNIER → pénalité souple.
    penaliteFeteHistorique(slot, vet.id, historiqueFetes) +
    // P1-B : règles configurées MOLLES (étage ≥ 3) — préférence, pas blocage.
    // Le lookback est transmis pour les variantes molles des règles de rythme.
    penaliteContraintesConfig(slot, vet, role, planning, calendrier, contexteAnterieur)
  )
}

// Export individuel pour les tests
export {
  penaliteWEAvantVacances,
  penaliteFeteFinAnnee,
  penaliteInversionFerie,
}
