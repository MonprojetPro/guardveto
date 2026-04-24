'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Veterinaire } from '@/types'

interface AuthState {
  veterinaire: Veterinaire | null
  loading: boolean
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ veterinaire: null, loading: true })

  useEffect(() => {
    const supabase = createClient()

    async function fetchVeto(userId: string) {
      const { data } = await supabase
        .from('veterinaires')
        .select('*')
        .eq('user_id', userId)
        .eq('actif', true)
        .single()
      setState({ veterinaire: data as Veterinaire | null, loading: false })
    }

    // Session initiale
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        fetchVeto(session.user.id)
      } else {
        setState({ veterinaire: null, loading: false })
      }
    })

    // Écoute les changements d'auth (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        fetchVeto(session.user.id)
      } else {
        setState({ veterinaire: null, loading: false })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return state
}
