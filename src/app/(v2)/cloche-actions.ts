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
// B-191 (06/11) — « Vider » et la croix d'une notification RETIRENT de la
// cloche (`retiree_le`) sans effacer : deux anti-doublons d'alerte lisent la
// table, effacer relancerait l'alerte qu'on vient de vider. Même policy
// UPDATE que « marquer lu » : rien de plus n'est ouvert.
//
// ⚠️ Ce fichier n'exporte QUE des fonctions async : un `'use server'` qui
//    réexporte un type casse au build (leçon du projet). Les types vivent dans
//    `lib/notifications/types.ts`.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import type { EtatCloche, NotificationCloche } from '@/lib/notifications/types'

const VIDE: EtatCloche = { items: [], nbNonLues: 0, erreur: false }

/** Taille d'une page de la cloche comme de l'écran « Toutes mes notifications ». */
const PAGE = 30

/**
 * Les notifications de la personne connectée (non retirées), les plus récentes
 * d'abord, et le nombre de non lues. `depuis` = nombre déjà affiché, pour
 * charger la page suivante. Par position et non par date : des notifications
 * créées au même instant (une même action, plusieurs destinataires ou plusieurs
 * alertes) seraient sautées à la frontière d'une page par un « plus ancien que ».
 */
export async function lireNotifications(depuis = 0): Promise<EtatCloche> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return VIDE

  const requete = supabase
    .from('notifications')
    .select('id, type, titre, message, lien, lu, created_at')
    .is('retiree_le', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(Math.max(0, Math.floor(depuis) || 0), Math.max(0, Math.floor(depuis) || 0) + PAGE)

  const [liste, compte] = await Promise.all([
    requete,
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('lu', false)
      .is('retiree_le', null),
  ])

  // Une lecture en échec ne doit pas se lire « aucune notification » : la
  // cloche le dit (`erreur`) au lieu d'afficher une boîte vide rassurante.
  if (liste.error || compte.error) {
    console.error('[cloche] lecture impossible :', liste.error?.message ?? compte.error?.message)
    return { ...VIDE, erreur: true }
  }
  const lignes = (liste.data ?? []) as NotificationCloche[]
  return {
    items: lignes.slice(0, PAGE),
    nbNonLues: compte.count ?? 0,
    erreur: false,
    aSuite: lignes.length > PAGE,
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

/** Retire UNE notification de la cloche (la croix). La RLS garantit que c'est la sienne. */
export async function retirerNotification(id: string): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || typeof id !== 'string' || id.length === 0) return false
  // `.select('id')` : un UPDATE refusé par la RLS rend zéro ligne SANS erreur.
  const { data, error } = await supabase
    .from('notifications')
    .update({ retiree_le: new Date().toISOString() })
    .eq('id', id)
    .is('retiree_le', null)
    .select('id')
  return !error && (data?.length ?? 0) > 0
}

/** « Vider la cloche » : retire TOUTES ses notifications, lues ou non. */
export async function viderCloche(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const { error } = await supabase
    .from('notifications')
    .update({ retiree_le: new Date().toISOString() })
    .is('retiree_le', null)
  return !error
}
