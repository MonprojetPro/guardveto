'use client'

// ============================================================
// GUARDVETO — RealtimeRefresh (Chantier B)
// ============================================================
// La page planning est un Server Component (SSR pur) : sans Realtime, il faut
// recharger la page pour voir un changement. Ce composant abonne TOUT
// utilisateur (admin ET véto) aux changements de `gardes` et `periodes` et
// déclenche un `router.refresh()` (re-fetch SSR transparent, sans flash) dès
// qu'une garde est modifiée ou qu'une période est (dé)publiée.
//
// C'est le pendant « affichage temps réel » de la re-validation : le planning
// affiché reste toujours synchrone avec la base, sans action de l'utilisateur.
// ============================================================

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const TABLES_SURVEILLEES = ['gardes', 'periodes'] as const

export function RealtimeRefresh() {
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('planning-live-refresh')

    const planifierRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => router.refresh(), 600)
    }

    for (const table of TABLES_SURVEILLEES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        planifierRefresh
      )
    }

    channel.subscribe()

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [router])

  return null
}
