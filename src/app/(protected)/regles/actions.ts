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
import { empreinteRegle, paramsDeRow } from '@/lib/regles/identiteRegle'
import {
  BRIQUES_EVALUABLES, BRIQUES_DESIDERATA, FORCES_VALIDES,
  CODES_CRENEAUX_HISTORIQUES,
  construireParams, envelopper, lireOwner, lirePartenaire,
  type BriqueEvaluable, type ForceFormulaire, type UpsertReglePayload,
} from '@/lib/regles/paramsRegle'

// ⛔ NE JAMAIS RÉEXPORTER UN TYPE DEPUIS CE FICHIER.
//
//    `export type { X }` paraît inoffensif — le type est effacé à la
//    compilation, donc « ça ne peut pas violer la règle des exports async ».
//    C'est FAUX ici, et ça a mis la production à terre le 2026-08-02 :
//
//        ReferenceError: BriqueEvaluable is not defined
//        at module evaluation (.next/server/chunks/…)
//
//    Le transformateur `'use server'` recense les exports du module pour les
//    enregistrer comme actions AVANT que les types ne soient effacés : il émet
//    donc un vrai export runtime pour un symbole qui n'existe pas. Le build
//    passe, `tsc` passe, et la page tombe en blanc à la première validation.
//
//    Les types se déclarent ICI (`export interface`, `export type X = …` :
//    ceux-là vont bien, ils sont reconnus comme des déclarations de type) ou
//    s'importent DEPUIS LEUR MODULE (`@/lib/regles/paramsRegle`,
//    `@/data/verifierRegleCandidate`) — jamais réexportés au passage.

import { verifierRegleCandidate } from '@/data/verifierRegleCandidate'
import { refusSiBloquant } from '@/data/controleImpact'
import type { VerdictGardien } from '@/data/verifierRegleCandidate'
import type { RegleCabinetRow } from '@/data/mapReglesCabinet'
import { chargerContexteIA } from '@/lib/ia/contexteCabinet'
import { proposerRegleIA, assistantIaDisponible, type TypeCreneauIA } from '@/lib/ia/proposerRegle'
import {
  propositionVersPayload,
  propositionVersComposition,
  propositionVersRoleInterdit,
  propositionVersEquite,
  apercuProposition,
  type PropositionRegle,
  type VetoResolu,
  type CohorteEquitePayload,
} from '@/lib/ia/regleSchema'

/**
 * Les DEUX écrans qui montrent les règles du cabinet.
 *
 * `/regles` les liste toutes ; `/equipe` en montre la part qui concerne chaque
 * véto, sur sa fiche (« Ses contraintes »). Toucher à une règle sans revalider
 * les deux, c'est le grand classique du consumer oublié : on modifie depuis une
 * porte, et l'autre continue d'afficher l'ancienne version sans rien signaler.
 */
function revaliderRegles() {
  revalidatePath('/regles')
  revalidatePath('/equipe')
}

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
  revaliderRegles()
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
  revaliderRegles()
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

  // Cherche une règle equilibrer GLOBALE (SANS tag) pour CETTE dimension
  // (UPSERT manuel). ⚠️ On ne matche QUE les lignes sans tag : les cohortes
  // (Vague 6 #21) sont des lignes distinctes par (dimension, tag) — la globale
  // ne doit jamais écraser une cohorte, ni l'inverse.
  const { data: existantes } = await supabase
    .from('regles_cabinet')
    .select('id, params_json')
    .eq('cabinet_id', cabinetId)
    .eq('brique_id', 'equilibrer')

  const match = ((existantes ?? []) as Array<{ id: string; params_json: unknown }>).find((r) => {
    const p = (r.params_json as { params?: { dimension?: string; tag?: unknown } })?.params
    const t = typeof p?.tag === 'string' ? p.tag.trim() : ''
    return p?.dimension === dimension && t === '' // globale = sans tag
  })

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

  revaliderRegles()
  return { success: true }
}

// ── Cohortes d'équité par tag (Vague 6 tranche A — #21) ──────
//
// Une COHORTE = une règle `equilibrer` avec un TAG en plus de dimension +
// importance : l'équité de cette dimension n'est équilibrée QUE sur les vétos
// porteurs du tag. UPSERT manuel par (cabinet, dimension, tag) — une ligne
// distincte de la dimension globale (sans tag) et des autres cohortes.
// Double garde : assertAdmin + RLS regles_cabinet (write admin-only, isolation
// RESTRICTIVE). S'applique à la PROCHAINE génération.

/** Une cohorte telle que renvoyée à l'UI (liste des cohortes posées). */
export interface CohorteEquiteUI {
  id: string
  dimension: string
  tag: string
  importance: string
}

/**
 * Crée ou met à jour l'importance d'une cohorte d'équité (dimension × tag).
 * `importance = 'ignoree'` supprime la cohorte (0 = inerte : pas de ligne à
 * poids nul en base). Le tag DOIT être porté par au moins un véto actif
 * (anti-coquille-vide ; le pré-vol le re-signale). Frontière de confiance :
 * dimension/importance/tag reconstruits + validés ici.
 */
export async function setCohorteEquite(dimension: string, tag: string, importance: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde
  const vetoId = garde.veto.id

  if (!(EQUITY_DIMENSIONS as readonly string[]).includes(dimension)) {
    return { error: `Dimension d'équité inconnue : « ${dimension} ».` }
  }
  if (!(IMPORTANCE_LEVELS as readonly string[]).includes(importance)) {
    return { error: `Niveau d'importance inconnu : « ${importance} ».` }
  }
  const tagNorm = (tag ?? '').trim().toLowerCase()
  if (tagNorm === '' || tagNorm.length > TAG_MAX_LONGUEUR) {
    return { error: `Étiquette invalide (1 à ${TAG_MAX_LONGUEUR} caractères).` }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Anti-coquille-vide : le tag doit être porté par au moins un véto actif.
  const { data: vetsTags } = await supabase
    .from('veterinaires')
    .select('tags')
    .eq('actif', true)
  const tagPorte = ((vetsTags as { tags?: string[] | null }[] | null) ?? []).some((v) =>
    (v.tags ?? []).some((t) => t.trim().toLowerCase() === tagNorm),
  )
  if (!tagPorte) {
    return {
      error: `Aucun vétérinaire actif ne porte l'étiquette « ${tagNorm} ». Ajoute-la d'abord sur les fiches concernées (page Équipe).`,
    }
  }

  // Cherche la cohorte existante (même dimension + même tag).
  const { data: existantes } = await supabase
    .from('regles_cabinet')
    .select('id, params_json')
    .eq('cabinet_id', cabinetId)
    .eq('brique_id', 'equilibrer')
  const match = ((existantes ?? []) as Array<{ id: string; params_json: unknown }>).find((r) => {
    const p = (r.params_json as { params?: { dimension?: string; tag?: unknown } })?.params
    const t = typeof p?.tag === 'string' ? p.tag.trim().toLowerCase() : ''
    return p?.dimension === dimension && t === tagNorm
  })

  // « Ignorée » = 0 (inerte) → on SUPPRIME la cohorte plutôt que de stocker une
  // ligne à poids nul (byte-identique : aucune entrée cohorte côté moteur).
  if (importance === 'ignoree') {
    if (match) {
      const { error } = await supabase.from('regles_cabinet').delete().eq('id', match.id)
      if (error) return { error: error.message }
    }
    revaliderRegles()
    return { success: true }
  }

  const params_json = {
    qui: null,
    quand: null,
    params: { dimension, importance, tag: tagNorm },
  }

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
      force: 'si_possible',
      actif: true,
      created_by: vetoId,
    })
    if (error) return { error: error.message }
  }

  revaliderRegles()
  return { success: true }
}

/** Supprime une cohorte d'équité par son id de règle. Admin-only + RLS. */
export async function deleteCohorteEquite(id: string) {
  const supabase = await createClient()
  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde
  const { error } = await supabase.from('regles_cabinet').delete().eq('id', id)
  if (error) return { error: error.message }
  revaliderRegles()
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

  revaliderRegles()
  return { success: true }
}

// ── Composition d'équipe par tag (backlog n°6) ───────────────

const MODES_COMPOSITION = new Set(['au_moins_un', 'pas_seuls'])
const TAG_MAX_LONGUEUR = 30

/**
 * Pose une étiquette sur les fiches de plusieurs vétérinaires, en une fois.
 *
 * POURQUOI CETTE ACTION EXISTE
 *
 * Les trois écritures « par étiquette » de cet écran (composition, rôle
 * interdit, cohorte d'équité) refusent une étiquette que PERSONNE ne porte —
 * à raison : la règle serait soit impossible à tenir, soit inerte. Mais l'écran
 * proposait quand même « + Une nouvelle étiquette… », sans aucun moyen de la
 * poser sur une fiche depuis là : une porte qui ne pouvait mener qu'au refus.
 * MiKL, en recette : « on peut rajouter une nouvelle étiquette mais finalement
 * quand on le fait le système ne veut pas, à quoi ça sert ? »
 *
 * Plutôt que de retirer l'option, on la rend vraie : le panneau demande QUI
 * porte l'étiquette, cette action la pose, et la règle est créée dans la
 * foulée. Le refus reste en place côté serveur — il garde tout son sens pour
 * les appels qui ne passent pas par le panneau (assistant IA, appel direct).
 *
 * NON TRANSACTIONNEL, ET C'EST VOULU : si la règle échoue ensuite (doublon,
 * créneau inconnu…), les étiquettes restent posées. Une étiquette est un fait
 * d'équipe (« Victor est junior »), pas un effet de bord de la règle — la
 * défaire serait plus surprenant que la garder.
 */
export async function poserEtiquetteSurVetos(tag: string, vetoIds: string[]) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const tagNorm = (tag ?? '').trim().toLowerCase()
  if (tagNorm === '' || tagNorm.length > TAG_MAX_LONGUEUR) {
    return { error: `Étiquette invalide (1 à ${TAG_MAX_LONGUEUR} caractères).` }
  }

  const ids = [...new Set((vetoIds ?? []).filter((x) => typeof x === 'string' && x.trim() !== ''))]
  if (ids.length === 0) {
    return { error: 'Indique au moins un vétérinaire qui porte cette étiquette.' }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Le filtre cabinet_id double la RLS (défense en profondeur) ET borne le
  // `actif` : une étiquette posée sur une fiche désactivée ne compterait pas
  // comme un porteur — on refuserait la règle juste après, sans rien expliquer.
  const { data: cibles, error: lectureErr } = await supabase
    .from('veterinaires')
    .select('id, prenom, tags')
    .eq('cabinet_id', cabinetId)
    .eq('actif', true)
    .in('id', ids)
  if (lectureErr) return { error: lectureErr.message }

  const rows = (cibles ?? []) as Array<{ id: string; prenom: string; tags: string[] | null }>
  if (rows.length === 0) {
    return { error: 'Aucun vétérinaire actif ne correspond à cette sélection.' }
  }

  // ── LE PASSAGE OBLIGÉ (palier 2 de l'audit du 2026-08-03) ──
  // Poser une étiquette change qui peut tenir quel rôle : c'est exactement ce
  // que lisent les règles de composition d'équipe et de rôle interdit. On
  // simule le monde tel qu'il sera pour CHAQUE fiche touchée.
  for (const v of rows) {
    const actuels = (v.tags ?? []).map((t) => t.trim().toLowerCase())
    if (actuels.includes(tagNorm)) continue
    const refus = await refusSiBloquant(
      supabase,
      cabinetId,
      { genre: 'veto_tags', vetId: v.id, tags: [...actuels, tagNorm] },
      false,
    )
    if (refus) return { error: refus.error }
  }

  const poses: string[] = []
  for (const v of rows) {
    const actuels = v.tags ?? []
    // Comparaison normalisée : « Junior » et « junior » sont la même étiquette.
    if (actuels.some((t) => t.trim().toLowerCase() === tagNorm)) continue
    const { error } = await supabase
      .from('veterinaires')
      .update({ tags: [...actuels, tagNorm] })
      .eq('id', v.id)
    if (error) return { error: error.message }
    poses.push(v.prenom)
  }

  // Consumers de `veterinaires.tags` : la page Équipe (les fiches), l'écran
  // Organisation (la liste des étiquettes des menus). Le moteur, le pré-vol et
  // Filou relisent la base à chaque appel — rien à revalider pour eux.
  revaliderRegles()
  return { success: true, poses }
}

/** Payload du formulaire composition (règle GLOBALE avec params). */
export interface CompositionReglePayload {
  id?: string // présent = édition
  mode: 'au_moins_un' | 'pas_seuls'
  tag: string
  /** Codes de créneaux ciblés — vide/absent = tous les créneaux. */
  creneaux?: string[]
  force: ForceFormulaire
}

/**
 * Crée ou édite une règle de composition d'équipe (« au moins un senior par
 * week-end », « un junior jamais seul »). Règle GLOBALE : pas de « qui »
 * nominal — le qui est un TAG (veterinaires.tags). PLUSIEURS règles possibles
 * par cabinet (une ligne chacune). Contrairement à setStructureRegle, elle
 * porte des PARAMS métier ({ mode, tag, creneaux? }), reconstruits ici
 * (frontière de confiance). Toggle/suppression : setRegleActif / deleteRegle.
 */
export async function upsertCompositionRegle(payload: CompositionReglePayload) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde
  const vetoId = garde.veto.id

  if (!MODES_COMPOSITION.has(payload.mode)) {
    return { error: 'Mode de composition invalide.' }
  }
  if (!FORCES_VALIDES.includes(payload.force)) {
    return { error: 'Niveau de force invalide.' }
  }
  const tag = (payload.tag ?? '').trim().toLowerCase()
  if (tag === '' || tag.length > TAG_MAX_LONGUEUR) {
    return { error: `Étiquette invalide (1 à ${TAG_MAX_LONGUEUR} caractères).` }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Créneaux ciblés : chaque code DOIT exister dans le référentiel du cabinet
  // (un code fantôme rendrait la règle silencieusement inerte sur ce créneau).
  const creneaux = [
    ...new Set((payload.creneaux ?? []).filter((x) => typeof x === 'string' && x.trim() !== '')),
  ]
  if (creneaux.length > 0) {
    const codesValides = await chargerCodesCreneauxValides(supabase, cabinetId)
    const inconnus = creneaux.filter((c) => !codesValides.has(c))
    if (inconnus.length > 0) {
      return { error: `Type(s) de créneau inconnu(s) pour ce cabinet : ${inconnus.join(', ')}.` }
    }
  }

  // Garde anti-coquille-vide : le tag doit être porté par AU MOINS un véto
  // actif — sinon la règle est soit impossible (au_moins_un), soit inerte
  // (pas_seuls). Le pré-vol le re-signale, mais on prévient dès l'écriture.
  const { data: vetsTags } = await supabase
    .from('veterinaires')
    .select('tags')
    .eq('actif', true)
  const tagPorte = ((vetsTags as { tags?: string[] | null }[] | null) ?? []).some((v) =>
    (v.tags ?? []).some((t) => t.trim().toLowerCase() === tag),
  )
  if (!tagPorte) {
    return {
      error: `Aucun vétérinaire actif ne porte l'étiquette « ${tag} ». Ajoute-la d'abord sur les fiches concernées (page Équipe).`,
    }
  }

  const params: Record<string, unknown> = {
    mode: payload.mode,
    tag,
    ...(creneaux.length > 0 ? { creneaux } : {}),
  }
  const params_json = { qui: null, quand: null, params }

  // Anti-doublon (création seulement) : même mode + tag + créneaux.
  if (!payload.id) {
    const { data: existantes } = await supabase
      .from('regles_cabinet')
      .select('id, params_json')
      .eq('cabinet_id', cabinetId)
      .eq('brique_id', 'composition_equipe')
    const cible = empreinteRegle('composition_equipe', params)
    for (const r of existantes ?? []) {
      if (empreinteRegle('composition_equipe', paramsDeRow(r.params_json)) === cible) {
        return {
          error: 'Une règle de composition identique existe déjà.',
          regleExistante: r.id as string,
        }
      }
    }
  }

  if (payload.id) {
    const { error } = await supabase
      .from('regles_cabinet')
      .update({ params_json, force: payload.force })
      .eq('id', payload.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('regles_cabinet').insert({
      cabinet_id: cabinetId,
      brique_id: 'composition_equipe',
      params_json,
      force: payload.force,
      actif: true,
      created_by: vetoId,
    })
    if (error) return { error: error.message }
  }

  revaliderRegles()
  return { success: true }
}

// ── Le gardien : « cette règle tient-elle avec les autres ? » ────────────
//
// Rappel du principe du projet : le MOTEUR décide, Filou n'est que le porte-
// parole. Ce contrôle est donc du calcul (`data/verifierRegleCandidate.ts`),
// pas un appel d'IA — instantané, gratuit, et incapable d'inventer une
// incohérence qui n'existerait pas.
//
// ⚠️ Il ne REMPLACE aucune validation d'écriture. Les actions ci-dessus gardent
//    tous leurs refus (étiquette sans porteur, doublon, anti-impasse) : ce sont
//    des refus, ils bloquent. Le gardien, lui, AVERTIT — l'admin garde le
//    dernier mot, parce qu'une règle « intenable » sur la période testée peut
//    être exactement ce qu'il veut poser pour la suivante.

/** La règle en cours de saisie, dans l'une de ses quatre formes. */
export type CandidatRegle =
  | { genre: 'nominative'; payload: UpsertReglePayload }
  | { genre: 'composition'; payload: CompositionReglePayload }
  | { genre: 'role_interdit'; payload: RoleInterditReglePayload }
  | { genre: 'cohorte'; payload: { dimension: string; tag: string; importance: string } }

/** Id de la règle simulée. En création, un id qui n'existe nulle part —
 *  la simulation ne doit jamais entrer en collision avec une règle réelle. */
const ID_CANDIDATE = '00000000-0000-0000-0000-0000000c0de0'

/**
 * Vérifie une règle AVANT de l'écrire : renvoie ce que cette règle-là casserait,
 * et rien d'autre (le pré-vol tourne avec et sans elle, on ne garde que la
 * différence). Ne modifie rien.
 *
 * Réservée à l'admin, comme les écritures qu'elle précède : un véto en lecture
 * seule n'a aucune règle à valider.
 */
export async function verifierRegle(candidat: CandidatRegle): Promise<VerdictGardien> {
  // ⚠️ FILET TOTAL. Une exception qui s'échappe d'une server action ne produit
  //    pas un message : elle produit une PAGE BLANCHE « a server error
  //    occurred », qui fait perdre la saisie et ne dit rien. Or ce contrôle est
  //    facultatif par nature — il ne doit JAMAIS empêcher d'enregistrer une
  //    règle. Tout ce qui casse ici se solde donc par « je n'ai pas pu
  //    vérifier », et l'écriture suit son cours.
  //    (Incident du 2026-08-02 : page blanche à la première validation de règle
  //    après la mise en service du gardien.)
  try {
    const supabase = await createClient()

    const garde = await assertAdmin(supabase)
    if ('error' in garde) return { verifie: false, avertissements: [] }

    const cabinetId = await resoudreCabinetId(supabase)

    const rows = await construireRowsCandidates(supabase, cabinetId, candidat)
    if (rows.length === 0) return { verifie: false, avertissements: [] }

    // Un duo interdit s'écrit en DEUX lignes symétriques (A→B et B→A) : le solver
    // a besoin des deux sens. On simule donc les deux, sinon le gardien jugerait
    // une moitié de règle. Le module de vérification n'en prend qu'une comme
    // « candidate » (pour le remplacement en édition) ; les autres sont fusionnées
    // dans le monde simulé par le même chemin.
    let verdict = await verifierRegleCandidate(supabase, cabinetId, rows[0])
    for (const suivante of rows.slice(1)) {
      const v = await verifierRegleCandidate(supabase, cabinetId, suivante)
      if (!v.verifie) continue
      const connus = new Set(verdict.avertissements.map((a) => `${a.code}::${a.message}`))
      verdict = {
        ...verdict,
        verifie: verdict.verifie || v.verifie,
        avertissements: [
          ...verdict.avertissements,
          ...v.avertissements.filter((a) => !connus.has(`${a.code}::${a.message}`)),
        ],
      }
    }
    return verdict
  } catch (e) {
    // Le message part AUSSI vers l'écran (`diagnostic`) : les logs runtime de
    // l'hébergeur ne sont pas consultables depuis ici, et une panne qu'on ne
    // peut pas lire est une panne qu'on corrige au hasard.
    const message = e instanceof Error ? `${e.message}` : String(e)
    console.error('[gardien] vérification impossible :', e)
    return { verifie: false, avertissements: [], diagnostic: message }
  }
}

/**
 * Bâtit la (ou les) ligne(s) `regles_cabinet` que l'écriture produirait.
 *
 * ⚠️ La forme est construite par les MÊMES fonctions que l'écriture
 *    (`construireParams`, `envelopper`) : un gardien qui vérifierait une autre
 *    forme que celle qui sera enregistrée ne garderait rien du tout. Une
 *    saisie mal formée renvoie [] — l'écriture la refusera de toute façon, avec
 *    un message précis que le gardien n'a pas à doubler.
 */
async function construireRowsCandidates(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
  candidat: CandidatRegle,
): Promise<RegleCabinetRow[]> {
  const base = (
    id: string,
    brique_id: string,
    params_json: unknown,
    force: string,
    periode_id: string | null = null,
  ): RegleCabinetRow => ({
    id, cabinet_id: cabinetId, periode_id, brique_id, params_json,
    force, validite_json: construireValiditeJson(periode_id), actif: true,
  })

  if (candidat.genre === 'nominative') {
    const p = candidat.payload
    if (!p.owner_id || !(p.brique_id in BRIQUES_EVALUABLES)) return []
    const periode_id = p.periode_id ?? null

    if (p.brique_id === 'duo_interdit') {
      const b = p.avec_veterinaire_id
      if (!b || b === p.owner_id) return []
      const ligne = (owner: string, partner: string, id: string) =>
        base(
          id, 'duo_interdit',
          envelopper(owner, 'duo_interdit', null, { avec_veterinaire_id: partner }),
          p.force, periode_id,
        )
      return [
        ligne(p.owner_id, b, p.id ?? ID_CANDIDATE),
        ligne(b, p.owner_id, `${p.id ?? ID_CANDIDATE}-miroir`),
      ]
    }

    const codesCreneaux = await chargerCodesCreneauxValides(supabase, cabinetId)
    const construit = construireParams(p, codesCreneaux)
    if ('error' in construit) return []
    return [
      base(
        p.id ?? ID_CANDIDATE, p.brique_id,
        envelopper(p.owner_id, p.brique_id, construit.quand, construit.params),
        p.force, periode_id,
      ),
    ]
  }

  if (candidat.genre === 'composition') {
    const p = candidat.payload
    const tag = (p.tag ?? '').trim().toLowerCase()
    if (tag === '' || !MODES_COMPOSITION.has(p.mode)) return []
    const creneaux = [...new Set((p.creneaux ?? []).filter((x) => x.trim() !== ''))]
    return [
      base(p.id ?? ID_CANDIDATE, 'composition_equipe', {
        qui: null, quand: null,
        params: { mode: p.mode, tag, ...(creneaux.length > 0 ? { creneaux } : {}) },
      }, p.force),
    ]
  }

  if (candidat.genre === 'role_interdit') {
    const p = candidat.payload
    const tag = (p.tag ?? '').trim().toLowerCase()
    const role = (p.role ?? '').trim()
    if (tag === '' || role === '') return []
    const creneaux = [...new Set((p.creneaux ?? []).filter((x) => x.trim() !== ''))]
    return [
      base(p.id ?? ID_CANDIDATE, 'role_interdit_tag', {
        qui: null, quand: null,
        params: { tag, role, ...(creneaux.length > 0 ? { creneaux } : {}) },
      }, p.force),
    ]
  }

  // Cohorte d'équité : sa « force » n'est pas réglable (toujours si_possible —
  // c'est une préférence de répartition, jamais une interdiction).
  const p = candidat.payload
  const tag = (p.tag ?? '').trim().toLowerCase()
  if (tag === '' || p.importance === 'ignoree') return []
  return [
    base(ID_CANDIDATE, 'equilibrer', {
      qui: null, quand: null,
      params: { dimension: p.dimension, importance: p.importance, tag },
    }, 'si_possible'),
  ]
}

// ── Rôle interdit par tag (backlog n°22 — « un junior jamais 1er ») ──

/** Payload du formulaire rôle interdit (règle GLOBALE avec params). */
export interface RoleInterditReglePayload {
  id?: string // présent = édition
  tag: string
  /** Label de la place interdite (rôle du catalogue, ex. 'premier'). */
  role: string
  /** Codes de créneaux ciblés — vide/absent = tous les créneaux. */
  creneaux?: string[]
  force: ForceFormulaire
}

/** Labels de rôles VALIDES du cabinet (catalogue actif ; repli premier/second). */
async function chargerRolesValides(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
): Promise<Set<string>> {
  const modeles = await chargerCreneauModele(supabase, cabinetId)
  const roles = modeles
    .filter((m) => m.actif)
    .flatMap((m) => m.roles ?? [])
    .filter((r) => typeof r === 'string' && r.trim() !== '')
  return new Set(roles.length > 0 ? roles : ['premier', 'second'])
}

/**
 * Crée ou édite une règle « rôle interdit selon attribut » (« un junior
 * jamais 1er »). Règle GLOBALE par TAG, comme composition_equipe : params
 * { tag, role, creneaux? } reconstruits ici (frontière de confiance).
 * Toggle/suppression : setRegleActif / deleteRegle (génériques).
 */
export async function upsertRoleInterditRegle(payload: RoleInterditReglePayload) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde
  const vetoId = garde.veto.id

  if (!FORCES_VALIDES.includes(payload.force)) {
    return { error: 'Niveau de force invalide.' }
  }
  const tag = (payload.tag ?? '').trim().toLowerCase()
  if (tag === '' || tag.length > TAG_MAX_LONGUEUR) {
    return { error: `Étiquette invalide (1 à ${TAG_MAX_LONGUEUR} caractères).` }
  }
  const role = (payload.role ?? '').trim()
  if (role === '') return { error: 'Sélectionnez le rôle interdit.' }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Le rôle DOIT exister dans le catalogue du cabinet (un rôle fantôme
  // rendrait la règle silencieusement inerte).
  const rolesValides = await chargerRolesValides(supabase, cabinetId)
  if (!rolesValides.has(role)) {
    return { error: `Rôle inconnu pour ce cabinet : « ${role} ».` }
  }

  // Créneaux ciblés : mêmes règles que la composition (codes du cabinet).
  const creneaux = [
    ...new Set((payload.creneaux ?? []).filter((x) => typeof x === 'string' && x.trim() !== '')),
  ]
  if (creneaux.length > 0) {
    const codesValides = await chargerCodesCreneauxValides(supabase, cabinetId)
    const inconnus = creneaux.filter((c) => !codesValides.has(c))
    if (inconnus.length > 0) {
      return { error: `Type(s) de créneau inconnu(s) pour ce cabinet : ${inconnus.join(', ')}.` }
    }
  }

  // Anti-coquille-vide : le tag doit être porté par au moins un véto actif.
  const { data: vetsTags } = await supabase
    .from('veterinaires')
    .select('tags')
    .eq('actif', true)
  const rowsTags = ((vetsTags as { tags?: string[] | null }[] | null) ?? [])
  const porteurs = rowsTags.filter((v) =>
    (v.tags ?? []).some((t) => t.trim().toLowerCase() === tag),
  ).length
  if (porteurs === 0) {
    return {
      error: `Aucun vétérinaire actif ne porte l'étiquette « ${tag} ». Ajoute-la d'abord sur les fiches concernées (page Équipe).`,
    }
  }

  const params: Record<string, unknown> = {
    tag,
    role,
    ...(creneaux.length > 0 ? { creneaux } : {}),
  }
  const params_json = { qui: null, quand: null, params }

  // Anti-doublon (création seulement) : même tag + rôle + créneaux.
  if (!payload.id) {
    const { data: existantes } = await supabase
      .from('regles_cabinet')
      .select('id, params_json')
      .eq('cabinet_id', cabinetId)
      .eq('brique_id', 'role_interdit_tag')
    const cible = empreinteRegle('role_interdit_tag', params)
    for (const r of existantes ?? []) {
      if (empreinteRegle('role_interdit_tag', paramsDeRow(r.params_json)) === cible) {
        return {
          error: 'Une règle identique existe déjà.',
          regleExistante: r.id as string,
        }
      }
    }
  }

  if (payload.id) {
    const { error } = await supabase
      .from('regles_cabinet')
      .update({ params_json, force: payload.force })
      .eq('id', payload.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('regles_cabinet').insert({
      cabinet_id: cabinetId,
      brique_id: 'role_interdit_tag',
      params_json,
      force: payload.force,
      actif: true,
      created_by: vetoId,
    })
    if (error) return { error: error.message }
  }

  revaliderRegles()
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

  revaliderRegles()
  return { success: true }
}

// ── Création / édition guidée (P1A-007) ──────────────────────
//
// La CONSTRUCTION des params (briques évaluables, bornes, formes acceptées) a
// déménagé dans `lib/regles/paramsRegle.ts` le 2026-08-02 : le gardien de
// cohérence doit bâtir la règle en cours de saisie — sans l'écrire — pour la
// soumettre au pré-vol, et un fichier `'use server'` ne peut exporter que des
// fonctions async. La forme est donc construite là-bas, par la MÊME fonction
// des deux côtés ; tout ce qui exige la BASE (existence d'un véto, catalogue de
// créneaux, anti-doublon, anti-impasse) reste ici.

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
): Promise<string | null> {
  const { data } = await supabase
    .from('regles_cabinet')
    .select('id, params_json')
    .eq('cabinet_id', cabinetId)
    .eq('brique_id', briqueId)
  // Comparaison sur ce que le MOTEUR LIT, pas sur le JSON stocké : deux règles
  // peuvent différer par un texte décoratif et faire strictement la même chose
  // (cf. `lib/regles/identiteRegle.ts` — le mercredi d'Anne-Catherine).
  const cible = empreinteRegle(briqueId, params)
  for (const r of data ?? []) {
    if (lireOwner(r.params_json) !== ownerId) continue
    if (empreinteRegle(briqueId, paramsDeRow(r.params_json)) === cible) return r.id as string
  }
  return null
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
 * verifierSeulementAvec — gardes anti-impasse de la brique « seulement avec B »
 * (#15b), sur la vraie donnée du cabinet (frontière de confiance). Renvoie
 * `{ error }` si la config est intenable, sinon `null`.
 *   ② B doit être un vétérinaire ACTIF du cabinet.
 *   ③ (règle DURE seulement) si TOUS les créneaux visés sont à 1 place → A ne
 *      pourrait plus JAMAIS être de garde dessus → impasse certaine.
 * `force = 'jamais'` ⇒ dure ; les autres niveaux (souples) ne bloquent pas et
 * ne créent donc pas d'impasse (garde ③ sautée).
 */
async function verifierSeulementAvec(
  supabase: SupabaseClient<any, any, any>,
  cabinetId: string,
  ownerId: string,
  partenaireId: string,
  creneauxCibles: string[],
  force: ForceFormulaire,
): Promise<{ error: string } | null> {
  // ② B actif dans le cabinet ? (les vétos sont scopés par RLS au cabinet courant)
  const { data: vetB } = await supabase
    .from('veterinaires')
    .select('id, prenom, actif')
    .eq('id', partenaireId)
    .maybeSingle()
  const bActif = vetB as { id: string; prenom: string; actif: boolean } | null
  if (!bActif || !bActif.actif) {
    return { error: 'Le binôme requis doit être un vétérinaire actif du cabinet.' }
  }

  // ③ Impasse « tous les créneaux visés à 1 place » — seulement si DURE.
  if (force !== 'jamais') return null

  const modeles = await chargerCreneauModele(supabase, cabinetId)
  const actifsPlanifiables = modeles.filter(
    (m) => m.actif && m.code !== null && m.code !== 'ferie',
  )
  // Créneaux réellement concernés : le ciblage, sinon tout le catalogue.
  const concernes = creneauxCibles.length > 0
    ? actifsPlanifiables.filter((m) => creneauxCibles.includes(m.code as string))
    : actifsPlanifiables
  if (concernes.length > 0 && concernes.every((m) => m.nbPlaces <= 1)) {
    return {
      error:
        'Cette règle « seulement avec » ne peut pas être ferme ici : tous les créneaux visés n\'ont qu\'une place, donc le binôme requis ne pourra jamais y être en même temps — le vétérinaire ne serait plus jamais de garde dessus. Cible des créneaux à plusieurs places, ou utilise une préférence souple « préfère être avec ».',
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
  // Desiderata (n°7) : préférences PURES — aucun gardien dur n'existe pour
  // elles, une force « jamais » serait une coquille vide (le moteur clampe
  // de toute façon à souple — défense en profondeur).
  if (BRIQUES_DESIDERATA.has(payload.brique_id) && !FORCES_SOUPLES.has(payload.force)) {
    return { error: 'Cette règle est une préférence : elle ne peut pas être une interdiction ferme.' }
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
      if (dejaLa) {
        return {
          error: 'Ce duo interdit existe déjà dans les règles du cabinet.',
          regleExistante: dejaLa,
        }
      }
    }

    // Le duo interdit a son propre chemin d'écriture (deux lignes miroir), il
    // lui faut donc SON passage par le contrôle d'impact : sans ça, la seule
    // famille de règles écrite hors du tronc commun serait aussi la seule à
    // échapper au principe. Le sens A→B suffit à la simulation, le miroir
    // étant symétrique pour le moteur.
    const refusDuo = await refusSiBloquant(
      supabase,
      cabinetId,
      {
        genre: 'regle_ajout',
        row: {
          id: payload.id ?? '__candidate__',
          cabinet_id: cabinetId,
          periode_id,
          brique_id: 'duo_interdit',
          params_json: envelopper(a, 'duo_interdit', null, { avec_veterinaire_id: b }),
          force: payload.force,
          validite_json,
          version: 1,
          actif: true,
        } as RegleCabinetRow,
      },
      payload.confirmeImpact === true,
    )
    if (refusDuo) return refusDuo

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
    revaliderRegles()
    return { success: true }
  }

  // ── Cas briques non-duo ────────────────────────────────────
  // Référentiel de créneaux du cabinet : chargé SEULEMENT si un filtre est
  // demandé (au_plus_n n°19, preferer_creneau n°7) — zéro requête sinon.
  const besoinCodes =
    // succession_interdite valide TOUJOURS ses deux codes créneaux (#13).
    payload.brique_id === 'succession_interdite' ||
    ((payload.brique_id === 'au_plus_n' ||
      payload.brique_id === 'preferer_creneau' ||
      payload.brique_id === 'serie_max' ||
      payload.brique_id === 'seulement_avec' ||
      // Repos fixe ciblé par type de garde (2026-08-02) : un cabinet peut
      // déclarer plusieurs gardes le même jour, et ne s'absenter que de l'une.
      payload.brique_id === 'interdire_creneau') &&
      (payload.creneaux ?? []).length > 0)
  const codesCreneaux = besoinCodes
    ? await chargerCodesCreneauxValides(supabase, cabinetId)
    : undefined
  const construit = construireParams(payload, codesCreneaux)
  if ('error' in construit) return construit

  // ── Garde anti-impasse « seulement avec B » (#15b — frontière de confiance) ──
  // Une contrainte « A seulement avec B » DURE peut créer des impasses. Gardes
  // (miroir de la conversion IA + de la garde meme_binome/R22 de RG4) :
  //   ① B ≠ A → déjà refusé par construireParams.
  //   ② B inexistant ou inactif → refus (message clair).
  //   ③ Si TOUS les créneaux visés (ciblage, ou tout le catalogue) sont à
  //      1 seule place → impasse certaine (A ne pourrait plus JAMAIS être de
  //      garde sur ces créneaux) → refus + alternative proposée. (Souple → OK :
  //      une préférence ne bloque pas, donc pas d'impasse.)
  if (payload.brique_id === 'seulement_avec') {
    const garde = await verifierSeulementAvec(
      supabase, cabinetId, payload.owner_id,
      (construit.params.avec_veterinaire_id as string) ?? '',
      (construit.params.creneaux as string[]) ?? [],
      payload.force,
    )
    if (garde) return garde
  }

  // Anti-doublon (création seulement) : règle identique déjà présente ?
  if (!payload.id) {
    const dejaLa = await trouverEquivalent(
      supabase, cabinetId, payload.brique_id, payload.owner_id, construit.params,
    )
    if (dejaLa) {
      return {
        error: 'Une règle identique existe déjà pour ce vétérinaire.',
        regleExistante: dejaLa,
      }
    }
  }

  const params_json = envelopper(payload.owner_id, payload.brique_id, construit.quand, construit.params)

  // ── LE PASSAGE OBLIGÉ (audit du 2026-08-03) ──────────────
  // Le contrôle d'impact vit ICI, côté serveur, et plus seulement dans
  // l'écran : Filou et toute autre porte d'entrée le traversent aussi. Seul
  // l'IMPOSSIBLE barre la route ; le reste est signalé à l'écran, qui décide
  // quoi en montrer. `confirmeImpact` est la porte de sortie de l'admin à qui
  // les conséquences ont déjà été présentées.
  const refus = await refusSiBloquant(
    supabase,
    cabinetId,
    {
      genre: 'regle_ajout',
      row: {
        id: payload.id ?? '__candidate__',
        cabinet_id: cabinetId,
        periode_id,
        brique_id: payload.brique_id,
        params_json,
        force: payload.force,
        validite_json,
        version: 1,
        actif: true,
      } as RegleCabinetRow,
    },
    payload.confirmeImpact === true,
  )
  if (refus) return refus

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

  revaliderRegles()
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
      /** Payload prêt pour upsertCompositionRegle (règle GLOBALE d'équipe,
       *  n°6) — présent à la place de `payload` quand l'IA propose une
       *  composition_equipe exploitable. */
      payloadComposition?: CompositionReglePayload
      /** Payload prêt pour upsertRoleInterditRegle (règle GLOBALE, n°22). */
      payloadRoleInterdit?: RoleInterditReglePayload
      /** Payload prêt pour setCohorteEquite (cohorte d'équité GLOBALE, #21). */
      payloadEquite?: CohorteEquitePayload
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

  // Les référentiels dynamiques du cabinet (vétos, étiquettes, créneaux, rôles)
  // sont chargés par une source PARTAGÉE : le banc d'essai des modèles doit
  // mesurer avec exactement le même contexte, sinon ses chiffres ne disent rien
  // de la facture réelle.
  const { vets, tagsEquipe, typesCreneaux, rolesCabinet } = await chargerContexteIA(supabase)

  let proposition: PropositionRegle
  try {
    proposition = await proposerRegleIA(phrase.trim(), vets, typesCreneaux, tagsEquipe, rolesCabinet)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur de l'assistant IA." }
  }

  // ── Règle GLOBALE d'équipe (composition_equipe, n°6) : conversion dédiée ──
  if (proposition.brique_id === 'composition_equipe') {
    const convCompo = propositionVersComposition(proposition, tagsEquipe)
    if (!convCompo.ok) {
      return {
        proposition: { ...proposition, faisable: false, message: convCompo.raison },
        apercu: '',
      }
    }
    return {
      proposition,
      apercu: apercuProposition(proposition),
      payloadComposition: convCompo.payload,
    }
  }

  // ── Cohorte d'équité GLOBALE (equilibrer, #21) : conversion dédiée ──
  if (proposition.brique_id === 'equilibrer') {
    const convEq = propositionVersEquite(proposition, tagsEquipe)
    if (!convEq.ok) {
      return {
        proposition: { ...proposition, faisable: false, message: convEq.raison },
        apercu: '',
      }
    }
    return {
      proposition,
      apercu: apercuProposition(proposition),
      payloadEquite: convEq.payload,
    }
  }

  // ── Règle GLOBALE « rôle interdit par tag » (n°22) : conversion dédiée ──
  if (proposition.brique_id === 'role_interdit_tag') {
    const convRole = propositionVersRoleInterdit(proposition, tagsEquipe, rolesCabinet)
    if (!convRole.ok) {
      return {
        proposition: { ...proposition, faisable: false, message: convRole.raison },
        apercu: '',
      }
    }
    return {
      proposition,
      apercu: apercuProposition(proposition),
      payloadRoleInterdit: convRole.payload,
    }
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

// ── Agir sur les règles EXISTANTES ──────────────────────────
//
// Le routage « créer ou agir sur l'existant » vivait ici, dans un appel IA
// dédié. Il a été remplacé par le catalogue d'outils de Filou
// (`src/lib/ia/outils/regles.ts`), qui laisse le modèle choisir entre lire,
// créer et agir plutôt que de trancher pour lui en amont. Seule reste
// l'écriture en lot ci-dessous, que l'outil `agir_sur_regles` appelle.

/**
 * Applique en lot la décision prise sur le tableau. Aucune écriture directe :
 * on repasse par `deleteRegle` / `setRegleActif`, qui portent déjà la garde
 * admin, la RLS et le traitement du sens miroir des duos interdits.
 */
export async function appliquerActionRegles(
  ids: string[],
  action: 'desactiver' | 'supprimer' | 'activer',
): Promise<{ error: string } | { success: true; nb: number }> {
  const supabase = await createClient()
  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  if (!Array.isArray(ids) || ids.length === 0) {
    return { error: 'Aucune règle à traiter.' }
  }

  for (const id of ids) {
    const r =
      action === 'supprimer'
        ? await deleteRegle(id)
        : await setRegleActif(id, action === 'activer')
    // Premier échec = on s'arrête et on le dit. Continuer en silence laisserait
    // l'admin croire que tout est passé.
    if ('error' in r && r.error) return { error: r.error }
  }

  revaliderRegles()
  return { success: true, nb: ids.length }
}

// ── Corriger un point de pré-vol SANS quitter l'écran ────────
//
// Retour MiKL du 2026-08-02 : « y a rien qui permette à l'utilisateur de
// changer quoi que ce soit directement à partir de l'encart, il faut qu'il
// aille à droite à gauche, revienne, et vérifie… bref c'est chiant ».
//
// Le pré-vol dit ce qui coince ET pointe désormais les règles fautives par
// leur id (`AvertissementPreVol.regleIds`). Ces deux actions sont les gestes
// que l'admin faisait à la main, en trois écrans : assouplir, ou mettre en
// pause. Elles ne sont volontairement PAS génériques — pas de « applique ce
// que tu veux sur cette règle » télécommandé depuis le client.

/**
 * Assouplit une règle jusqu'au premier cran qui laisse le moteur passer outre :
 * « sauf urgence ». La règle RESTE — le moteur la respecte partout où il peut,
 * et signale quand il l'enfreint. C'est la correction la moins destructrice, et
 * de loin la plus fréquente (cf. `lib/regles/corrections.ts`).
 */
export async function assouplirRegle(id: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const { data: row } = await supabase
    .from('regles_cabinet')
    .select('id, force')
    .eq('id', id)
    .maybeSingle()
  if (!row) return { error: 'Règle introuvable.' }

  // Déjà souple : ne rien faire plutôt que de la durcir par mégarde. Assouplir
  // doit rester une opération qui ne peut jamais resserrer une règle.
  const actuelle = (row as { force?: string }).force
  if (actuelle && FORCES_SOUPLES.has(actuelle as ForceFormulaire)) {
    return { success: true, inchange: true }
  }

  const { error } = await supabase
    .from('regles_cabinet')
    .update({ force: 'sauf_crise' })
    .eq('id', id)

  if (error) return { error: error.message }
  revaliderRegles()
  revalidatePath('/planning')
  return { success: true }
}

/**
 * Met une règle en pause depuis l'écran Planning. S'appuie sur `setRegleActif`
 * — donc le miroir d'un duo interdit est traité, comme partout ailleurs — et
 * revalide EN PLUS `/planning`, d'où part l'action.
 */
export async function mettreEnPauseRegle(id: string) {
  const res = await setRegleActif(id, false)
  if ('error' in res) return res
  revalidatePath('/planning')
  return { success: true }
}

/**
 * Retire une étiquette de fiches vétérinaires. Le pendant exact de
 * `poserEtiquetteSurVetos`, requis par le cas « TOUS les vétos portent
 * l'étiquette, donc personne ne peut tenir le rôle » : la seule correction est
 * d'en retirer au moins un, et jusqu'ici il fallait aller le faire fiche par
 * fiche sur l'écran Équipe.
 *
 * Comparaison NORMALISÉE (« Junior » et « junior » sont la même étiquette) —
 * même règle que partout ailleurs, sinon on retirerait la minuscule en laissant
 * la majuscule, et le porteur resterait porteur sans que rien ne le dise.
 */
export async function retirerEtiquetteDeVetos(tag: string, vetoIds: string[]) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const tagNorm = (tag ?? '').trim().toLowerCase()
  if (tagNorm === '') return { error: 'Étiquette invalide.' }

  const ids = [...new Set((vetoIds ?? []).filter((x) => typeof x === 'string' && x.trim() !== ''))]
  if (ids.length === 0) {
    return { error: 'Indique au moins un vétérinaire.' }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  const { data: cibles, error: lectureErr } = await supabase
    .from('veterinaires')
    .select('id, prenom, tags')
    .eq('cabinet_id', cabinetId)
    .eq('actif', true)
    .in('id', ids)
  if (lectureErr) return { error: lectureErr.message }

  const rows = (cibles ?? []) as Array<{ id: string; prenom: string; tags: string[] | null }>
  if (rows.length === 0) {
    return { error: 'Aucun vétérinaire actif ne correspond à cette sélection.' }
  }

  const retires: string[] = []
  for (const v of rows) {
    const actuels = v.tags ?? []
    const restants = actuels.filter((t) => t.trim().toLowerCase() !== tagNorm)
    if (restants.length === actuels.length) continue // ne la portait pas
    const { error } = await supabase
      .from('veterinaires')
      .update({ tags: restants })
      .eq('id', v.id)
    if (error) return { error: error.message }
    retires.push(v.prenom)
  }

  revaliderRegles()
  revalidatePath('/planning')
  return { success: true, retires }
}
