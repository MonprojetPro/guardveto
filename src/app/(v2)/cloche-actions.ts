'use server'

// ============================================================
// GUARDVETO V2 — La cloche : lire et marquer ses notifications (B-183)
// ============================================================
// Reprise de `src/data/notifications.ts`, supprimé avec la V1 le 28/10
// (B-176, `e305e2a`). Depuis, la base continuait d'écrire des notifications
// (« Fanny a pris une place libre », « Une de vos gardes a changé ») que plus
// AUCUN écran ne lisait : 182 non lues au Val d'Allier le 03/11.
//
// La RLS fait le cloisonnement, et c'est elle la barrière réelle :
//   • notifications_read_own   → on ne lit QUE les siennes ;
//   • notifications_update_own → on ne marque lues QUE les siennes ;
//   • notifications_cabinet_isolation (RESTRICTIVE) → jamais un autre cabinet.
//
// ⚠️ Ce fichier n'exporte QUE des fonctions async : un `'use server'` qui
//    réexporte un type casse au build (leçon du projet). Les types vivent dans
//    `lib/notifications/types.ts`.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import type { EtatCloche, NotificationCloche } from '@/lib/notifications/types'

const VIDE: EtatCloche = { items: [], nbNonLues: 0, erreur: false }

/** Les 30 dernières notifications de la personne connectée, et le nombre de non lues. */
export async function lireNotifications(): Promise<EtatCloche> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return VIDE

  const [liste, compte] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, type, titre, message, lien, lu, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('lu', false),
  ])

  // Une lecture en échec ne doit pas se lire « aucune notification » : la
  // cloche le dit (`erreur`) au lieu d'afficher une boîte vide rassurante.
  if (liste.error || compte.error) {
    console.error('[cloche] lecture impossible :', liste.error?.message ?? compte.error?.message)
    return { ...VIDE, erreur: true }
  }
  return {
    items: (liste.data ?? []) as NotificationCloche[],
    nbNonLues: compte.count ?? 0,
    erreur: false,
  }
}

/** Marque UNE notification comme lue (la RLS garantit que c'est la sienne). */
export async function marquerNotificationLue(id: string): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || typeof id !== 'string' || id.length === 0) return false
  // `.select('id')` : un UPDATE refusé par la RLS rend zéro ligne SANS erreur.
  const { data, error } = await supabase.from('notifications').update({ lu: true }).eq('id', id).select('id')
  return !error && (data?.length ?? 0) > 0
}

/** Marque TOUTES ses notifications non lues comme lues. */
export async function marquerToutesNotificationsLues(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { error } = await supabase.from('notifications').update({ lu: true }).eq('lu', false)
  return !error
}
