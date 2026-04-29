'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function creerPeriode(formData: FormData) {
  const supabase = await createClient()

  const saison    = formData.get('saison') as string
  const numero    = formData.get('numero') ? Number(formData.get('numero')) : null
  const dateDebut = formData.get('date_debut') as string
  const dateFin   = formData.get('date_fin') as string

  if (!saison || !dateDebut || !dateFin) {
    return { error: 'Tous les champs sont requis.' }
  }

  // Vérification : date_debut doit être un lundi
  const jour = new Date(dateDebut + 'T12:00:00Z').getUTCDay()
  if (jour !== 1) {
    return { error: 'La date de début doit être un lundi.' }
  }

  const { error } = await supabase.from('periodes').insert({
    saison,
    numero:     saison === 'hiver' ? numero : null,
    date_debut: dateDebut,
    date_fin:   dateFin,
    statut:     'brouillon',
  })

  if (error) return { error: error.message }

  revalidatePath('/admin/periodes')
  return { success: true }
}

export async function supprimerPeriode(periodeId: string) {
  const supabase = await createClient()

  // Sécurité : seulement les brouillons sans gardes peuvent être supprimés
  const { count } = await supabase
    .from('gardes')
    .select('*', { count: 'exact', head: true })
    .eq('periode_id', periodeId)

  if (count && count > 0) {
    return { error: 'Cette période a des gardes générées. Impossible de la supprimer.' }
  }

  const { error } = await supabase
    .from('periodes')
    .delete()
    .eq('id', periodeId)
    .eq('statut', 'brouillon')

  if (error) return { error: error.message }

  revalidatePath('/admin/periodes')
  return { success: true }
}
