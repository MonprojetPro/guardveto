'use client'

// ============================================================
// GUARDVETO — NotificationBell (C2) : la cloche
// ============================================================
// Cloche du header avec compteur de non-lues + panneau déroulant. S'abonne en
// Realtime à la table `notifications` : la RLS garantit que ce client ne reçoit
// QUE ses propres notifs (aucune fuite inter-véto / inter-cabinet). À chaque
// changement, on refetch côté serveur (source de vérité) — debounced.
//
// L'état initial vient du SSR (layout) → aucun flash vide au 1er rendu.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { abonnerEnSignalantLesEchecs } from '@/lib/realtime/statut-abonnement'
import {
  getNotifications,
  marquerLu,
  marquerToutLu,
  type NotificationItem,
  type NotificationsState,
} from '@/data/notifications'

interface NotificationBellProps {
  initial: NotificationsState
}

function tempsRelatif(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  const j = Math.floor(h / 24)
  if (j < 7) return `il y a ${j} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export function NotificationBell({ initial }: NotificationBellProps) {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>(initial.items)
  const [nbNonLues, setNbNonLues] = useState<number>(initial.nbNonLues)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Source de vérité = serveur (RLS). On refetch plutôt que de bricoler l'état.
  const refetch = useCallback(async () => {
    try {
      const etat = await getNotifications()
      setItems(etat.items)
      setNbNonLues(etat.nbNonLues)
    } catch {
      // best-effort : on garde l'état précédent
    }
  }, [])

  // ── Realtime : tout changement sur `notifications` → refetch (debounced) ──
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('notifications-cloche')
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications' },
      () => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(refetch, 500)
      }
    )
    abonnerEnSignalantLesEchecs(channel, "cloche : notifications")
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [refetch])

  // ── Fermeture au clic extérieur ──
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  async function ouvrirNotif(n: NotificationItem) {
    setOpen(false)
    if (!n.lu) {
      // optimiste
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, lu: true } : i)))
      setNbNonLues((c) => Math.max(0, c - 1))
      await marquerLu(n.id)
    }
    if (n.lien) router.push(n.lien)
  }

  async function toutMarquerLu() {
    setItems((prev) => prev.map((i) => ({ ...i, lu: true })))
    setNbNonLues(0)
    await marquerToutLu()
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={nbNonLues > 0 ? `Notifications (${nbNonLues} non lues)` : 'Notifications'}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {nbNonLues > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {nbNonLues > 9 ? '9+' : nbNonLues}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {/* En-tête */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {nbNonLues > 0 && (
              <button
                type="button"
                onClick={toutMarquerLu}
                className="flex items-center gap-1 text-xs text-primary transition-colors hover:text-primary/80"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Tout marquer comme lu
              </button>
            )}
          </div>

          {/* Liste */}
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <Inbox className="h-7 w-7 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Aucune notification</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => ouvrirNotif(n)}
                    className={cn(
                      'flex w-full items-start gap-2.5 border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent/60',
                      !n.lu && 'bg-primary/5'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        n.lu ? 'bg-transparent' : 'bg-primary'
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn('text-sm leading-snug', n.lu ? 'font-medium text-foreground' : 'font-semibold text-foreground')}>
                          {n.titre}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {tempsRelatif(n.created_at)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground line-clamp-2">
                        {n.message}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Pied : historique complet */}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-primary transition-colors hover:bg-accent/60"
          >
            Voir toutes les notifications
          </Link>
        </div>
      )}
    </div>
  )
}
