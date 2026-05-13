'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Intercepte les tokens Supabase — deux modes :
// 1. Implicit flow : #access_token=...&type=... (invite via hash)
// 2. PKCE flow : session déjà en cookie (après /auth/confirm)
export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash
    const supabase = createClient()

    if (hash && hash.includes('access_token')) {
      // Mode implicit : token dans le hash
      const params = new URLSearchParams(hash.slice(1))
      const type = params.get('type')
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')

      if (!accessToken || !refreshToken) { router.replace('/login'); return }

      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) { router.replace('/login'); return }
          if (type === 'invite' || type === 'recovery') {
            window.location.href = '/set-password'
          } else {
            window.location.href = '/planning'
          }
        })
    } else {
      // Mode PKCE : session déjà en cookie (venant de /auth/confirm)
      supabase.auth.getUser().then(({ data }) => {
        if (!data.user) { router.replace('/login'); return }
        // /auth/callback n'est utilisé que pour les flows d'auth → set-password
        window.location.href = '/set-password'
      })
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Connexion en cours…</p>
    </div>
  )
}
