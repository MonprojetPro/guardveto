'use client'

// ============================================================
// GUARDVETO — Créer la règle que l'IA vient de proposer
// ============================================================
// Une proposition de l'assistant peut atterrir dans QUATRE familles de règles,
// donc quatre actions serveur différentes. Cet aiguillage vivait en dur dans
// `AssistantIA` ; il est extrait ici pour que le chat de Filou (accueil V2)
// crée EXACTEMENT la même chose que l'écran Règles, sans le réécrire.
//
// Frontière de confiance inchangée : aucune écriture ici, on ne fait que
// choisir l'action serveur. Les gardes admin et la RLS restent côté serveur.
// ============================================================

import {
  upsertRegle,
  upsertCompositionRegle,
  upsertRoleInterditRegle,
  setCohorteEquite,
  type ForceFormulaire,
  type PropositionIaResultat,
} from '@/app/(protected)/regles/actions'

/** Les quatre libellés de puissance, du plus contraignant au plus souple. */
export const FORCE_LABEL: Record<ForceFormulaire, string> = {
  jamais: '🔴 Interdiction ferme',
  sauf_crise: '🟠 À éviter sauf crise',
  evitee: '🟡 Préférence (évitée)',
  si_possible: '🟡 Préférence (si possible)',
}

/** Ordre d'affichage : du dur au mou. */
export const FORCES_ORDRE: ForceFormulaire[] = ['jamais', 'sauf_crise', 'evitee', 'si_possible']

/** Proposition exploitable = au moins un payload prêt à créer. */
export type PropositionExploitable = Extract<PropositionIaResultat, { proposition: unknown }>

/** Écarte le cas d'erreur. Vrai type guard : les deux branches de l'union se
 *  distinguent bien par la présence de `error`. */
export function sansErreur(res: PropositionIaResultat): res is PropositionExploitable {
  return !('error' in res)
}

/** Y a-t-il quelque chose à créer ? Volontairement PAS un type guard : une
 *  proposition non exploitable a le même type qu'une exploitable (seuls ses
 *  payloads manquent), donc annoncer un narrowing ici serait un mensonge au
 *  compilateur — il réduisait la branche « non créable » à `never`. */
export function estCreable(res: PropositionExploitable): boolean {
  return Boolean(res.payload || res.payloadComposition || res.payloadRoleInterdit || res.payloadEquite)
}

/** La puissance que l'IA a proposée (absente pour une cohorte d'équité, qui se
 *  règle par cran d'importance et non par force). */
export function forceProposee(res: PropositionExploitable): ForceFormulaire | null {
  return res.payload?.force ?? res.payloadComposition?.force ?? res.payloadRoleInterdit?.force ?? null
}

/**
 * Crée la règle proposée, en choisissant l'action serveur qui correspond.
 *
 * @param force  puissance retenue par l'humain ; à défaut celle de l'IA.
 * @returns `{ error }` en cas de refus serveur (doublon…), sinon `{}`.
 */
export async function creerRegleProposee(
  res: PropositionExploitable,
  force: ForceFormulaire | null,
): Promise<{ error?: string }> {
  // Cohorte d'équité (#21) : pas de « force », l'importance porte le réglage.
  if (res.payloadEquite) {
    return (
      (await setCohorteEquite(
        res.payloadEquite.dimension,
        res.payloadEquite.tag,
        res.payloadEquite.importance,
      )) ?? {}
    )
  }
  if (res.payloadComposition) {
    return (
      (await upsertCompositionRegle({
        ...res.payloadComposition,
        force: force ?? res.payloadComposition.force,
      })) ?? {}
    )
  }
  if (res.payloadRoleInterdit) {
    return (
      (await upsertRoleInterditRegle({
        ...res.payloadRoleInterdit,
        force: force ?? res.payloadRoleInterdit.force,
      })) ?? {}
    )
  }
  return (await upsertRegle({ ...res.payload!, force: force ?? res.payload!.force })) ?? {}
}
