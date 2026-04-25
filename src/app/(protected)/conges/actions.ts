'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { TypeConge } from '@/types'

export interface CongeFormData {
  veterinaire_id: string
  date_debut: string
  date_fin: string
  type: TypeConge
  commentaire: string
}

export async function createConge(data: CongeFormData, saisi_par: string, isAdmin: boolean) {
  const supabase = await createClient()

  const { error } = await supabase.from('conges').insert({
    veterinaire_id: data.veterinaire_id,
    date_debut: data.date_debut,
    date_fin: data.date_fin,
    type: data.type,
    statut: isAdmin ? 'valide' : 'souhait',
    commentaire: data.commentaire || null,
    saisi_par,
    valide_par: isAdmin ? saisi_par : null,
  })

  if (error) return { error: error.message }
  revalidatePath('/conges')
  return { success: true }
}

export async function updateConge(id: string, data: CongeFormData) {
  const supabase = await createClient()

  const { error } = await supabase
    .from('conges')
    .update({
      veterinaire_id: data.veterinaire_id,
      date_debut: data.date_debut,
      date_fin: data.date_fin,
      type: data.type,
      commentaire: data.commentaire || null,
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/conges')
  return { success: true }
}

export async function deleteConge(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('conges').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/conges')
  return { success: true }
}

export async function validerConge(
  id: string,
  valide_par: string,
  date_debut?: string,
  date_fin?: string
) {
  const supabase = await createClient()
  const update: Record<string, unknown> = { statut: 'valide', valide_par }
  if (date_debut) update.date_debut = date_debut
  if (date_fin) update.date_fin = date_fin

  const { error } = await supabase.from('conges').update(update).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/conges')
  return { success: true }
}

export async function refuserConge(id: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('conges')
    .update({ statut: 'refuse' })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/conges')
  return { success: true }
}
