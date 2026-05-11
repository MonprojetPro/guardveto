'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
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

export async function inviterVeterinaire(id: string) {
  // Récupère l'email du véto
  const supabase = await createClient()
  const { data: vet } = await supabase
    .from('veterinaires')
    .select('email, prenom, nom, user_id')
    .eq('id', id)
    .single()

  if (!vet) return { error: 'Vétérinaire introuvable.' }
  if (vet.user_id) return { error: 'Ce vétérinaire a déjà un compte.' }

  // Client admin avec service_role
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Vérifie si un compte auth existe déjà pour cet email
  const { data: existingUsers } = await adminClient.auth.admin.listUsers()
  const existingUser = existingUsers?.users?.find((u) => u.email === vet.email)

  let authUserId: string

  if (existingUser) {
    if (existingUser.confirmed_at) {
      // Compte déjà confirmé et actif → rien à faire
      return { error: 'Ce compte est déjà actif.' }
    }
    // Compte invité mais non confirmé → renvoie l'invitation
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      vet.email,
      { data: { veterinaire_id: id } }
    )
    if (inviteError) return { error: inviteError.message }
    authUserId = inviteData?.user?.id ?? existingUser.id
  } else {
    // Nouveau compte → envoie l'invitation par email
    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      vet.email,
      { data: { veterinaire_id: id } }
    )
    if (inviteError) return { error: inviteError.message }
    authUserId = inviteData.user.id
  }

  // Lie le user_id au vétérinaire (si pas encore lié)
  if (!vet.user_id) {
    const { error: updateError } = await adminClient
      .from('veterinaires')
      .update({ user_id: authUserId })
      .eq('id', id)
    if (updateError) return { error: updateError.message }
  }

  revalidatePath('/admin/veterinaires')
  return { success: true, email: vet.email }
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
