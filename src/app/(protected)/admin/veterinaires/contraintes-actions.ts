'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ContrainteVeto } from '@/types'

export type TypeContrainte = ContrainteVeto['type']

export type ConfigJourReposFixe = {
  jour: string
  flexible_vacances?: boolean
}

export type ConfigJourReposConditionnel = {
  si_garde_we: string
  sinon: string
}

export type ConfigIndisposCyclique = {
  semaines: 'paires' | 'impaires' | 'toutes'
  periodes: ('soir_semaine' | 'weekend' | 'journee_semaine')[]
}

export type ConfigDuoInterdit = {
  avec_veterinaire_id: string
}

export type ConfigContrainte =
  | ConfigJourReposFixe
  | ConfigJourReposConditionnel
  | ConfigIndisposCyclique
  | ConfigDuoInterdit

export async function createContrainte(
  veterinaire_id: string,
  type: TypeContrainte,
  config: ConfigContrainte
) {
  const supabase = await createClient()
  const { error } = await supabase.from('contraintes_veto').insert({
    veterinaire_id,
    type,
    config,
    actif: true,
  })
  if (error) return { error: error.message }
  revalidatePath('/admin/veterinaires')
  return { success: true }
}

export async function updateContrainte(
  id: string,
  type: TypeContrainte,
  config: ConfigContrainte
) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('contraintes_veto')
    .update({ type, config })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/veterinaires')
  return { success: true }
}

export async function deleteContrainte(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('contraintes_veto').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/admin/veterinaires')
  return { success: true }
}
