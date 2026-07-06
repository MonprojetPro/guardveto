'use server'

// ============================================================
// GUARDVETO — Server actions « Structure des créneaux » (admin)
// ============================================================
// Point d'entrée UI des écritures de structure d'un cabinet :
//   • PROFILS de planning (créer par duplication, renommer, saison/effectif,
//     supprimer) + assistant IA « profil en langage naturel » ;
//   • HORAIRES par profil (creneau_modele) ;
//   • CRÉNEAUX sur-mesure (P3b) + activation/désactivation ;
//   • RELATIONS entre créneaux (ex R8/R9 généralisées, RG4) + assistant IA ;
//   • PARAMÈTRES du cabinet (#10 : agenda Google, expéditeur Brevo, adresse
//     → zone scolaire dérivée).
//
// Frontière de confiance commune : assertAdmin côté serveur (message clair) +
// RLS admin-only / isolation restrictive par cabinet + validation stricte des
// champs (formats/bornes) avant toute écriture. Le cabinet_id est TOUJOURS
// dérivé côté serveur (jamais du client). Les écritures sur `cabinets`
// (sans policy UPDATE large) passent par des RPC SECURITY DEFINER auto-gardées.
//
// NB : la surcouche cabinet-large `creneaux_cabinet` a été retirée
// (les horaires sont réglés PAR PROFIL depuis P5 slice 4b).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { zoneEtRegionDepuisCodePostal } from '@/lib/geo-zone'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { assistantIaDisponible } from '@/lib/ia/proposerRegle'
import { proposerProfilIA } from '@/lib/ia/proposerProfil'
import {
  propositionVersProfilPayload,
  apercuProfil,
  type PropositionProfil,
  type ProfilResolu,
  type CreerProfilCompletPayload,
} from '@/lib/ia/profilSchema'
import { proposerRelationIA } from '@/lib/ia/proposerRelation'
import {
  propositionVersRelationPayload,
  apercuRelation,
  type PropositionRelation,
  type CreneauResoluIA,
  type CreerRelationIaPayload,
} from '@/lib/ia/relationSchema'

// ── Référentiels de validation ───────────────────────────────
/** 'HH:MM' 24h strict (00:00 → 23:59). */
const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/
/** Format d'un code machine de créneau (mêmes bornes que le CHECK SQL). */
const CODE_RE = /^[a-z0-9_]{1,60}$/
const OFFSET_MIN = 0
const OFFSET_MAX = 3
/** Bornes d'un créneau sur-mesure (P3b) : de 1 à 4 places. */
const N_PLACES_MAX = 4

/**
 * Slug machine d'un créneau sur-mesure : « Garde de jour » → « sm_garde_de_jour ».
 * Préfixe `sm_` = zéro collision possible avec les 4 codes réservés du seed.
 * (Même translittération que le backfill SQL 20260706120000.)
 */
function slugSurMesure(nom: string): string {
  const plat = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `sm_${plat || 'creneau'}`.slice(0, 56)
}

// ── Garde admin (même pattern que /regles) ───────────────────
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

/** Minutes depuis minuit pour une chaîne 'HH:MM' déjà validée. */
function enMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10))
  return h * 60 + m
}

/**
 * Valide un triplet horaire (début/fin en 'HH:MM' + jour de fin). Renvoie un
 * message d'erreur clair, ou null si tout est cohérent. Frontière de confiance
 * partagée par les écritures d'horaires (réglage manuel ET création IA).
 */
function validerHoraire(p: {
  heure_debut: string
  heure_fin: string
  offset_jours_fin: number
}): string | null {
  if (!HEURE_RE.test(p.heure_debut)) return 'Heure de début invalide (format attendu HH:MM).'
  if (!HEURE_RE.test(p.heure_fin)) return 'Heure de fin invalide (format attendu HH:MM).'
  const offset = p.offset_jours_fin
  if (!Number.isInteger(offset) || offset < OFFSET_MIN || offset > OFFSET_MAX) {
    return `Jour de fin invalide (doit être entre ${OFFSET_MIN} et ${OFFSET_MAX}).`
  }
  if (offset === 0 && enMinutes(p.heure_fin) <= enMinutes(p.heure_debut)) {
    return "L'heure de fin doit être après l'heure de début, ou la garde doit se terminer un jour suivant."
  }
  return null
}

// NOTE (nettoyage dette technique 2026-07-06) : les server actions
// `upsertCreneauCabinet` / `resetCreneauCabinet` (surcouche horaires cabinet-large
// `creneaux_cabinet`) ont été SUPPRIMÉES. Leur seul appelant était le composant
// orphelin `StructureCreneauxClient` (supprimé), et les horaires sont désormais
// réglés PAR PROFIL via `setHorairesProfilCreneau` (creneau_modele). La table
// `creneaux_cabinet` est droppée par la migration 20260706200000.

// ════════════════════════════════════════════════════════════
// P5 slice 4a — Gestionnaire de PROFILS de planning
// ════════════════════════════════════════════════════════════
// Un cabinet compose des profils nommés (« Hiver », « Été »…) réutilisables,
// sélectionnés à la génération d'une période (slice 3). Ces actions permettent
// de les CRÉER (par duplication d'un profil source, atomique via RPC), les
// RENOMMER, régler leur saison suggérée + effectif, et les SUPPRIMER.
//
// Garde : assertAdmin (message clair) + RLS profils_planning (admin_write +
// isolation restrictive par cabinet). On borne toujours au cabinet via la RLS
// et, côté RPC, via auth_cabinet_actif() — jamais un cabinet_id du client.
//
// PÉRIMÈTRE (honnêteté end-to-end) : on compose des profils à partir des types
// de garde EXISTANTS. Inventer des types inédits ou monter à >2 places n'est PAS
// exposé ici (l'aval — gardes V1, agenda, PDF — ne sait pas encore les persister ;
// ce serait une coquille vide). Cela s'ouvrira avec P3b/P6.

/** Saisons acceptées par la suggestion (miroir du CHECK profils_planning). */
const SAISONS_VALIDES = new Set(['ete', 'hiver'])
/** Effectifs acceptés (miroir du CHECK nb_vetos_semaine_soir IN (1,2)). */
const EFFECTIFS_VALIDES = new Set([1, 2])

export interface CreerProfilPayload {
  nom: string
  /** Profil dont on copie le catalogue (défaut du cabinet si omis). */
  source_profil_id?: string | null
  saison_suggeree?: 'ete' | 'hiver' | null
  nb_vetos_semaine_soir?: number | null
}

/**
 * Crée un profil en DUPLIQUANT le catalogue d'un profil source (atomique via la
 * RPC dupliquer_profil). Le nouveau profil est immédiatement générable (il porte
 * les mêmes types que sa source). Nom en doublon → message clair.
 */
export async function creerProfil(payload: CreerProfilPayload) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const nom = payload.nom?.trim()
  if (!nom) return { error: 'Le nom du profil est obligatoire.' }
  if (nom.length > 60) return { error: 'Le nom du profil est trop long (60 caractères max).' }

  const saison = payload.saison_suggeree ?? null
  if (saison !== null && !SAISONS_VALIDES.has(saison)) {
    return { error: 'Saison suggérée invalide.' }
  }
  const effectif = payload.nb_vetos_semaine_soir ?? null
  if (effectif !== null && !EFFECTIFS_VALIDES.has(effectif)) {
    return { error: 'Effectif invalide (1 ou 2).' }
  }

  const { error } = await supabase.rpc('dupliquer_profil', {
    p_nom: nom,
    p_source_profil_id: payload.source_profil_id ?? null,
    p_saison: saison,
    p_effectif: effectif,
  })

  if (error) {
    // 23505 = unique_violation (nom déjà pris pour ce cabinet).
    if (error.code === '23505') {
      return { error: `Un profil « ${nom} » existe déjà.` }
    }
    return { error: error.message }
  }

  revalidatePath('/admin/structure')
  revalidatePath('/admin/periodes')
  return { success: true }
}

/** Renomme un profil (RLS bornée au cabinet). Nom en doublon → message clair. */
export async function renommerProfil(profilId: string, nom: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const nouveau = nom?.trim()
  if (!nouveau) return { error: 'Le nom du profil est obligatoire.' }
  if (nouveau.length > 60) return { error: 'Le nom du profil est trop long (60 caractères max).' }

  const { error } = await supabase
    .from('profils_planning')
    .update({ nom: nouveau })
    .eq('id', profilId)

  if (error) {
    if (error.code === '23505') return { error: `Un profil « ${nouveau} » existe déjà.` }
    return { error: error.message }
  }

  revalidatePath('/admin/structure')
  revalidatePath('/admin/periodes')
  return { success: true }
}

/**
 * Règle la saison suggérée et/ou l'effectif d'un profil. `undefined` = champ
 * laissé tel quel ; `null` = valeur explicitement effacée (aucune surcharge).
 */
export async function setProfilMeta(
  profilId: string,
  meta: { saison_suggeree?: 'ete' | 'hiver' | null; nb_vetos_semaine_soir?: number | null },
) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const patch: Record<string, unknown> = {}
  if (meta.saison_suggeree !== undefined) {
    if (meta.saison_suggeree !== null && !SAISONS_VALIDES.has(meta.saison_suggeree)) {
      return { error: 'Saison suggérée invalide.' }
    }
    patch.saison_suggeree = meta.saison_suggeree
  }
  if (meta.nb_vetos_semaine_soir !== undefined) {
    if (meta.nb_vetos_semaine_soir !== null && !EFFECTIFS_VALIDES.has(meta.nb_vetos_semaine_soir)) {
      return { error: 'Effectif invalide (1 ou 2).' }
    }
    patch.nb_vetos_semaine_soir = meta.nb_vetos_semaine_soir
  }
  if (Object.keys(patch).length === 0) return { success: true }

  const { error } = await supabase
    .from('profils_planning')
    .update(patch)
    .eq('id', profilId)

  if (error) return { error: error.message }
  revalidatePath('/admin/structure')
  revalidatePath('/admin/periodes')
  return { success: true }
}

export interface SetHorairesProfilPayload {
  heure_debut: string // 'HH:MM'
  heure_fin: string // 'HH:MM'
  offset_jours_fin: number // 0..3
}

/**
 * Règle les horaires d'un type de garde POUR UN PROFIL (P5 slice 4b) : écrit
 * directement la ligne `creneau_modele` (heure_debut/fin/offset). Remplace
 * l'ancien réglage cabinet-large (creneaux_cabinet). C'est ce qui rend les
 * horaires réellement propres à un profil (« Été 19h » vs « Hiver 18h30 »).
 *
 * Garde : assertAdmin + RLS creneau_modele (admin_write + isolation cabinet) →
 * l'update ne touche qu'une ligne du cabinet courant. Validation stricte des
 * heures/offset (frontière de confiance) avant écriture.
 */
export async function setHorairesProfilCreneau(
  creneauId: string,
  payload: SetHorairesProfilPayload,
) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const invalide = validerHoraire(payload)
  if (invalide) return { error: invalide }

  const { error, count } = await supabase
    .from('creneau_modele')
    .update(
      {
        heure_debut: payload.heure_debut,
        heure_fin: payload.heure_fin,
        offset_jours_fin: payload.offset_jours_fin,
      },
      { count: 'exact' },
    )
    .eq('id', creneauId)

  if (error) return { error: error.message }
  if (count === 0) return { error: 'Créneau introuvable pour ce cabinet.' }

  revalidatePath('/admin/structure')
  return { success: true }
}

/**
 * Supprime un profil. Le profil DÉFAUT est intangible (le cabinet doit toujours
 * en avoir un). Les périodes qui le référençaient retombent sur le défaut
 * (periodes.profil_id ON DELETE SET NULL) ; son catalogue part en cascade.
 */
export async function supprimerProfil(profilId: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const { data: profil } = await supabase
    .from('profils_planning')
    .select('est_defaut')
    .eq('id', profilId)
    .maybeSingle()

  if (!profil) return { error: 'Profil introuvable.' }
  if ((profil as { est_defaut: boolean }).est_defaut) {
    return { error: 'Le profil par défaut ne peut pas être supprimé.' }
  }

  const { error } = await supabase
    .from('profils_planning')
    .delete()
    .eq('id', profilId)

  if (error) return { error: error.message }
  revalidatePath('/admin/structure')
  revalidatePath('/admin/periodes')
  return { success: true }
}

// ════════════════════════════════════════════════════════════
// P5 slice 5 — Assistant IA : créer un PROFIL en langage naturel
// ════════════════════════════════════════════════════════════
// « Crée un profil été avec 2 vétos le soir et des gardes qui démarrent à 19h »
// → l'IA PROPOSE un profil structuré → l'admin valide → creerProfilComplet
// crée (duplication d'une source) puis applique les horaires ajustés. L'IA ne
// touche JAMAIS la base : la frontière de confiance reste ces server actions
// (assertAdmin + RLS admin-only + validation stricte). Périmètre : types
// EXISTANTS uniquement (miroir de creerProfil / setHorairesProfilCreneau).

/**
 * creerProfilComplet — crée un profil par duplication d'une source, puis ajuste
 * les horaires demandés (P5 slice 5). Tout est validé AVANT création (nom,
 * saison, effectif, horaires + existence des types dans la source), pour ne
 * jamais laisser un profil à moitié réglé sur une donnée invalide.
 */
export async function creerProfilComplet(payload: CreerProfilCompletPayload) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const nom = payload.nom?.trim()
  if (!nom) return { error: 'Le nom du profil est obligatoire.' }
  if (nom.length > 60) return { error: 'Le nom du profil est trop long (60 caractères max).' }

  const saison = payload.saison_suggeree ?? null
  if (saison !== null && !SAISONS_VALIDES.has(saison)) {
    return { error: 'Saison suggérée invalide.' }
  }
  const effectif = payload.nb_vetos_semaine_soir ?? null
  if (effectif !== null && !EFFECTIFS_VALIDES.has(effectif)) {
    return { error: 'Effectif invalide (1 ou 2).' }
  }

  // Horaires à ajuster : code au format machine + triplet cohérent (frontière
  // de confiance). L'EXISTENCE du code dans le profil source est vérifiée plus
  // bas (codesSource) — les créneaux sur-mesure (P3b) sont donc réglables aussi.
  const overrides = payload.horaires ?? []
  for (const h of overrides) {
    if (!CODE_RE.test(h.code)) {
      return { error: `Type de créneau inconnu : « ${h.code} ».` }
    }
    const invalide = validerHoraire(h)
    if (invalide) return { error: `Horaire « ${h.code} » : ${invalide}` }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Source : celle demandée (bornée au cabinet), sinon le profil défaut. On la
  // résout ici pour VÉRIFIER que les types à horodater y existent bien avant de
  // créer quoi que ce soit (anti-coquille-vide).
  let sourceId = payload.source_profil_id ?? null
  if (!sourceId) {
    const { data: def } = await supabase
      .from('profils_planning')
      .select('id')
      .eq('cabinet_id', cabinetId)
      .eq('est_defaut', true)
      .maybeSingle()
    sourceId = (def as { id: string } | null)?.id ?? null
  }
  if (!sourceId) {
    return { error: 'Aucun profil source disponible pour créer ce profil.' }
  }

  if (overrides.length > 0) {
    const { data: srcRows } = await supabase
      .from('creneau_modele')
      .select('code')
      .eq('cabinet_id', cabinetId)
      .eq('profil_id', sourceId)
    const codesSource = new Set(
      ((srcRows as { code: string | null }[] | null) ?? [])
        .map((r) => r.code)
        .filter((c): c is string => Boolean(c)),
    )
    for (const h of overrides) {
      if (!codesSource.has(h.code)) {
        return { error: `Le profil source n'a pas de « ${h.code} » : impossible d'en régler l'horaire.` }
      }
    }
  }

  // 1. Créer par duplication (atomique) — récupère le nouvel id.
  const { data: newId, error: rpcErr } = await supabase.rpc('dupliquer_profil', {
    p_nom: nom,
    p_source_profil_id: sourceId,
    p_saison: saison,
    p_effectif: effectif,
  })
  if (rpcErr) {
    if (rpcErr.code === '23505') return { error: `Un profil « ${nom} » existe déjà.` }
    return { error: rpcErr.message }
  }
  const profilId = (newId as string | null) ?? null
  if (!profilId) return { error: 'Création du profil : identifiant non renvoyé.' }

  // 2. Appliquer les horaires ajustés sur les créneaux du NOUVEAU profil (par code).
  if (overrides.length > 0) {
    const { data: newRows } = await supabase
      .from('creneau_modele')
      .select('id, code')
      .eq('cabinet_id', cabinetId)
      .eq('profil_id', profilId)
    const parCode = new Map<string, string>()
    for (const r of ((newRows as { id: string; code: string | null }[] | null) ?? [])) {
      if (r.code) parCode.set(r.code, r.id)
    }
    for (const h of overrides) {
      const creneauId = parCode.get(h.code)
      if (!creneauId) continue // vérifié sur la source : ne devrait pas arriver
      const { error: upErr } = await supabase
        .from('creneau_modele')
        .update({
          heure_debut: h.heure_debut,
          heure_fin: h.heure_fin,
          offset_jours_fin: h.offset_jours_fin,
        })
        .eq('id', creneauId)
      if (upErr) {
        return { error: `Profil créé, mais l'horaire « ${h.code} » n'a pas pu être réglé : ${upErr.message}` }
      }
    }
  }

  revalidatePath('/admin/structure')
  revalidatePath('/admin/periodes')
  return { success: true }
}

/** Résultat d'une proposition de profil renvoyé à l'UI. */
export type PropositionProfilResultat =
  | { error: string }
  | {
      proposition: PropositionProfil
      /** Phrase d'aperçu (ce qui serait créé) — présente si faisable. */
      apercu: string
      /** Payload prêt pour creerProfilComplet — présent SEULEMENT si exploitable. */
      payload?: CreerProfilCompletPayload
    }

/**
 * proposerProfilDepuisTexte — passe une phrase admin à l'IA et renvoie une
 * PROPOSITION de profil (jamais d'écriture en base). L'admin créera ensuite via
 * creerProfilComplet (frontière de confiance + RLS inchangées). Admin-only.
 */
export async function proposerProfilDepuisTexte(phrase: string): Promise<PropositionProfilResultat> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  if (!assistantIaDisponible()) {
    return { error: 'Assistant IA non configuré (clé API manquante côté serveur).' }
  }
  if (!phrase || phrase.trim().length < 3) {
    return { error: 'Décris le profil en quelques mots.' }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  const { data: profilsDb } = await supabase
    .from('profils_planning')
    .select('id, nom, est_defaut')
    .eq('cabinet_id', cabinetId)
    .eq('actif', true)
    .order('ordre')
  const profils = ((profilsDb as ProfilResolu[] | null) ?? [])

  let proposition: PropositionProfil
  try {
    proposition = await proposerProfilIA(phrase.trim(), profils)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur de l'assistant IA." }
  }

  const conv = propositionVersProfilPayload(proposition, profils)
  if (!conv.ok) {
    // Non faisable / ambigu / hors périmètre : on FORCE le message de NOTRE
    // couche (cohérent avec l'UI — pas de payload → pas de bouton « Créer »).
    return {
      proposition: { ...proposition, faisable: false, message: conv.raison },
      apercu: '',
    }
  }
  return { proposition, apercu: apercuProfil(proposition), payload: conv.payload }
}

// ════════════════════════════════════════════════════════════
// P3b — Créneaux SUR-MESURE : création / activation / suppression
// ════════════════════════════════════════════════════════════
// Le moteur planifie désormais TOUT code non-null du catalogue. Ces actions
// sont LA porte d'entrée des structures non standard (garde de jour, samedi
// seul, week-end fractionné…). Frontière de confiance : assertAdmin + RLS +
// validation stricte de chaque champ, comme le reste du fichier.

/** Les 4 codes du seed — intouchables à la suppression (le défaut = filet). */
const CODES_SEED = new Set(['semaine_soir', 'vendredi_soir', 'weekend', 'ferie'])

export interface CreerCreneauSurMesurePayload {
  profil_id: string
  nom: string
  /** Jours d'application (0=dim … 6=sam), au moins un. */
  jours_semaine: number[]
  heure_debut: string // 'HH:MM'
  heure_fin: string // 'HH:MM'
  offset_jours_fin: number // 0..3
  nb_places: number // 1..N_PLACES_MAX
  /** Labels des places — longueur = nb_places, distincts. */
  roles: string[]
}

/**
 * Crée un créneau SUR-MESURE dans le catalogue d'un profil. Le code machine
 * (slug `sm_…`) est dérivé du nom — il devient l'identifiant du créneau dans
 * tout le pipeline (moteur, gardes, horaires, agenda).
 */
export async function creerCreneauSurMesure(payload: CreerCreneauSurMesurePayload) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const nom = payload.nom?.trim()
  if (!nom) return { error: 'Le nom du créneau est obligatoire.' }
  if (nom.length > 60) return { error: 'Le nom du créneau est trop long (60 caractères max).' }

  const jours = [...new Set(payload.jours_semaine ?? [])].sort()
  if (jours.length === 0) return { error: 'Choisis au moins un jour de la semaine.' }
  if (jours.some((j) => !Number.isInteger(j) || j < 0 || j > 6)) {
    return { error: 'Jour de semaine invalide.' }
  }

  const invalide = validerHoraire(payload)
  if (invalide) return { error: invalide }

  const nbPlaces = payload.nb_places
  if (!Number.isInteger(nbPlaces) || nbPlaces < 1 || nbPlaces > N_PLACES_MAX) {
    return { error: `Nombre de vétérinaires invalide (entre 1 et ${N_PLACES_MAX}).` }
  }
  const roles = (payload.roles ?? []).map((r) => r.trim())
  if (roles.length !== nbPlaces || roles.some((r) => !r || r.length > 30)) {
    return { error: 'Chaque place doit avoir un nom (30 caractères max).' }
  }
  if (new Set(roles).size !== roles.length) {
    return { error: 'Les noms des places doivent être différents.' }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Le profil cible doit appartenir au cabinet (défense en profondeur avec la RLS).
  const { data: profil } = await supabase
    .from('profils_planning')
    .select('id')
    .eq('id', payload.profil_id)
    .eq('cabinet_id', cabinetId)
    .maybeSingle()
  if (!profil) return { error: 'Profil introuvable pour ce cabinet.' }

  // Ordre : après le dernier créneau du profil.
  const { data: dernier } = await supabase
    .from('creneau_modele')
    .select('ordre')
    .eq('cabinet_id', cabinetId)
    .eq('profil_id', payload.profil_id)
    .order('ordre', { ascending: false })
    .limit(1)
    .maybeSingle()
  const ordre = ((dernier as { ordre: number } | null)?.ordre ?? 0) + 1

  const { error } = await supabase.from('creneau_modele').insert({
    cabinet_id: cabinetId,
    profil_id: payload.profil_id,
    code: slugSurMesure(nom),
    nom,
    jours_semaine: jours,
    sur_feries: false,
    heure_debut: payload.heure_debut,
    heure_fin: payload.heure_fin,
    offset_jours_fin: payload.offset_jours_fin,
    nb_places: nbPlaces,
    roles,
    actif: true,
    ordre,
  })

  if (error) {
    if (error.code === '23505') {
      return { error: `Un créneau au nom trop proche existe déjà dans ce profil — choisis un autre nom.` }
    }
    return { error: error.message }
  }

  revalidatePath('/admin/structure')
  return { success: true }
}

/**
 * Active / désactive un créneau du catalogue (seed compris — c'est ainsi qu'un
 * cabinet remplace le week-end atomique par un samedi + un dimanche sur-mesure).
 * Un créneau inactif n'émet plus aucun slot à la génération.
 */
export async function setCreneauActif(creneauId: string, actif: boolean) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const { error, count } = await supabase
    .from('creneau_modele')
    .update({ actif: actif === true }, { count: 'exact' })
    .eq('id', creneauId)

  if (error) return { error: error.message }
  if (count === 0) return { error: 'Créneau introuvable pour ce cabinet.' }

  revalidatePath('/admin/structure')
  return { success: true }
}

// ════════════════════════════════════════════════════════════
// RG tranche 4 — RELATIONS entre créneaux (ex R8/R9, généralisées)
// ════════════════════════════════════════════════════════════
// Le moteur ET le validateur consomment `relation_creneau` (RG2/RG3). Ces
// actions sont la porte d'entrée UI : lier deux créneaux d'un profil par
// « même équipe » (ex R9) ou « rôles différents » (ex R8), désactiver ou
// supprimer une liaison. Frontière de confiance : assertAdmin + RLS
// (admin_write + isolation restrictive) + trigger SQL d'intégrité (même
// cabinet + même profil, pas d'auto-lien) + validations claires ici.
//
// Le NIVEAU (ferme / souple / coupée) reste réglé PAR GENRE via les briques
// R8/R9 de /regles (config par relation individuelle = backlog).

/** Genres exposés à l'UI (repos_apres existe en base mais n'est pas consommé). */
const GENRES_RELATION_VALIDES = new Set(['meme_binome', 'inversion_role'])

export interface CreerRelationPayload {
  profil_id: string
  source_id: string
  cible_id: string
  genre: 'meme_binome' | 'inversion_role'
}

/**
 * Lie deux créneaux d'un profil. Garde métier : « même équipe » entre deux
 * créneaux couvrant UN MÊME JOUR est refusée — la règle R22 (jamais deux
 * gardes le même jour pour un même véto) rendrait tout planning impossible.
 */
export async function creerRelationCreneau(payload: CreerRelationPayload) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  if (!GENRES_RELATION_VALIDES.has(payload.genre)) {
    return { error: 'Type de liaison inconnu.' }
  }
  if (payload.source_id === payload.cible_id) {
    return { error: 'Choisis deux créneaux différents pour les lier.' }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Les deux créneaux doivent exister dans CE profil de CE cabinet (défense en
  // profondeur — le trigger SQL revérifie). On lit aussi leurs jours pour la
  // garde R22 ci-dessous.
  const { data: rows } = await supabase
    .from('creneau_modele')
    .select('id, nom, jours_semaine')
    .eq('cabinet_id', cabinetId)
    .eq('profil_id', payload.profil_id)
    .in('id', [payload.source_id, payload.cible_id])
  const creneaux = (rows as { id: string; nom: string; jours_semaine: number[] | null }[] | null) ?? []
  const source = creneaux.find((c) => c.id === payload.source_id)
  const cible = creneaux.find((c) => c.id === payload.cible_id)
  if (!source || !cible) {
    return { error: 'Créneau introuvable dans ce profil.' }
  }

  // Garde métier : même équipe + jours communs = incompatible avec R22
  // (un véto ne peut pas tenir deux gardes le même jour). On refuse AVANT
  // que le cabinet ne se fabrique un planning ingénérable.
  if (payload.genre === 'meme_binome') {
    const joursSource = new Set(source.jours_semaine ?? [])
    const commun = (cible.jours_semaine ?? []).some((j) => joursSource.has(j))
    if (commun) {
      return {
        error:
          `« ${source.nom} » et « ${cible.nom} » couvrent un même jour : exiger la même équipe `
          + 'est impossible (un vétérinaire ne peut pas tenir deux gardes le même jour). '
          + 'Utilise plutôt « rôles différents », ou lie des créneaux de jours différents.',
      }
    }
  }

  const { error } = await supabase.from('relation_creneau').insert({
    cabinet_id: cabinetId,
    profil_id: payload.profil_id,
    source_id: payload.source_id,
    cible_id: payload.cible_id,
    genre: payload.genre,
    actif: true,
  })

  if (error) {
    if (error.code === '23505') {
      return { error: 'Cette liaison existe déjà entre ces deux créneaux.' }
    }
    return { error: error.message }
  }

  revalidatePath('/admin/structure')
  return { success: true }
}

/** Active / désactive une liaison (inactif = le moteur l'ignore, réversible). */
export async function setRelationActive(relationId: string, actif: boolean) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const { error, count } = await supabase
    .from('relation_creneau')
    .update({ actif: actif === true }, { count: 'exact' })
    .eq('id', relationId)

  if (error) return { error: error.message }
  if (count === 0) return { error: 'Liaison introuvable pour ce cabinet.' }

  revalidatePath('/admin/structure')
  return { success: true }
}

/**
 * Supprime une liaison — y compris celles du seed (vendredi↔week-end) : un
 * cabinet peut réellement découpler son vendredi de son week-end. Les
 * plannings déjà générés ne sont pas modifiés (snapshot).
 */
export async function supprimerRelation(relationId: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const { error, count } = await supabase
    .from('relation_creneau')
    .delete({ count: 'exact' })
    .eq('id', relationId)

  if (error) return { error: error.message }
  if (count === 0) return { error: 'Liaison introuvable pour ce cabinet.' }

  revalidatePath('/admin/structure')
  return { success: true }
}

/** Résultat d'une proposition de liaison renvoyé à l'UI. */
export type PropositionRelationResultat =
  | { error: string }
  | {
      proposition: PropositionRelation
      /** Phrase d'aperçu (ce qui serait créé) — présente si faisable. */
      apercu: string
      /** Payload prêt pour creerRelationCreneau — présent SEULEMENT si exploitable. */
      payload?: CreerRelationIaPayload
    }

/**
 * proposerRelationDepuisTexte — passe une phrase admin à l'IA et renvoie une
 * PROPOSITION de liaison (jamais d'écriture en base). L'admin créera ensuite
 * via creerRelationCreneau (frontière de confiance + RLS + trigger inchangés).
 * Admin-only. La résolution noms → ids et la garde « même équipe + même
 * jour » (R22) sont appliquées ICI, sur la vraie donnée du cabinet.
 */
export async function proposerRelationDepuisTexte(phrase: string): Promise<PropositionRelationResultat> {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  if (!assistantIaDisponible()) {
    return { error: 'Assistant IA non configuré (clé API manquante côté serveur).' }
  }
  if (!phrase || phrase.trim().length < 3) {
    return { error: 'Décris la liaison en quelques mots.' }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Profils + catalogue (noms exacts par profil) — le contexte donné à l'IA.
  const { data: profilsDb } = await supabase
    .from('profils_planning')
    .select('id, nom, est_defaut')
    .eq('cabinet_id', cabinetId)
    .eq('actif', true)
    .order('ordre')
  const profils = ((profilsDb as ProfilResolu[] | null) ?? [])
  const { data: cmDb } = await supabase
    .from('creneau_modele')
    .select('id, nom, jours_semaine, profil_id')
    .eq('cabinet_id', cabinetId)
    .order('ordre')
  const creneauxRows =
    ((cmDb as { id: string; nom: string; jours_semaine: number[] | null; profil_id: string | null }[] | null) ?? [])

  const catalogueTexte = profils
    .map((p) => {
      const noms = creneauxRows
        .filter((c) => c.profil_id === p.id)
        .map((c) => `« ${c.nom} »`)
        .join(', ') || '(aucun type)'
      return `- Profil « ${p.nom} »${p.est_defaut ? ' (par défaut)' : ''} : ${noms}`
    })
    .join('\n') || '(aucun profil)'

  let proposition: PropositionRelation
  try {
    proposition = await proposerRelationIA(phrase.trim(), catalogueTexte)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Erreur de l'assistant IA." }
  }

  // Résolution du profil (nom → id, insensible à la casse ; null → défaut).
  const nomProfil = proposition.profil?.trim().toLowerCase()
  const profil = nomProfil
    ? profils.find((p) => p.nom.trim().toLowerCase() === nomProfil)
    : profils.find((p) => p.est_defaut) ?? profils[0]
  if (!profil) {
    return {
      proposition: {
        ...proposition,
        faisable: false,
        message: proposition.profil?.trim()
          ? `Le profil « ${proposition.profil.trim()} » n'existe pas.`
          : 'Aucun profil de planning disponible.',
      },
      apercu: '',
    }
  }

  const creneauxProfil: CreneauResoluIA[] = creneauxRows
    .filter((c) => c.profil_id === profil.id)
    .map((c) => ({ id: c.id, nom: c.nom, joursSemaine: c.jours_semaine ?? [] }))

  const conv = propositionVersRelationPayload(proposition, creneauxProfil, profil.id)
  if (!conv.ok) {
    // Non faisable / ambigu / hors périmètre : on FORCE le message de NOTRE
    // couche (cohérent avec l'UI — pas de payload → pas de bouton « Créer »).
    return {
      proposition: { ...proposition, faisable: false, message: conv.raison },
      apercu: '',
    }
  }
  return {
    proposition,
    apercu: apercuRelation(proposition, profil.est_defaut ? undefined : profil.nom),
    payload: conv.payload,
  }
}

/**
 * Supprime un créneau SUR-MESURE. Les 4 créneaux du seed sont intangibles
 * (les désactiver suffit — le défaut reste le filet de sécurité du cabinet).
 */
export async function supprimerCreneauSurMesure(creneauId: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const { data: creneau } = await supabase
    .from('creneau_modele')
    .select('code')
    .eq('id', creneauId)
    .maybeSingle()

  if (!creneau) return { error: 'Créneau introuvable pour ce cabinet.' }
  const code = (creneau as { code: string | null }).code
  if (code !== null && CODES_SEED.has(code)) {
    return { error: 'Les 4 créneaux de base ne peuvent pas être supprimés — désactive-les si besoin.' }
  }

  const { error } = await supabase
    .from('creneau_modele')
    .delete()
    .eq('id', creneauId)

  if (error) return { error: error.message }
  revalidatePath('/admin/structure')
  return { success: true }
}

// ── Paramètres du cabinet (#10 b/c/d) ────────────────────────
// Dé-câblage des partages « en dur » : agenda Google, expéditeur Brevo et
// adresse (→ zone scolaire dérivée) réglables PAR CABINET. Écriture via RPC
// SECURITY DEFINER auto-gardée (la table cabinets n'a pas de policy UPDATE
// large). Double garde : assertAdmin ici + re-vérification admin DANS la RPC.

/**
 * #10b + #10c — Règle l'agenda Google (calendarId) et l'expéditeur Brevo
 * (email + nom) du cabinet. Champs vides → NULL en base → fallback env.
 */
export async function configurerPartagesCabinet(input: {
  googleCalendarId: string
  brevoFromEmail: string
  brevoFromName: string
}) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const { error } = await supabase.rpc('configurer_partages_cabinet', {
    p_google_calendar_id: input.googleCalendarId ?? '',
    p_brevo_from_email: input.brevoFromEmail ?? '',
    p_brevo_from_name: input.brevoFromName ?? '',
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/structure')
  return { success: true }
}

/**
 * #10d — Enregistre l'adresse du cabinet ET en DÉRIVE la zone scolaire (A/B/C)
 * + la région des fériés depuis le code postal (src/lib/geo-zone.ts, table
 * département→zone). Si la dérivation est incertaine (Corse, DOM, CP invalide),
 * la zone/région déjà configurée est CONSERVÉE (aucune régression du calendrier).
 * Retourne la zone/région dérivées pour le retour visuel admin.
 */
export async function configurerAdresseCabinet(input: {
  adresse: string
  codePostal: string
  ville: string
}) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  const { zone, region, departement } = zoneEtRegionDepuisCodePostal(input.codePostal ?? '')

  const { error } = await supabase.rpc('configurer_adresse_cabinet', {
    p_adresse: input.adresse ?? '',
    p_code_postal: input.codePostal ?? '',
    p_ville: input.ville ?? '',
    p_zone: zone, // null → RPC conserve la valeur existante (COALESCE)
    p_region: region,
  })
  if (error) return { error: error.message }

  revalidatePath('/admin/structure')
  return {
    success: true as const,
    derive: { zone, region, departement },
  }
}
