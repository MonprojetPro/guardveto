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

  if (!HEURE_RE.test(payload.heure_debut)) {
    return { error: 'Heure de début invalide (format attendu HH:MM).' }
  }
  if (!HEURE_RE.test(payload.heure_fin)) {
    return { error: 'Heure de fin invalide (format attendu HH:MM).' }
  }
  const offset = payload.offset_jours_fin
  if (!Number.isInteger(offset) || offset < OFFSET_MIN || offset > OFFSET_MAX) {
    return { error: `Jour de fin invalide (doit être entre ${OFFSET_MIN} et ${OFFSET_MAX}).` }
  }
  if (offset === 0 && enMinutes(payload.heure_fin) <= enMinutes(payload.heure_debut)) {
    return {
      error:
        "L'heure de fin doit être après l'heure de début, ou la garde doit se "
        + 'terminer un jour suivant.',
    }
  }

  const { error, count } = await supabase
    .from('creneau_modele')
    .update(
      {
        heure_debut: payload.heure_debut,
        heure_fin: payload.heure_fin,
        offset_jours_fin: offset,
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
