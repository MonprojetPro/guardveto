'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [debugEmail, setDebugEmail] = useState<string>('chargement...')
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      setDebugEmail(data.user?.email ?? 'aucun utilisateur trouvé')
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

      // Définit le mot de passe
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) { setError(updateError.message); return }

      // Récupère l'utilisateur pour retrouver sa fiche véto et lever invite_pending
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('veterinaires')
          .update({ invite_pending: false })
          .eq('user_id', user.id)
      }

      // Rechargement complet pour que le serveur lise les nouveaux cookies de session
      window.location.href = '/planning'
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="font-heading text-2xl font-bold text-foreground">Bienvenue sur GuardVeto</h1>
          <p className="text-sm text-muted-foreground">Créez votre mot de passe pour accéder à votre compte</p>
          <p className="text-xs font-mono bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
            DEBUG session : {debugEmail}
          </p>
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
            {isPending ? 'Enregistrement...' : 'Créer mon compte'}
          </Button>
        </form>
      </div>
    </div>
  )
}
