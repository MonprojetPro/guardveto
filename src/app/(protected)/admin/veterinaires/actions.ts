'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { StatutVeto, UserRole } from '@/types'

export interface VeterinaireFormData {
  nom: string
  prenom: string
  email: string
  statut: StatutVeto
  role_app: UserRole
  couleur: string
  actif: boolean
  dernier_recours: boolean
}

export async function createVeterinaire(data: VeterinaireFormData) {
  const supabase = await createClient()

  // Vérifie unicité email
  const { data: existing } = await supabase
    .from('veterinaires')
    .select('id')
    .eq('email', data.email)
    .single()

  if (existing) {
    return { error: 'Un vétérinaire avec cet email existe déjà.' }
  }

  const { error } = await supabase.from('veterinaires').insert({
    nom: data.nom.trim(),
    prenom: data.prenom.trim(),
    email: data.email.trim().toLowerCase(),
    statut: data.statut,
    role_app: data.role_app,
    couleur: data.couleur,
    actif: data.actif,
    dernier_recours: data.dernier_recours,
    user_id: null,
  })

  if (error) return { error: error.message }

  revalidatePath('/admin/veterinaires')
  return { success: true }
}

export async function updateVeterinaire(id: string, data: VeterinaireFormData) {
  const supabase = await createClient()

  // Vérifie unicité email (hors soi-même)
  const { data: existing } = await supabase
    .from('veterinaires')
    .select('id')
    .eq('email', data.email)
    .neq('id', id)
    .single()

  if (existing) {
    return { error: 'Un vétérinaire avec cet email existe déjà.' }
  }

  const { error } = await supabase
    .from('veterinaires')
    .update({
      nom: data.nom.trim(),
      prenom: data.prenom.trim(),
      email: data.email.trim().toLowerCase(),
      statut: data.statut,
      role_app: data.role_app,
      couleur: data.couleur,
      actif: data.actif,
      dernier_recours: data.dernier_recours,
    })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin/veterinaires')
  return { success: true }
}

export async function toggleVeterinaireActif(id: string, actif: boolean) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('veterinaires')
    .update({ actif })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin/veterinaires')
  return { success: true }
}
