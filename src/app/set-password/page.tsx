'use client'

import { useState, useTransition, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const supabase = createClient()
    const hash = window.location.hash

    // Cas 1 : hash avec access_token (reset direct ou fallback)
    if (hash && hash.includes('access_token')) {
      const params = new URLSearchParams(hash.slice(1))
      const access_token = params.get('access_token') ?? ''
      const refresh_token = params.get('refresh_token') ?? ''

      if (access_token && refresh_token) {
        supabase.auth.setSession({ access_token, refresh_token }).then(({ error: err }) => {
          if (err) {
            window.location.href = '/login?error=' + encodeURIComponent(err.message)
            return
          }
          // Nettoie le hash de l'URL
          window.history.replaceState({}, '', window.location.pathname)
          setReady(true)
        })
        return
      }
    }

    // Cas 2 : session déjà en cookie (venant de /auth/callback ou /auth/confirm)
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        window.location.href = '/login'
        return
      }
      setReady(true)
    })
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.')
      return
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }

    startTransition(async () => {
      const supabase = createClient()

      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) { setError(updateError.message); return }

      // invite_pending est mis à jour côté serveur via RPC SECURITY DEFINER :
      // la RLS de `veterinaires` réserve l'UPDATE aux admins, donc un véto ne
      // peut pas modifier sa fiche directement (la fonction borne sur auth.uid()).
      await supabase.rpc('marquer_invite_complete')

      window.location.href = '/planning'
    })
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Connexion en cours…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="font-heading text-2xl font-bold text-foreground">Définir mon mot de passe</h1>
          <p className="text-sm text-muted-foreground">Choisissez un mot de passe pour accéder à GuardVeto</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8 caractères minimum"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirmer le mot de passe</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Répétez le mot de passe"
              required
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending ? 'Enregistrement...' : 'Valider le mot de passe'}
          </Button>
        </form>
      </div>
    </div>
  )
}
