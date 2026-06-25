// ============================================================
// GUARDVETO — Assistant IA : schéma de proposition de règle (Palier 3, slice 1)
// ============================================================
// L'IA traduit une phrase en langage naturel → une PROPOSITION de règle
// structurée. Elle travaille en termes HUMAINS (prénoms, jours) ; le serveur
// résout ensuite en ids + valide via le `upsertRegle` existant (frontière de
// confiance inchangée). L'IA PROPOSE, l'humain DÉCIDE (manifeste éthique).
//
// Ce module est PUR (zod + conversion) → entièrement testable, AUCUN appel API.
// Il ne propose QUE les 6 briques évaluables par le moteur (anti-coquille-vide).
// ============================================================

import { z } from 'zod'
import type { BriqueEvaluable, ForceFormulaire, UpsertReglePayload } from '@/app/(protected)/regles/actions'
import { rendreRegle } from '@/engine/briques/catalogue'

/** Les 6 briques que l'IA peut proposer (= évaluables par le moteur). */
export const BRIQUES_IA = [
  'interdire_creneau',
  'repos_conditionnel',
  'alternance_ancre',
  'duo_interdit',
  'au_plus_n',
  'espacement_min',
] as const

export const FORCES_IA = ['jamais', 'sauf_crise', 'evitee', 'si_possible'] as const

/**
 * Schéma de la proposition produite par l'IA (sortie structurée).
 * Tous les params sont optionnels (l'IA ne remplit que ceux de la brique
 * choisie) ; la validation métier STRICTE reste côté serveur (construireParams).
 */
export const PropositionRegleSchema = z.object({
  /** Ce que l'IA a compris de la demande, reformulé en français. */
  comprehension: z.string(),
  /** true si la demande se traduit en une brique disponible. */
  faisable: z.boolean(),
  /**
   * Message à l'utilisateur : explication, demande de précision si ambigu, ou
   * raison si non faisable (ex. « cette contrainte n'est pas gérable »).
   */
  message: z.string(),
  /** Prénom du vétérinaire concerné (tel qu'écrit dans la liste fournie). */
  veterinaire: z.string().nullable(),
  brique_id: z.enum(BRIQUES_IA).nullable(),
  force: z.enum(FORCES_IA).nullable(),
  // ── Paramètres (selon la brique) ───────────────────────────
  jour: z.string().nullable(),
  exception_vacances_scolaires: z.boolean().nullable(),
  si_garde_we: z.string().nullable(),
  sinon: z.string().nullable(),
  semaines: z.enum(['paires', 'impaires', 'toutes']).nullable(),
  periodes: z.array(z.enum(['soir_semaine', 'weekend'])).nullable(),
  /** Prénom du second vétérinaire (duo interdit). */
  partenaire: z.string().nullable(),
  n: z.number().int().nullable(),
  fenetre: z.enum(['semaine_civile', 'glissante_7_jours', 'glissante_14_jours', 'glissante_30_jours']).nullable(),
  ecart_min_jours: z.number().int().nullable(),
})

export type PropositionRegle = z.infer<typeof PropositionRegleSchema>

/** Vétérinaire minimal pour la résolution prénom → id. */
export interface VetoResolu {
  id: string
  prenom: string
}

/** Résout un prénom (insensible casse/espaces) vers un id de véto. */
function resoudrePrenom(prenom: string | null, vets: VetoResolu[]): string | null {
  if (!prenom) return null
  const norm = prenom.trim().toLowerCase()
  return vets.find((v) => v.prenom.trim().toLowerCase() === norm)?.id ?? null
}

export type ConversionResultat =
  | { ok: true; payload: UpsertReglePayload }
  | { ok: false; raison: string }

/**
 * propositionVersPayload — convertit une proposition IA (termes humains) en
 * UpsertReglePayload (ids), PUR. Ne fait AUCUNE validation métier profonde :
 * c'est `upsertRegle`/`construireParams` (serveur) qui valide à la création.
 * Échoue seulement si la proposition est inexploitable (brique/véto manquants).
 */
export function propositionVersPayload(
  p: PropositionRegle,
  vets: VetoResolu[],
): ConversionResultat {
  if (!p.faisable) return { ok: false, raison: p.message || 'Demande non traduisible en règle.' }
  if (!p.brique_id) return { ok: false, raison: 'Type de règle non déterminé par l’assistant.' }

  const ownerId = resoudrePrenom(p.veterinaire, vets)
  if (!ownerId) {
    return { ok: false, raison: `Vétérinaire « ${p.veterinaire ?? '?'} » introuvable dans le cabinet.` }
  }

  const payload: UpsertReglePayload = {
    brique_id: p.brique_id as BriqueEvaluable,
    owner_id: ownerId,
    force: (p.force ?? 'sauf_crise') as ForceFormulaire,
  }

  switch (p.brique_id) {
    case 'interdire_creneau':
      payload.jour = p.jour ?? undefined
      payload.exception_vacances_scolaires = p.exception_vacances_scolaires ?? false
      break
    case 'repos_conditionnel':
      payload.si_garde_we = p.si_garde_we ?? undefined
      payload.sinon = p.sinon ?? undefined
      break
    case 'alternance_ancre':
      payload.semaines = p.semaines ?? undefined
      payload.periodes = p.periodes ?? undefined
      break
    case 'duo_interdit': {
      const partenaireId = resoudrePrenom(p.partenaire, vets)
      if (!partenaireId) {
        return { ok: false, raison: `Second vétérinaire « ${p.partenaire ?? '?'} » introuvable.` }
      }
      payload.avec_veterinaire_id = partenaireId
      break
    }
    case 'au_plus_n':
      payload.n = p.n ?? undefined
      payload.fenetre = p.fenetre ?? undefined
      break
    case 'espacement_min':
      payload.ecart_min_jours = p.ecart_min_jours ?? undefined
      break
  }

  return { ok: true, payload }
}

/**
 * apercuProposition — rend la proposition en une phrase française (le même
 * rendu que la liste /regles), à partir des termes humains de la proposition.
 * Pur ; renvoie '' si la brique n'est pas déterminée.
 */
export function apercuProposition(p: PropositionRegle): string {
  if (!p.brique_id) return ''
  let params: Record<string, unknown> = {}
  switch (p.brique_id) {
    case 'interdire_creneau':
      params = { jour: p.jour, exception_vacances_scolaires: p.exception_vacances_scolaires ?? false }
      break
    case 'repos_conditionnel':
      params = { si_garde_we: p.si_garde_we, sinon: p.sinon }
      break
    case 'alternance_ancre':
      params = { semaines: p.semaines, periodes: p.periodes ?? [] }
      break
    case 'duo_interdit':
      // Le partenaire est un prénom : nomVeto le renvoie tel quel.
      params = { avec_veterinaire_id: p.partenaire }
      break
    case 'au_plus_n':
      params = { n: p.n, fenetre: p.fenetre }
      break
    case 'espacement_min':
      params = { ecart_min_jours: p.ecart_min_jours }
      break
  }
  const predicat = rendreRegle(p.brique_id, params, { nomVeto: (x) => x })
  return p.veterinaire ? `${p.veterinaire} ${predicat}` : predicat
}
