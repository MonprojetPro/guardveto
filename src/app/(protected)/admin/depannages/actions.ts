'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StatutCompensation } from '@/types'

const STATUTS_AUTORISES: StatutCompensation[] = ['a_compenser', 'compensee', 'annulee']

/**
 * Change le statut d'une compensation (dette de dépannage).
 *
 * Garde de sécurité :
 *   1. Utilisateur authentifié + rôle admin (la RLS compensations_admin_write
 *      le double côté base, mais on coupe court ici).
 *   2. Statut validé contre la liste fermée (jamais une valeur libre du client).
 *
 * L'isolation cabinet est assurée par la RLS RESTRICTIVE (cabinet_id =
 * auth_cabinet_actif()) : un admin ne peut muter que les lignes de son cabinet.
 */
export async function changerStatutCompensation(
  id: string,
  nouveauStatut: StatutCompensation
) {
  if (!STATUTS_AUTORISES.includes(nouveauStatut)) {
    return { error: 'Statut invalide.' }
  }

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return { error: 'Action réservée aux administrateurs.' }
  }

  const { error } = await supabase
    .from('compensations')
    .update({ statut: nouveauStatut })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin/depannages')
  return { success: true }
}
