'use server'

// ============================================================
// GUARDVETO — Server actions « Règles du cabinet » (P1A-006)
// ============================================================
// Écritures sur regles_cabinet : activer/désactiver + supprimer.
// Double garde : (1) vérification rôle admin côté serveur (message clair),
// (2) RLS regles_cabinet (F5-003) — write admin-only + isolation cabinet
// RESTRICTIVE. Un véto ne peut donc rien écrire, même via appel direct.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'

async function assertAdmin(
  supabase: SupabaseClient<any, any, any>,
): Promise<{ error: string } | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return { error: "Action réservée à l'administrateur du cabinet." }
  }
  return null
}

/** Active ou désactive une règle (toggle `actif`). */
export async function setRegleActif(id: string, actif: boolean) {
  const supabase = await createClient()

  const refus = await assertAdmin(supabase)
  if (refus) return refus

  const { error } = await supabase
    .from('regles_cabinet')
    .update({ actif })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/regles')
  return { success: true }
}

/** Supprime définitivement une règle. */
export async function deleteRegle(id: string) {
  const supabase = await createClient()

  const refus = await assertAdmin(supabase)
  if (refus) return refus

  const { error } = await supabase
    .from('regles_cabinet')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/regles')
  return { success: true }
}
