'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { sendBrevoEmail, emailCongeValide, emailCongeRefuse } from '@/lib/brevo'
import type { CreneauConge, TypeConge } from '@/types'

export interface CongeFormData {
  veterinaire_id: string
  date_debut: string
  date_fin: string
  type: TypeConge
  creneau: CreneauConge | null
  commentaire: string
}

export async function createConge(data: CongeFormData, saisi_par: string, isAdmin: boolean) {
  const supabase = await createClient()

  const { error } = await supabase.from('conges').insert({
    veterinaire_id: data.veterinaire_id,
    date_debut: data.date_debut,
    date_fin: data.date_fin,
    type: data.type,
    creneau: data.creneau || null,
    statut: isAdmin ? 'valide' : 'souhait',
    commentaire: data.commentaire || null,
    saisi_par,
    valide_par: isAdmin ? saisi_par : null,
  })

  if (error) return { error: error.message }
  revalidatePath('/conges')
  revalidatePath('/admin/demandes')
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
      creneau: data.creneau || null,
      commentaire: data.commentaire || null,
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/conges')
  revalidatePath('/admin/demandes')
  return { success: true }
}

export async function deleteConge(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('conges').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/conges')
  revalidatePath('/admin/demandes')
  return { success: true }
}

export async function validerConge(
  id: string,
  valide_par: string,
  date_debut?: string,
  date_fin?: string
) {
  const supabase = await createClient()

  // Récupère les données du congé + vet AVANT la mise à jour (pour l'email)
  const { data: conge } = await supabase
    .from('conges')
    .select('veterinaire_id, date_debut, date_fin, type, creneau')
    .eq('id', id)
    .single()

  const update: Record<string, unknown> = { statut: 'valide', valide_par }
  if (date_debut) update.date_debut = date_debut
  if (date_fin) update.date_fin = date_fin

  const { error } = await supabase.from('conges').update(update).eq('id', id)
  if (error) return { error: error.message }

  // Notification email (fire-and-forget — n'échoue pas le process principal)
  if (conge) {
    const { data: vet } = await supabase
      .from('veterinaires')
      .select('email, prenom, nom')
      .eq('id', conge.veterinaire_id)
      .single()

    if (vet) {
      sendBrevoEmail({
        to: vet.email,
        toName: `${vet.prenom} ${vet.nom}`,
        subject: 'Votre demande a été validée — GuardVeto',
        htmlContent: emailCongeValide({
          prenom: vet.prenom,
          type: conge.type,
          creneau: conge.creneau,
          date_debut: date_debut ?? conge.date_debut,
          date_fin: date_fin ?? conge.date_fin,
        }),
      }).catch(console.error)
    }
  }

  revalidatePath('/conges')
  revalidatePath('/admin/demandes')
  return { success: true }
}

export async function refuserConge(id: string, raison?: string) {
  const supabase = await createClient()

  // Récupère les données du congé + vet AVANT la mise à jour (pour l'email)
  const { data: conge } = await supabase
    .from('conges')
    .select('veterinaire_id, date_debut, date_fin, type, creneau')
    .eq('id', id)
    .single()

  const { error } = await supabase
    .from('conges')
    .update({ statut: 'refuse', raison_refus: raison ?? null })
    .eq('id', id)

  if (error) return { error: error.message }

  // Notification email
  if (conge) {
    const { data: vet } = await supabase
      .from('veterinaires')
      .select('email, prenom, nom')
      .eq('id', conge.veterinaire_id)
      .single()

    if (vet) {
      sendBrevoEmail({
        to: vet.email,
        toName: `${vet.prenom} ${vet.nom}`,
        subject: 'Votre demande n\'a pas pu être acceptée — GuardVeto',
        htmlContent: emailCongeRefuse({
          prenom: vet.prenom,
          type: conge.type,
          creneau: conge.creneau,
          date_debut: conge.date_debut,
          date_fin: conge.date_fin,
          raison: raison ?? null,
        }),
      }).catch(console.error)
    }
  }

  revalidatePath('/conges')
  revalidatePath('/admin/demandes')
  return { success: true }
}
