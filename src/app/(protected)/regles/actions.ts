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

/** Active ou désactive une règle (toggle `actif`). */
export async function setRegleActif(id: string, actif: boolean) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const { error } = await supabase
    .from('regles_cabinet')
    .update({ actif })
    .eq('id', id)

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
 * Règle une contrainte structurelle R8 (inversion_role) ou R9 (liaison_creneaux) :
 * son activation (on/off) ET son niveau de force (ferme → préférence). Comme
 * l'équité, ce sont des règles GLOBALES (pas de « qui »). UPSERT manuel par
 * (cabinet, brique). Double garde : assertAdmin + RLS. S'applique à la prochaine
 * génération. ⚠️ Le moteur ET le validateur lisent cette même config.
 */
export async function setStructureRegle(briqueId: string, actif: boolean, force: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde
  const vetoId = garde.veto.id

  if (!BRIQUES_STRUCTURELLES.has(briqueId)) {
    return { error: `Règle structurelle inconnue : « ${briqueId} ».` }
  }
  if (!FORCES_VALIDES.includes(force as ForceFormulaire)) {
    return { error: `Niveau de force invalide : « ${force} ».` }
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

// ── Création / édition guidée (P1A-007) ──────────────────────

/** Les briques que le moteur sait réellement évaluer (mapReglesCabinet). */
const BRIQUES_EVALUABLES = {
  interdire_creneau: 'jour_repos_fixe',
  repos_conditionnel: 'jour_repos_conditionnel',
  alternance_ancre: 'indisponibilite_cyclique',
  duo_interdit: 'duo_interdit',
  au_plus_n: 'au_plus_n',           // limite de charge réglable
  espacement_min: 'espacement_min', // écart minimal entre deux gardes
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

/** Payload envoyé par le formulaire (champs simples — le JSON est bâti ici). */
export interface UpsertReglePayload {
  id?: string // présent = édition
  brique_id: BriqueEvaluable
  owner_id: string
  force: ForceFormulaire
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
  // espacement_min
  ecart_min_jours?: number
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

/** Construit { quand, params } pour les briques NON-duo. Null = erreur (raison). */
function construireParams(
  p: UpsertReglePayload,
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
      return { quand: null, params: { n, fenetre: p.fenetre } }
    }
    case 'espacement_min': {
      const ecart = entierBorne(p.ecart_min_jours, ECART_MAX_JOURS)
      if (ecart === null) return { error: `Écart minimal invalide (1 à ${ECART_MAX_JOURS} jours).` }
      return { quand: null, params: { ecart_min_jours: ecart } }
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

  // ── Cas duo interdit (symétrique) ──────────────────────────
  if (payload.brique_id === 'duo_interdit') {
    const a = payload.owner_id
    const b = payload.avec_veterinaire_id
    if (!b) return { error: 'Sélectionnez le second vétérinaire du duo.' }
    if (a === b) return { error: "Un vétérinaire ne peut pas être en duo interdit avec lui-même." }

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
  const construit = construireParams(payload)
  if ('error' in construit) return construit

  const params_json = envelopper(payload.owner_id, payload.brique_id, construit.quand, construit.params)

  if (payload.id) {
    const { error } = await supabase
      .from('regles_cabinet')
      .update({ brique_id: payload.brique_id, params_json, force: payload.force })
      .eq('id', payload.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('regles_cabinet').insert({
      cabinet_id: cabinetId,
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
