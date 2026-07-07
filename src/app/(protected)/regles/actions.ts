'use server'

// ============================================================
// GUARDVETO — Server actions « Règles du cabinet » (P1A-006 + P1A-007)
// ============================================================
// Écritures sur regles_cabinet :
//   • setRegleActif / deleteRegle  — toggle + suppression (P1A-006)
//   • upsertRegle                  — création/édition guidée (P1A-007)
//
// Double garde : (1) vérification rôle admin côté serveur (message clair),
// (2) RLS regles_cabinet (F5-003) — write admin-only + isolation cabinet
// RESTRICTIVE. Un véto ne peut donc rien écrire, même via appel direct.
//
// ⚠️ Le params_json est TOUJOURS reconstruit côté serveur à partir de champs
//    simples (jamais du JSON fourni par le client) — frontière de confiance.
//    On ne produit QUE les 4 briques que le moteur sait évaluer (sinon règle
//    silencieusement ignorée = coquille vide). Le duo interdit est écrit de
//    façon SYMÉTRIQUE (A→B et B→A) : le solver vérifie chaque véto contre les
//    partenaires déjà posés ; un seul sens laisserait un oubli (cf. R6).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { EQUITY_DIMENSIONS, IMPORTANCE_LEVELS } from '@/engine/equity-weights'
import { construireValiditeJson } from '@/lib/periodes'
import { chargerCreneauModele } from '@/data/chargerCreneauModele'
import { proposerRegleIA, assistantIaDisponible, type TypeCreneauIA } from '@/lib/ia/proposerRegle'
import {
  propositionVersPayload,
  apercuProposition,
  type PropositionRegle,
  type VetoResolu,
} from '@/lib/ia/regleSchema'

// ── Garde admin ──────────────────────────────────────────────

async function getAuthVeto(
  supabase: SupabaseClient<any, any, any>,
): Promise<{ id: string; role_app: string } | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()
  return vet ?? null
}

async function assertAdmin(
  supabase: SupabaseClient<any, any, any>,
): Promise<{ error: string } | { veto: { id: string; role_app: string } }> {
  const veto = await getAuthVeto(supabase)
  if (!veto) return { error: 'Non authentifié.' }
  if (veto.role_app !== 'admin') {
    return { error: "Action réservée à l'administrateur du cabinet." }
  }
  return { veto }
}

// ── Toggle actif (P1A-006) ───────────────────────────────────

/**
 * Active ou désactive une règle (toggle `actif`). Pour un duo interdit, applique
 * AUSSI le même état au sens miroir (B→A) : l'écran n'affiche qu'une ligne par
 * duo, donc le toggle doit basculer les deux rows sinon on laisserait un
 * demi-duo dans un état incohérent (kit complet).
 */
export async function setRegleActif(id: string, actif: boolean) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const ids: string[] = [id]
  const { data: row } = await supabase
    .from('regles_cabinet')
    .select('id, brique_id, params_json')
    .eq('id', id)
    .single()
  if (row && row.brique_id === 'duo_interdit') {
    const owner = lireOwner(row.params_json)
    const partner = lirePartenaire(row.params_json)
    if (owner && partner) {
      const miroir = await trouverDuo(supabase, partner, owner)
      if (miroir && miroir !== id) ids.push(miroir)
    }
  }

  const { error } = await supabase
    .from('regles_cabinet')
    .update({ actif })
    .in('id', ids)

  if (error) return { error: error.message }
  revalidatePath('/regles')
  return { success: true }
}

// ── Suppression (P1A-006, durcie duo en P1A-007) ─────────────

/**
 * Supprime définitivement une règle. Pour un duo interdit, supprime AUSSI le
 * sens miroir (B→A) — sinon il resterait un demi-duo silencieusement inactif
 * côté solver (kit complet : on ne laisse jamais une règle à moitié appliquée).
 */
export async function deleteRegle(id: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  // Récupère la règle pour savoir si c'est un duo (→ supprimer le miroir).
  const { data: row } = await supabase
    .from('regles_cabinet')
    .select('id, brique_id, params_json')
    .eq('id', id)
    .single()

  const ids: string[] = [id]
  if (row && row.brique_id === 'duo_interdit') {
    const owner = lireOwner(row.params_json)
    const partner = lirePartenaire(row.params_json)
    if (owner && partner) {
      const miroir = await trouverDuo(supabase, partner, owner)
      if (miroir && miroir !== id) ids.push(miroir)
    }
  }

  const { error } = await supabase.from('regles_cabinet').delete().in('id', ids)
  if (error) return { error: error.message }
  revalidatePath('/regles')
  return { success: true }
}

// ── Équité = règle de compteur (famille `equilibrer`) ────────

/**
 * Règle l'importance d'UNE dimension d'équité (week-ends, fériés…). L'équité est
 * gérée comme les autres règles, mais de forme différente : elle cible un
 * COMPTEUR (pas un véto). Chaque dimension = une règle `equilibrer` portant son
 * importance (4 crans nommés). Le moteur traduit le cran en poids (equity-weights.ts).
 *
 * UPSERT manuel par (cabinet, dimension) : pas de contrainte d'unicité en base,
 * donc on cherche la règle existante de cette dimension puis update, sinon insert.
 * Double garde : assertAdmin + RLS regles_cabinet (write admin-only, isolation
 * RESTRICTIVE). S'applique à la PROCHAINE génération de planning.
 */
export async function setEquiteImportance(dimension: string, importance: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde
  const vetoId = garde.veto.id

  // Validation stricte (frontière de confiance) contre les référentiels moteur.
  if (!(EQUITY_DIMENSIONS as readonly string[]).includes(dimension)) {
    return { error: `Dimension d'équité inconnue : « ${dimension} ».` }
  }
  if (!(IMPORTANCE_LEVELS as readonly string[]).includes(importance)) {
    return { error: `Niveau d'importance inconnu : « ${importance} ».` }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // params_json minimal : l'équité n'a pas de « qui » (elle est globale au cabinet).
  // Seuls dimension + importance sont lus (extraireEquityRules / rendu catalogue).
  const params_json = { qui: null, quand: null, params: { dimension, importance } }

  // Cherche une règle equilibrer existante pour CETTE dimension (UPSERT manuel).
  const { data: existantes } = await supabase
    .from('regles_cabinet')
    .select('id, params_json')
    .eq('cabinet_id', cabinetId)
    .eq('brique_id', 'equilibrer')

  const match = ((existantes ?? []) as Array<{ id: string; params_json: unknown }>).find(
    (r) => (r.params_json as { params?: { dimension?: string } })?.params?.dimension === dimension,
  )

  if (match) {
    const { error } = await supabase
      .from('regles_cabinet')
      .update({ params_json })
      .eq('id', match.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('regles_cabinet').insert({
      cabinet_id: cabinetId,
      brique_id: 'equilibrer',
      params_json,
      force: 'si_possible', // l'équité vit dans l'étage le plus bas (le cran porte l'importance)
      actif: true,
      created_by: vetoId,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/regles')
  return { success: true }
}

// ── Règles structurelles R8/R9 (réglables : toggle + niveau) ─

/** Les deux briques structurelles réglables. */
const BRIQUES_STRUCTURELLES = new Set(['liaison_creneaux', 'inversion_role'])

/**
 * Pénalités souples réglables (backlog n°16 — R10/R10c/R10b/R8b). Règles
 * GLOBALES comme R8/R9, MAIS structurellement souples : il n'existe AUCUN
 * gardien dur (isValid / validateur) pour elles → la force « jamais » est
 * REFUSÉE à l'écriture (sinon coquille vide : une « interdiction ferme » qui
 * ne bloque rien). Le moteur clampe aussi tout étage < 3 (défense en profondeur).
 */
const BRIQUES_PENALITES_SOUPLES = new Set([
  'eviter_we_consecutifs',    // R10
  'eviter_we_avant_vacances', // R10c
  'eviter_fete_fin_annee',    // R10b
  'inversion_role_ferie',     // R8b
])
const FORCES_SOUPLES = new Set<ForceFormulaire>(['sauf_crise', 'evitee', 'si_possible'])

/**
 * Règle une contrainte structurelle R8 (inversion_role) ou R9 (liaison_creneaux),
 * ou une pénalité souple réglable (R10/R10c/R10b/R8b — backlog n°16) :
 * son activation (on/off) ET son niveau de force. Comme
 * l'équité, ce sont des règles GLOBALES (pas de « qui »). UPSERT manuel par
 * (cabinet, brique). Double garde : assertAdmin + RLS. S'applique à la prochaine
 * génération. ⚠️ Le moteur ET le validateur lisent cette même config.
 */
export async function setStructureRegle(briqueId: string, actif: boolean, force: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde
  const vetoId = garde.veto.id

  const estPenaliteSouple = BRIQUES_PENALITES_SOUPLES.has(briqueId)
  if (!BRIQUES_STRUCTURELLES.has(briqueId) && !estPenaliteSouple) {
    return { error: `Règle structurelle inconnue : « ${briqueId} ».` }
  }
  if (!FORCES_VALIDES.includes(force as ForceFormulaire)) {
    return { error: `Niveau de force invalide : « ${force} ».` }
  }
  if (estPenaliteSouple && !FORCES_SOUPLES.has(force as ForceFormulaire)) {
    return { error: 'Cette règle est une préférence : elle ne peut pas être une interdiction ferme.' }
  }
  if (typeof actif !== 'boolean') {
    return { error: 'État (activé/désactivé) invalide.' }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Règle globale : pas de « qui », pas de params métier.
  const params_json = { qui: null, quand: null, params: {} }

  const { data: existante } = await supabase
    .from('regles_cabinet')
    .select('id')
    .eq('cabinet_id', cabinetId)
    .eq('brique_id', briqueId)
    .maybeSingle()

  if (existante) {
    const { error } = await supabase
      .from('regles_cabinet')
      .update({ actif, force })
      .eq('id', (existante as { id: string }).id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('regles_cabinet').insert({
      cabinet_id: cabinetId,
      brique_id: briqueId,
      params_json,
      force,
      actif,
      created_by: vetoId,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/regles')
  return { success: true }
}

// ── R11b : rôle à avantage financier (réglage cabinet) ───────

const ROLES_AVANTAGE_VALIDES = new Set(['premier', 'second', 'aucun'])

/**
 * Règle QUEL rôle de week-end porte l'avantage financier (équilibré R11b).
 * Écriture via la RPC auto-gardée `set_role_avantage_financier` (la table
 * cabinets n'a pas de policy UPDATE large). Double garde : assertAdmin ici +
 * re-vérification admin DANS la RPC. Effet à la prochaine génération.
 */
export async function setRoleAvantageFinancier(role: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  if (!ROLES_AVANTAGE_VALIDES.has(role)) {
    return { error: 'Valeur invalide (1er, 2nd ou aucun).' }
  }

  const { error } = await supabase.rpc('set_role_avantage_financier', { p_role: role })
  if (error) return { error: error.message }

  revalidatePath('/regles')
  return { success: true }
}

// ── Création / édition guidée (P1A-007) ──────────────────────

/** Les briques que le moteur sait réellement évaluer (mapReglesCabinet). */
const BRIQUES_EVALUABLES = {
  interdire_creneau: 'jour_repos_fixe',
  repos_conditionnel: 'jour_repos_conditionnel',
  alternance_ancre: 'indisponibilite_cyclique',
  duo_interdit: 'duo_interdit',
  au_plus_n: 'au_plus_n',           // limite de charge réglable
  espacement_min: 'espacement_min', // écart minimal entre deux gardes
  espacement_weekend: 'espacement_weekend', // fréquence WE : au plus 1 WE sur N
} as const
export type BriqueEvaluable = keyof typeof BRIQUES_EVALUABLES

/** Forces sélectionnables par l'admin (les niveaux système sont exclus). */
const FORCES_VALIDES = ['jamais', 'sauf_crise', 'evitee', 'si_possible'] as const
export type ForceFormulaire = (typeof FORCES_VALIDES)[number]

const JOURS_VALIDES = new Set(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'])
const SEMAINES_VALIDES = new Set(['paires', 'impaires', 'toutes'])
const PERIODES_VALIDES = new Set(['soir_semaine', 'weekend']) // seules évaluées par R2
// Fenêtres de comptage acceptées par checkAuPlusN (hard-constraints.ts) :
// « semaine_civile » (lundi→dimanche) ou « glissante_K_jours » (regex moteur).
const FENETRES_VALIDES = new Set([
  'semaine_civile', 'glissante_7_jours', 'glissante_14_jours', 'glissante_30_jours',
])
const N_MAX_GARDES = 14    // borne haute raisonnable (au plus N gardes / fenêtre)
const ECART_MAX_JOURS = 30 // borne haute raisonnable (espacement minimal)
// Fréquence WE : « 1 week-end sur N ». N=1 = aucune contrainte (inerte) → min 2.
const N_SEM_WE_MIN = 2
const N_SEM_WE_MAX = 26    // une période fait 12-17 semaines : 26 couvre large

/** Payload envoyé par le formulaire (champs simples — le JSON est bâti ici). */
export interface UpsertReglePayload {
  id?: string // présent = édition
  brique_id: BriqueEvaluable
  owner_id: string
  force: ForceFormulaire
  /** null/absent = règle permanente ; un id = règle limitée à cette période. */
  periode_id?: string | null
  // interdire_creneau
  jour?: string
  exception_vacances_scolaires?: boolean
  // repos_conditionnel
  si_garde_we?: string
  sinon?: string
  // alternance_ancre
  semaines?: string
  periodes?: string[]
  // duo_interdit
  avec_veterinaire_id?: string
  // au_plus_n
  n?: number
  fenetre?: string
  /** Filtre optionnel par types de créneaux du cabinet (axe `quoi`, n°19).
   *  Vide/absent = toutes les gardes comptent (comportement historique). */
  creneaux?: string[]
  // espacement_min
  ecart_min_jours?: number
  // espacement_weekend
  n_semaines?: number
}

/** Parse un entier dans [1, max]. Retourne null si invalide (frontière de confiance). */
function entierBorne(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN
  if (!Number.isInteger(n) || n < 1 || n > max) return null
  return n
}

function lireOwner(pj: unknown): string | null {
  const refs = (pj as { qui?: { refs?: unknown } })?.qui?.refs
  return Array.isArray(refs) && typeof refs[0] === 'string' ? refs[0] : null
}
function lirePartenaire(pj: unknown): string | null {
  const a = (pj as { params?: { avec_veterinaire_id?: unknown } })?.params?.avec_veterinaire_id
  return typeof a === 'string' ? a : null
}

/** Types de créneaux historiques — repli quand le cabinet n'a pas de catalogue. */
const CODES_CRENEAUX_HISTORIQUES = ['semaine_soir', 'vendredi_soir', 'weekend'] as const

/**
 * Codes de créneaux VALIDES du cabinet (référentiel dynamique — verrou 8 :
 * on référence les types DU cabinet, jamais un enum figé). Catalogue actif du
 * profil défaut ; sans catalogue → repli sur les 3 types historiques.
 */
async function chargerCodesCreneauxValides(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
): Promise<Set<string>> {
  const modeles = await chargerCreneauModele(supabase, cabinetId)
  const codes = modeles
    .filter((m) => m.actif && m.code !== null && m.code !== 'ferie')
    .map((m) => m.code as string)
  return new Set(codes.length > 0 ? codes : CODES_CRENEAUX_HISTORIQUES)
}

/** Construit { quand, params } pour les briques NON-duo. Null = erreur (raison).
 *  `codesCreneaux` : référentiel du cabinet, requis SEULEMENT si un filtre de
 *  créneaux est demandé (au_plus_n, n°19). */
function construireParams(
  p: UpsertReglePayload,
  codesCreneaux?: Set<string>,
): { quand: unknown; params: Record<string, unknown> } | { error: string } {
  switch (p.brique_id) {
    case 'interdire_creneau': {
      if (!p.jour || !JOURS_VALIDES.has(p.jour)) return { error: 'Jour de repos invalide.' }
      return {
        quand: p.jour,
        params: { jour: p.jour, exception_vacances_scolaires: Boolean(p.exception_vacances_scolaires) },
      }
    }
    case 'repos_conditionnel': {
      if (!p.si_garde_we || !JOURS_VALIDES.has(p.si_garde_we)) return { error: 'Jour « si garde WE » invalide.' }
      if (!p.sinon || !JOURS_VALIDES.has(p.sinon)) return { error: 'Jour « sinon » invalide.' }
      return { quand: null, params: { si_garde_we: p.si_garde_we, sinon: p.sinon } }
    }
    case 'alternance_ancre': {
      if (!p.semaines || !SEMAINES_VALIDES.has(p.semaines)) return { error: 'Cadence (semaines) invalide.' }
      const periodes = (p.periodes ?? []).filter((x) => PERIODES_VALIDES.has(x))
      if (periodes.length === 0) return { error: 'Sélectionnez au moins une période (soirs / week-ends).' }
      return { quand: periodes[0], params: { semaines: p.semaines, periodes } }
    }
    case 'au_plus_n': {
      const n = entierBorne(p.n, N_MAX_GARDES)
      if (n === null) return { error: `Nombre de gardes invalide (1 à ${N_MAX_GARDES}).` }
      if (!p.fenetre || !FENETRES_VALIDES.has(p.fenetre)) return { error: 'Fenêtre de comptage invalide.' }
      // Axe `quoi` (n°19) : filtre optionnel par types de créneaux du cabinet.
      // Frontière de confiance : chaque code DOIT exister dans le référentiel
      // du cabinet (un code fantôme rendrait la règle silencieusement inerte).
      const creneaux = [
        ...new Set((p.creneaux ?? []).filter((x) => typeof x === 'string' && x.trim() !== '')),
      ]
      if (creneaux.length > 0) {
        if (!codesCreneaux) return { error: 'Types de créneaux du cabinet indisponibles.' }
        const inconnus = creneaux.filter((c) => !codesCreneaux.has(c))
        if (inconnus.length > 0) {
          return { error: `Type(s) de créneau inconnu(s) pour ce cabinet : ${inconnus.join(', ')}.` }
        }
        return { quand: null, params: { n, fenetre: p.fenetre, creneaux } }
      }
      return { quand: null, params: { n, fenetre: p.fenetre } }
    }
    case 'espacement_min': {
      const ecart = entierBorne(p.ecart_min_jours, ECART_MAX_JOURS)
      if (ecart === null) return { error: `Écart minimal invalide (1 à ${ECART_MAX_JOURS} jours).` }
      return { quand: null, params: { ecart_min_jours: ecart } }
    }
    case 'espacement_weekend': {
      const n = entierBorne(p.n_semaines, N_SEM_WE_MAX)
      if (n === null || n < N_SEM_WE_MIN) {
        return { error: `Fréquence de week-end invalide (un week-end sur ${N_SEM_WE_MIN} à ${N_SEM_WE_MAX}).` }
      }
      return { quand: null, params: { n_semaines: n } }
    }
    default:
      return { error: 'Brique non gérée par ce constructeur.' }
  }
}

/** Enveloppe params_json complète attendue par le mapper + le rendu. */
function envelopper(
  ownerId: string,
  briqueId: BriqueEvaluable,
  quand: unknown,
  params: Record<string, unknown>,
): Record<string, unknown> {
  return {
    qui: { type: 'veterinaire', refs: [ownerId] },
    quand: quand ?? null,
    params,
    _source: { type_v1: BRIQUES_EVALUABLES[briqueId] },
  }
}

/**
 * Valide une période de scoping : `null`/'' ⇒ permanente (ok). Un id ⇒ il DOIT
 * exister une période de CE cabinet (RLS-scope auto). Retourne l'id normalisé
 * (null si permanente) ou une erreur. Frontière de confiance.
 */
async function resoudrePeriodeScoping(
  supabase: SupabaseClient<any, any, any>,
  periodeId: string | null | undefined,
): Promise<{ periode_id: string | null } | { error: string }> {
  if (!periodeId) return { periode_id: null }
  const { data, error } = await supabase
    .from('periodes')
    .select('id')
    .eq('id', periodeId)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Période sélectionnée introuvable pour ce cabinet.' }
  return { periode_id: periodeId }
}

/**
 * Une règle équivalente existe-t-elle déjà (même brique + même véto + mêmes
 * paramètres métier) ? Évite les doublons silencieux à la création. Compare la
 * signature `params` (construite par le même code des deux côtés → ordre des
 * clés déterministe). Les duos sont traités à part (paire non ordonnée).
 */
async function trouverEquivalent(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
  briqueId: BriqueEvaluable,
  ownerId: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  const { data } = await supabase
    .from('regles_cabinet')
    .select('id, params_json')
    .eq('cabinet_id', cabinetId)
    .eq('brique_id', briqueId)
  const cible = JSON.stringify(params)
  for (const r of data ?? []) {
    if (lireOwner(r.params_json) !== ownerId) continue
    const p = (r.params_json as { params?: unknown })?.params ?? {}
    if (JSON.stringify(p) === cible) return true
  }
  return false
}

/** Cherche l'id d'un duo owner→partner pour ce cabinet (RLS scope auto). */
async function trouverDuo(
  supabase: SupabaseClient<any, any, any>,
  owner: string,
  partner: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('regles_cabinet')
    .select('id, params_json')
    .eq('brique_id', 'duo_interdit')
  for (const r of data ?? []) {
    if (lireOwner(r.params_json) === owner && lirePartenaire(r.params_json) === partner) {
      return r.id as string
    }
  }
  return null
}

/**
 * Crée ou édite une règle. Le params_json est reconstruit ici (jamais reçu du
 * client). Le duo interdit est maintenu SYMÉTRIQUE (A→B + B→A).
 */
export async function upsertRegle(payload: UpsertReglePayload) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde
  const vetoId = garde.veto.id

  if (!(payload.brique_id in BRIQUES_EVALUABLES)) {
    return { error: 'Type de règle non pris en charge par le moteur.' }
  }
  if (!FORCES_VALIDES.includes(payload.force)) {
    return { error: 'Niveau de force invalide.' }
  }
  if (!payload.owner_id) {
    return { error: 'Sélectionnez le vétérinaire concerné.' }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Validité : permanente (null) ou limitée à une période existante du cabinet.
  // C'est `periode_id` que le loader moteur filtre ; validite_json en est le miroir.
  const scope = await resoudrePeriodeScoping(supabase, payload.periode_id)
  if ('error' in scope) return scope
  const periode_id = scope.periode_id
  const validite_json = construireValiditeJson(periode_id)

  // ── Cas duo interdit (symétrique) ──────────────────────────
  if (payload.brique_id === 'duo_interdit') {
    const a = payload.owner_id
    const b = payload.avec_veterinaire_id
    if (!b) return { error: 'Sélectionnez le second vétérinaire du duo.' }
    if (a === b) return { error: "Un vétérinaire ne peut pas être en duo interdit avec lui-même." }

    // Anti-doublon (création seulement) : la paire existe-t-elle déjà ?
    if (!payload.id) {
      const dejaLa = (await trouverDuo(supabase, a, b)) ?? (await trouverDuo(supabase, b, a))
      if (dejaLa) return { error: 'Ce duo interdit existe déjà dans les règles du cabinet.' }
    }

    let actif = true
    // Édition : on retire l'ancienne paire avant de réécrire la nouvelle.
    if (payload.id) {
      const { data: old } = await supabase
        .from('regles_cabinet')
        .select('id, actif, params_json')
        .eq('id', payload.id)
        .single()
      if (old) {
        actif = old.actif
        const oldOwner = lireOwner(old.params_json)
        const oldPartner = lirePartenaire(old.params_json)
        const aSupprimer: string[] = [payload.id]
        if (oldOwner && oldPartner) {
          const miroir = await trouverDuo(supabase, oldPartner, oldOwner)
          if (miroir && miroir !== payload.id) aSupprimer.push(miroir)
        }
        await supabase.from('regles_cabinet').delete().in('id', aSupprimer)
      }
    }

    const ligne = (owner: string, partner: string) => ({
      cabinet_id: cabinetId,
      periode_id,
      validite_json,
      brique_id: 'duo_interdit',
      params_json: envelopper(owner, 'duo_interdit', null, { avec_veterinaire_id: partner }),
      force: payload.force,
      actif,
      created_by: vetoId,
    })

    const { error } = await supabase
      .from('regles_cabinet')
      .insert([ligne(a, b), ligne(b, a)])
    if (error) return { error: error.message }
    revalidatePath('/regles')
    return { success: true }
  }

  // ── Cas briques non-duo ────────────────────────────────────
  // Référentiel de créneaux du cabinet : chargé SEULEMENT si un filtre est
  // demandé (au_plus_n, n°19) — zéro requête supplémentaire sinon.
  const besoinCodes =
    payload.brique_id === 'au_plus_n' && (payload.creneaux ?? []).length > 0
  const codesCreneaux = besoinCodes
    ? await chargerCodesCreneauxValides(supabase, cabinetId)
    : undefined
  const construit = construireParams(payload, codesCreneaux)
  if ('error' in construit) return construit

  // Anti-doublon (création seulement) : règle identique déjà présente ?
  if (!payload.id) {
    const dejaLa = await trouverEquivalent(
      supabase, cabinetId, payload.brique_id, payload.owner_id, construit.params,
    )
    if (dejaLa) return { error: 'Une règle identique existe déjà pour ce vétérinaire.' }
  }

  const params_json = envelopper(payload.owner_id, payload.brique_id, construit.quand, construit.params)

  if (payload.id) {
    const { error } = await supabase
      .from('regles_cabinet')
      .update({ brique_id: payload.brique_id, params_json, force: payload.force, periode_id, validite_json })
      .eq('id', payload.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('regles_cabinet').insert({
      cabinet_id: cabinetId,
      periode_id,
      validite_json,
      brique_id: payload.brique_id,
      params_json,
      force: payload.force,
      actif: true,
      created_by: vetoId,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/regles')
  return { success: true }
}

// ── Assistant IA (Palier 3, slice 1) ─────────────────────────

/** Résultat d'une proposition IA renvoyé à l'UI. */
export type PropositionIaResultat =
  | { error: string }
  | {
      proposition: PropositionRegle
      /** Phrase d'aperçu (ce qui serait créé) — présente si faisable. */
      apercu: string
      /** Payload prêt pour upsertRegle — présent SEULEMENT si la proposition
       *  est exploitable (brique + vétos résolus). Absent si non faisable. */
      payload?: UpsertReglePayload
    }

/**
 * proposerRegleDepuisTexte — passe une phrase admin à l'IA et renvoie une
 * PROPOSITION (jamais d'écriture en base). L'admin créera ensuite via
 * upsertRegle (frontière de confiance + RLS inchangées). Admin-only.
 */
export async function proposerRegleDepuisTexte(phrase: string): Promise<PropositionIaResultat> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  if (!assistantIaDisponible()) {
    return { error: 'Assistant IA non configuré (clé API manquante côté serveur).' }
  }
  if (!phrase || phrase.trim().length < 3) {
    return { error: 'Décris ta règle en quelques mots.' }
  }

  const { data: vetsDb } = await supabase
    .from('veterinaires')
    .select('id, prenom')
    .eq('actif', true)
    .order('prenom')
  const vets = ((vetsDb as VetoResolu[] | null) ?? [])

  // Types de créneaux DU cabinet (dynamiques — verrou 8) : l'IA peut proposer
  // un filtre `creneaux` pour au_plus_n (« max 2 week-ends par mois », n°19).
  // Best-effort : sans cabinet/catalogue → types historiques.
  let typesCreneaux: TypeCreneauIA[] = []
  try {
    const cabinetId = await resoudreCabinetId(supabase)
    const modeles = await chargerCreneauModele(supabase, cabinetId)
    typesCreneaux = modeles
      .filter((m) => m.actif && m.code !== null && m.code !== 'ferie')
      .map((m) => ({ code: m.code as string, nom: m.nom }))
  } catch {
    // silencieux : repli ci-dessous
  }
  if (typesCreneaux.length === 0) {
    typesCreneaux = [
      { code: 'semaine_soir', nom: 'Soirs de semaine' },
      { code: 'vendredi_soir', nom: 'Vendredi soir' },
      { code: 'weekend', nom: 'Week-end' },
    ]
  }

  let proposition: PropositionRegle
  try {
    proposition = await proposerRegleIA(phrase.trim(), vets, typesCreneaux)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur de l'assistant IA." }
  }

  const conv = propositionVersPayload(proposition, vets)
  if (!conv.ok) {
    // Non faisable / ambigu / sans effet : on FORCE le message sur la raison de
    // notre couche (ex. « plafond sans effet, prends un nombre plus petit »).
    // Sinon l'UI afficherait le message OPTIMISTE de l'IA (« je propose de
    // limiter à 20… ») alors qu'on refuse — incohérent. Pas de payload → pas de
    // bouton « Créer ».
    return {
      proposition: { ...proposition, faisable: false, message: conv.raison },
      apercu: '',
    }
  }
  return { proposition, apercu: apercuProposition(proposition), payload: conv.payload }
}
