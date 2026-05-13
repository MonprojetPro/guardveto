'use client'

import { useState, useTransition } from 'react'
import { login, resetPassword } from './actions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Stethoscope, Calendar, Shield } from 'lucide-react'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)

    startTransition(async () => {
      const result = await login(formData)
      if (result?.error) {
        setError(result.error)
      }
    })
  }

  return (
    <div className="min-h-screen flex">

      {/* Panel de marque — desktop uniquement */}
      <div className="hidden lg:flex flex-col justify-between w-[42%] bg-primary px-14 py-12">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <Stethoscope className="w-7 h-7 text-primary-foreground/80" />
          <span className="font-heading font-bold text-primary-foreground text-xl tracking-tight">
            GuardVeto
          </span>
        </div>

        {/* Accroche centrale */}
        <div className="space-y-6">
          <h2 className="font-heading text-4xl font-bold text-primary-foreground leading-tight">
            Les gardes,<br />organisées.
          </h2>
          <p className="text-primary-foreground/75 text-base leading-relaxed max-w-xs">
            Planning des gardes vétérinaires — génération automatique, publication et suivi des compteurs.
          </p>

          <div className="space-y-3 pt-2">
            {[
              { icon: Calendar, label: "Planning mensuel en un coup d'oeil" },
              { icon: Shield, label: 'Règles de répartition respectées' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary-foreground/15 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="text-primary-foreground/80 text-sm">{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bas du panel */}
        <p className="text-primary-foreground/40 text-xs">
          Cabinet vétérinaire — accès réservé
        </p>
      </div>

      {/* Panel formulaire */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-sm">

          {/* Logo mobile uniquement */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center gap-2.5 mb-3">
              <Stethoscope className="w-6 h-6 text-primary" />
              <h1 className="font-heading text-2xl font-bold text-primary">GuardVeto</h1>
            </div>
            <p className="text-muted-foreground text-sm">
              Planning des gardes vétérinaires
            </p>
          </div>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="font-heading text-xl">Connexion</CardTitle>
              <CardDescription>
                Entrez vos identifiants pour accéder au planning.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="prenom@cabinet.fr"
                    required
                    autoComplete="email"
                    disabled={isPending}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Mot de passe</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    disabled={isPending}
                  />
                </div>

                {error && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isPending}
                >
                  {isPending ? 'Connexion en cours…' : 'Se connecter'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground mt-6">
            {resetSent ? (
              <span className="text-emerald-600">Email de réinitialisation envoyé.</span>
            ) : (
              <button
                className="underline underline-offset-2 hover:text-foreground transition-colors"
                onClick={() => {
                  const email = (document.getElementById('email') as HTMLInputElement)?.value
                  if (!email) { setError('Entrez votre email puis cliquez sur ce lien.'); return }
                  startTransition(async () => {
                    const result = await resetPassword(email)
                    if (result?.error) { setError(result.error); return }
                    setResetSent(true)
                  })
                }}
              >
                Mot de passe oublié ?
              </button>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
