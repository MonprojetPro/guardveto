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
