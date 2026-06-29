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

/** Résultat de résolution d'un prénom : un id, ou la cause de l'échec. */
type ResolutionPrenom =
  | { ok: true; id: string }
  | { ok: false; cause: 'aucun' | 'ambigu' }

/**
 * Résout un prénom (insensible casse/espaces) vers un id de véto.
 * Distingue 0 match (`aucun`) de PLUSIEURS matchs (`ambigu`) : si deux vétos
 * portent le même prénom, on REFUSE de choisir au hasard (le mauvais véto
 * recevrait la règle silencieusement) — l'humain tranchera via le formulaire.
 */
function resoudrePrenom(prenom: string | null, vets: VetoResolu[]): ResolutionPrenom {
  if (!prenom) return { ok: false, cause: 'aucun' }
  const norm = prenom.trim().toLowerCase()
  const matchs = vets.filter((v) => v.prenom.trim().toLowerCase() === norm)
  if (matchs.length === 0) return { ok: false, cause: 'aucun' }
  if (matchs.length > 1) return { ok: false, cause: 'ambigu' }
  return { ok: true, id: matchs[0].id }
}

/** Message d'échec de résolution selon la cause (prénom utilisé dans le texte). */
function raisonPrenom(prenom: string | null, cause: 'aucun' | 'ambigu', second = false): string {
  const qui = second ? 'Second vétérinaire' : 'Vétérinaire'
  if (cause === 'ambigu') {
    return `Plusieurs vétérinaires s'appellent « ${prenom} » : l'assistant ne peut pas deviner lequel. Crée la règle via « Nouvelle règle » en sélectionnant le bon dans la liste.`
  }
  return `${qui} « ${prenom ?? '?'} » introuvable dans le cabinet.`
}

/** Tailles de fenêtre (jours) — un véto fait au plus 1 garde/jour, donc
 *  un plafond ≥ taille de fenêtre n'aura JAMAIS d'effet (= coquille vide). */
const TAILLE_FENETRE: Record<string, number> = {
  semaine_civile: 7,
  glissante_7_jours: 7,
  glissante_14_jours: 14,
  glissante_30_jours: 30,
}
/** Borne haute alignée sur le serveur (N_MAX_GARDES / ECART_MAX_JOURS). */
const N_MAX = 14
const ECART_MAX = 30

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

  const owner = resoudrePrenom(p.veterinaire, vets)
  if (!owner.ok) {
    return { ok: false, raison: raisonPrenom(p.veterinaire, owner.cause) }
  }

  const payload: UpsertReglePayload = {
    brique_id: p.brique_id as BriqueEvaluable,
    owner_id: owner.id,
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
      const part = resoudrePrenom(p.partenaire, vets)
      if (!part.ok) {
        return { ok: false, raison: raisonPrenom(p.partenaire, part.cause, true) }
      }
      if (part.id === owner.id) {
        return { ok: false, raison: 'Un duo interdit doit concerner deux vétérinaires différents.' }
      }
      payload.avec_veterinaire_id = part.id
      break
    }
    case 'au_plus_n': {
      // Garde anti-coquille-vide : un plafond hors bornes ou ≥ taille de
      // fenêtre n'aurait aucun effet → on refuse (pas de bouton « Créer »).
      const n = p.n
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
        return { ok: false, raison: 'Indique un nombre de gardes valide (au moins 1).' }
      }
      if (n > N_MAX) {
        return { ok: false, raison: `Un plafond de ${n} gardes est trop élevé (maximum ${N_MAX}). Indique une valeur plus réaliste.` }
      }
      const fenetre = p.fenetre ?? 'semaine_civile'
      const taille = TAILLE_FENETRE[fenetre] ?? 7
      if (n >= taille) {
        return { ok: false, raison: `Sur ${taille} jours, un vétérinaire ne peut pas faire ${n} gardes : ce plafond n'aurait aucun effet. Choisis un nombre plus petit (par ex. 2 ou 3).` }
      }
      payload.n = n
      payload.fenetre = fenetre
      break
    }
    case 'espacement_min': {
      const e = p.ecart_min_jours
      if (typeof e !== 'number' || !Number.isInteger(e) || e < 1 || e > ECART_MAX) {
        return { ok: false, raison: `Indique un écart minimal valide (entre 1 et ${ECART_MAX} jours).` }
      }
      payload.ecart_min_jours = e
      break
    }
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
