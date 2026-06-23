'use server'

// ============================================================
// GUARDVETO — Données des notifications in-app (C2)
// ============================================================
// Server Actions de LECTURE et de MARQUAGE des notifications de l'utilisateur
// courant. La RLS fait tout le travail de cloisonnement :
//   • notifications_read_own   → on ne lit QUE ses propres notifs
//   • notifications_update_own → on ne marque comme lues QUE les siennes
//   • notifications_cabinet_isolation (RESTRICTIVE) → jamais d'autre cabinet
// Aucun filtre veterinaire_id explicite n'est donc nécessaire ici : il serait
// redondant avec la policy (et la policy reste la barrière de sécurité réelle).
// ============================================================

import { createClient } from '@/lib/supabase/server'

export interface NotificationItem {
  id: string
  type: string
  titre: string
  message: string
  lien: string | null
  lu: boolean
  created_at: string
}

export interface NotificationsState {
  items: NotificationItem[]
  nbNonLues: number
}

const ETAT_VIDE: NotificationsState = { items: [], nbNonLues: 0 }

/**
 * Charge les dernières notifications de l'utilisateur courant + le compteur de
 * non-lues. Utilisée pour le rendu SSR initial (layout) ET pour les refresh
 * déclenchés par le composant client (Realtime).
 */
export async function getNotifications(limit = 30): Promise<NotificationsState> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return ETAT_VIDE

  const [{ data: items }, { count }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, type, titre, message, lien, lu, created_at')
      .order('created_at', { ascending: false })
      .limit(limit),
    supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('lu', false),
  ])

  return {
    items: (items ?? []) as NotificationItem[],
    nbNonLues: count ?? 0,
  }
}

/** Marque UNE notification comme lue (RLS : forcément la sienne). */
export async function marquerLu(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('notifications').update({ lu: true }).eq('id', id)
}

/** Marque TOUTES ses notifications non-lues comme lues. */
export async function marquerToutLu(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('notifications').update({ lu: true }).eq('lu', false)
}
