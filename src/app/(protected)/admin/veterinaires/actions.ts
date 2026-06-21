'use server'

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
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

  // cabinet_id dérivé côté serveur (jamais du client) — sinon le véto
  // est inséré avec cabinet_id NULL et reste invisible sous RLS stricte.
  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  // Vérifie unicité email (au sein du cabinet)
  const { data: existing } = await supabase
    .from('veterinaires')
    .select('id')
    .eq('email', data.email.trim().toLowerCase())
    .eq('cabinet_id', cabinetId)
    .maybeSingle()

  if (existing) {
    return { error: 'Un vétérinaire avec cet email existe déjà.' }
  }

  const { error } = await supabase.from('veterinaires').insert({
    cabinet_id: cabinetId,
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
    // Compte invité mais non confirmé → supprime et ré-invite pour générer un nouveau lien
    await adminClient.auth.admin.deleteUser(existingUser.id)
  }

  // Invite (nouveau ou après suppression)
  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    vet.email,
    { data: { veterinaire_id: id } }
  )
  if (inviteError) return { error: inviteError.message }
  authUserId = inviteData.user.id

  // Met à jour user_id et invite_pending (toujours, car l'auth user peut avoir changé)
  const { error: updateError } = await adminClient
    .from('veterinaires')
    .update({ user_id: authUserId, invite_pending: true })
    .eq('id', id)
  if (updateError) return { error: updateError.message }

  revalidatePath('/admin/veterinaires')
  return { success: true, email: vet.email }
}

export interface GardeAVenir {
  date: string
  type: string
}

type ToggleActifResult =
  | { error: string }
  | { success: true }
  | { requiresConfirmation: true; gardesAVenir: GardeAVenir[] }

/**
 * Active / désactive un vétérinaire.
 *
 * Garde-fou Chantier B : désactiver un véto qui est ENCORE de garde sur un
 * planning PUBLIÉ à venir le fait sortir des compteurs (équité faussée) et
 * laisse une garde « orpheline » que personne ne couvre vraiment. On refuse
 * donc de désactiver en silence : sans `confirm`, on renvoie la liste des
 * gardes publiées à venir pour que l'UI demande une confirmation explicite.
 * (La désactivation n'efface PAS ces gardes — il faudra les réattribuer via
 * une édition manuelle ou la gestion de crise.)
 */
export async function toggleVeterinaireActif(
  id: string,
  actif: boolean,
  confirm: boolean = false
): Promise<ToggleActifResult> {
  const supabase = await createClient()

  // Contrôle uniquement à la DÉSACTIVATION (réactiver est toujours sûr).
  if (!actif && !confirm) {
    const today = new Date().toISOString().slice(0, 10)
    const { data: gardes } = await supabase
      .from('gardes')
      .select('date, type, periodes!inner(statut)')
      .or(`premier_id.eq.${id},second_id.eq.${id}`)
      .gte('date', today)
      .eq('periodes.statut', 'publie')
      .order('date')

    if (gardes && gardes.length > 0) {
      return {
        requiresConfirmation: true as const,
        gardesAVenir: (gardes as { date: string; type: string }[]).map((g) => ({
          date: g.date,
          type: g.type,
        })),
      }
    }
  }

  const { error } = await supabase
    .from('veterinaires')
    .update({ actif })
    .eq('id', id)

  if (error) return { error: error.message }

  revalidatePath('/admin/veterinaires')
  return { success: true }
}
