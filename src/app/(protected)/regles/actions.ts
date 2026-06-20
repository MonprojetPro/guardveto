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

// ── Poids d'équité configurables (curseurs cabinet) ──────────

/**
 * Les 6 poids d'équité réglables. Bornes volontairement larges (0–500) :
 * 0 = on ignore cette dimension, valeurs hautes = on la priorise fortement.
 * Le défaut métier (DEFAULT_EQUITY_WEIGHTS côté moteur) est : WE 100, WE_1er 25,
 * fériés 60, semaine_1er 30, semaine_2nd 10, grands_WE 60.
 */
export interface EquiteCabinetPayload {
  we_garde: number
  we_premier_role: number
  feries: number
  semaine_premier: number
  semaine_second: number
  grands_we: number
}

const EQUITE_MIN = 0
const EQUITE_MAX = 500

/**
 * Enregistre les 6 poids d'équité du cabinet (curseurs). UPSERT sur la clé
 * cabinet_id (une ligne par cabinet). Double garde : assertAdmin (message clair)
 * + RLS equite_cabinet (write admin-only, isolation RESTRICTIVE). S'applique à
 * la PROCHAINE génération de planning. Aucune valeur n'est lue depuis le client
 * sans validation (chaque poids doit être un nombre fini dans [0, 500]).
 */
export async function setEquiteCabinet(payload: EquiteCabinetPayload) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde
  const vetoId = garde.veto.id

  // Validation stricte côté serveur (frontière de confiance).
  const champs: Array<keyof EquiteCabinetPayload> = [
    'we_garde', 'we_premier_role', 'feries', 'semaine_premier', 'semaine_second', 'grands_we',
  ]
  for (const k of champs) {
    const v = payload[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < EQUITE_MIN || v > EQUITE_MAX) {
      return { error: `Valeur d'équité invalide pour « ${k} » (attendu entre ${EQUITE_MIN} et ${EQUITE_MAX}).` }
    }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  const { error } = await supabase
    .from('equite_cabinet')
    .upsert(
      {
        cabinet_id: cabinetId,
        we_garde: payload.we_garde,
        we_premier_role: payload.we_premier_role,
        feries: payload.feries,
        semaine_premier: payload.semaine_premier,
        semaine_second: payload.semaine_second,
        grands_we: payload.grands_we,
        updated_by: vetoId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'cabinet_id' },
    )

  if (error) return { error: error.message }
  revalidatePath('/regles')
  return { success: true }
}

// ── Création / édition guidée (P1A-007) ──────────────────────

/** Les 4 briques que le moteur sait réellement évaluer (mapReglesCabinet). */
const BRIQUES_EVALUABLES = {
  interdire_creneau: 'jour_repos_fixe',
  repos_conditionnel: 'jour_repos_conditionnel',
  alternance_ancre: 'indisponibilite_cyclique',
  duo_interdit: 'duo_interdit',
} as const
export type BriqueEvaluable = keyof typeof BRIQUES_EVALUABLES

/** Forces sélectionnables par l'admin (les niveaux système sont exclus). */
const FORCES_VALIDES = ['jamais', 'sauf_crise', 'evitee', 'si_possible'] as const
export type ForceFormulaire = (typeof FORCES_VALIDES)[number]

const JOURS_VALIDES = new Set(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'])
const SEMAINES_VALIDES = new Set(['paires', 'impaires', 'toutes'])
const PERIODES_VALIDES = new Set(['soir_semaine', 'weekend']) // seules évaluées par R2

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
