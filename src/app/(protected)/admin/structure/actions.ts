'use server'

// ============================================================
// GUARDVETO — Server actions « Structure des créneaux » (A3)
// ============================================================
// Écritures sur creneaux_cabinet (surcouche des horaires PAR CABINET) :
//   • upsertCreneauCabinet — crée/met à jour l'horaire d'un type (UPSERT
//     onConflict cabinet_id,code) → le cabinet surcharge le défaut ;
//   • resetCreneauCabinet  — supprime la ligne → retour au défaut.
//
// Double garde : (1) vérification rôle admin côté serveur (message clair),
// (2) RLS creneaux_cabinet (migration A1) — write admin-only + isolation
// RESTRICTIVE par cabinet. Un véto ne peut donc rien écrire, même en appel
// direct. Le cabinet_id est TOUJOURS dérivé côté serveur (jamais du client),
// sinon la ligne serait invisible sous RLS.
//
// Frontière de confiance : code/heures/offset validés ici avant toute écriture
// (formats stricts + bornes), pour ne jamais insérer une valeur que le moteur
// ou l'agenda ne saurait interpréter.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypeGardeEngine } from '@/engine/types'
import { assistantIaDisponible } from '@/lib/ia/proposerRegle'
import { proposerProfilIA } from '@/lib/ia/proposerProfil'
import {
  propositionVersProfilPayload,
  apercuProfil,
  type PropositionProfil,
  type ProfilResolu,
  type CreerProfilCompletPayload,
} from '@/lib/ia/profilSchema'

// ── Référentiels de validation ───────────────────────────────
const CODES_VALIDES = new Set<TypeGardeEngine>([
  'semaine_soir', 'vendredi_soir', 'weekend', 'ferie',
])
/** 'HH:MM' 24h strict (00:00 → 23:59). */
const HEURE_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const OFFSET_MIN = 0
const OFFSET_MAX = 3

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

// ── Payload du formulaire (champs simples) ───────────────────
export interface UpsertCreneauPayload {
  code: string
  heure_debut: string // 'HH:MM'
  heure_fin: string // 'HH:MM'
  offset_jours_fin: number // 0..3
}

/**
 * Crée ou met à jour l'horaire d'un type de créneau pour le cabinet courant.
 * UPSERT sur (cabinet_id, code). L'absence de ligne = horaires par défaut :
 * écrire ici surcharge, réinitialiser (resetCreneauCabinet) revient au défaut.
 */
export async function upsertCreneauCabinet(payload: UpsertCreneauPayload) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  // Validation stricte (frontière de confiance).
  if (!CODES_VALIDES.has(payload.code as TypeGardeEngine)) {
    return { error: `Type de créneau inconnu : « ${payload.code} ».` }
  }
  if (!HEURE_RE.test(payload.heure_debut)) {
    return { error: "Heure de début invalide (format attendu HH:MM)." }
  }
  if (!HEURE_RE.test(payload.heure_fin)) {
    return { error: 'Heure de fin invalide (format attendu HH:MM).' }
  }
  const offset = payload.offset_jours_fin
  if (!Number.isInteger(offset) || offset < OFFSET_MIN || offset > OFFSET_MAX) {
    return { error: `Jour de fin invalide (doit être entre ${OFFSET_MIN} et ${OFFSET_MAX}).` }
  }
  // Cohérence : si la garde finit le jour même (offset 0), la fin doit être
  // strictement après le début. Si elle finit un autre jour (offset ≥ 1),
  // n'importe quelle heure de fin est cohérente (ex. 18:30 → 08:30 le lendemain).
  if (offset === 0 && enMinutes(payload.heure_fin) <= enMinutes(payload.heure_debut)) {
    return {
      error:
        "L'heure de fin doit être après l'heure de début, ou la garde doit se "
        + 'terminer un jour suivant.',
    }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  const { error } = await supabase
    .from('creneaux_cabinet')
    .upsert(
      {
        cabinet_id: cabinetId,
        code: payload.code,
        heure_debut: payload.heure_debut,
        heure_fin: payload.heure_fin,
        offset_jours_fin: offset,
        actif: true,
      },
      { onConflict: 'cabinet_id,code' },
    )

  if (error) return { error: error.message }
  revalidatePath('/admin/structure')
  return { success: true }
}

/**
 * Réinitialise un type de créneau : supprime la surcharge du cabinet → le code
 * retombe sur les horaires par défaut (structure-creneaux). Admin-only + RLS.
 */
export async function resetCreneauCabinet(code: string) {
  const supabase = await createClient()

  const garde = await assertAdmin(supabase)
  if ('error' in garde) return garde

  if (!CODES_VALIDES.has(code as TypeGardeEngine)) {
    return { error: `Type de créneau inconnu : « ${code} ».` }
  }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  const { error } = await supabase
    .from('creneaux_cabinet')
    .delete()
    .eq('cabinet_id', cabinetId)
    .eq('code', code)

  if (error) return { error: error.message }
  revalidatePath('/admin/structure')
  return { success: true }
}

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

  // Horaires à ajuster : type connu + triplet cohérent (frontière de confiance).
  const overrides = payload.horaires ?? []
  for (const h of overrides) {
    if (!CODES_VALIDES.has(h.code as TypeGardeEngine)) {
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
