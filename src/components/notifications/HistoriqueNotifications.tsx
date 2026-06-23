'use client'

// ============================================================
// GUARDVETO — HistoriqueNotifications (C2)
// ============================================================
// Liste COMPLÈTE des notifications de l'utilisateur (page /notifications).
// Même logique que la cloche (Realtime + RLS + marquage lu) mais en pleine page.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck, Inbox } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  getNotifications,
  marquerLu,
  marquerToutLu,
  type NotificationItem,
  type NotificationsState,
} from '@/data/notifications'

function tempsRelatif(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  const j = Math.floor(h / 24)
  if (j < 7) return `il y a ${j} j`
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

interface HistoriqueNotificationsProps {
  initial: NotificationsState
}

export function HistoriqueNotifications({ initial }: HistoriqueNotificationsProps) {
  const router = useRouter()
  const [items, setItems] = useState<NotificationItem[]>(initial.items)
  const [nbNonLues, setNbNonLues] = useState<number>(initial.nbNonLues)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refetch = useCallback(async () => {
    try {
      const etat = await getNotifications(100)
      setItems(etat.items)
      setNbNonLues(etat.nbNonLues)
    } catch {
      // best-effort
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('notifications-historique')
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications' },
      () => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(refetch, 500)
      }
    )
    channel.subscribe()
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [refetch])

  async function ouvrirNotif(n: NotificationItem) {
    if (!n.lu) {
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

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-16 text-center">
        <Inbox className="h-9 w-9 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">Vous n'avez aucune notification pour le moment.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {nbNonLues > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={toutMarquerLu}
            className="flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary/80"
          >
            <CheckCheck className="h-4 w-4" />
            Tout marquer comme lu
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => ouvrirNotif(n)}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent/60',
                n.lu ? 'border-border bg-card' : 'border-primary/30 bg-primary/5'
              )}
            >
              <span
                className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.lu ? 'bg-transparent' : 'bg-primary')}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={cn('text-sm', n.lu ? 'font-medium' : 'font-semibold', 'text-foreground')}>
                    {n.titre}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{tempsRelatif(n.created_at)}</span>
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{n.message}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
