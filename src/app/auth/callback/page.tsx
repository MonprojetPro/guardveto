'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Intercepte les hash fragments Supabase (#access_token=...&type=...)
// Fonctionne pour les flows invite et recovery (implicit flow)
export default function AuthCallbackPage() {
  const router = useRouter()

  useEffect(() => {
    const hash = window.location.hash
    if (!hash) { router.replace('/login'); return }

    const params = new URLSearchParams(hash.slice(1))
    const type = params.get('type')
    const accessToken = params.get('access_token')
    const refreshToken = params.get('refresh_token')

    if (!accessToken || !refreshToken) { router.replace('/login'); return }

    const supabase = createClient()

    supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) { router.replace('/login'); return }
        if (type === 'invite' || type === 'recovery') {
          window.location.href = '/set-password'
        } else {
          window.location.href = '/planning'
        }
      })
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Connexion en cours…</p>
    </div>
  )
}
