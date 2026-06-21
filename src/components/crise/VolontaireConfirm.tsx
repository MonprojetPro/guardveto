'use client'

// ============================================================
// GUARDVETO — VolontaireConfirm (Gestion de crise — LOT 4)
// ============================================================
// Page de confirmation côté véto (cible du lien email « Je prends ce créneau »).
// Affiche le créneau concerné et un bouton qui POST l'endpoint
//   POST /api/absences/[id]/volontaire  avec { gardeId, role }.
//
// L'endpoint revalide TOUT côté serveur (auth + cabinet + éligibilité + anti-
// collision) : un lien forwardé ne contourne aucun contrôle. Cette UI se contente
// d'envoyer la demande et de traduire HONNÊTEMENT la réponse :
//   • succès          → « C'est noté, merci ! »
//   • 409             → « Ce créneau a déjà été pourvu »
//   • 400 (inéligible)→ affiche la raison renvoyée par le serveur
//   • réseau / autre  → message générique
// On ne fait JAMAIS croire à un succès qui n'a pas eu lieu (règle projet).
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, CheckCircle2, CircleAlert, Ban, Calendar } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import type { RoleGarde } from '@/engine/types'

type Etat =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'succes' }
  | { kind: 'deja_pourvu' }
  | { kind: 'refus'; message: string }
  | { kind: 'erreur'; message: string }

interface VolontaireConfirmProps {
  absenceId: string
  gardeId: string
  role: RoleGarde
  /** Libellés pré-formatés FR (calculés côté serveur). */
  dateLabel: string
  typeLabel: string
  roleLabel: string
}

export function VolontaireConfirm({
  absenceId,
  gardeId,
  role,
  dateLabel,
  typeLabel,
  roleLabel,
}: VolontaireConfirmProps) {
  const [etat, setEtat] = useState<Etat>({ kind: 'idle' })

  async function handlePrendre() {
    setEtat({ kind: 'loading' })
    try {
      const res = await fetch(`/api/absences/${absenceId}/volontaire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gardeId, role }),
      })

      // 409 = créneau déjà pourvu / absence déjà résolue (anti-collision serveur).
      if (res.status === 409) {
        setEtat({ kind: 'deja_pourvu' })
        return
      }

      const json = await res.json().catch(() => ({}))

      // 400 / 422 = non éligible ou état invalide → on affiche la raison serveur.
      if (!res.ok) {
        const message =
          typeof json?.error === 'string' && json.error.length > 0
            ? json.error
            : "Vous ne pouvez pas prendre ce créneau."
        setEtat({ kind: 'refus', message })
        return
      }

      setEtat({ kind: 'succes' })
    } catch {
      setEtat({
        kind: 'erreur',
        message: 'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.',
      })
    }
  }

  // ── Bandeau récap du créneau (toujours affiché) ────────────
  const recap = (
    <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Calendar className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
        <span className="capitalize">{dateLabel}</span>
      </div>
      <p className="text-xs text-muted-foreground pl-6">
        {typeLabel} · {roleLabel}
      </p>
    </div>
  )

  // ── États terminaux ───────────────────────────────────────
  if (etat.kind === 'succes') {
    return (
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 className="w-5 h-5" aria-hidden />
            C&apos;est noté, merci !
          </CardTitle>
          <CardDescription>
            Vous êtes désormais affecté·e à cette garde. Elle apparaît dans votre planning
            et a été synchronisée avec votre agenda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{recap}</CardContent>
        <CardFooter>
          <Link href="/planning" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Voir mon planning
          </Link>
        </CardFooter>
      </Card>
    )
  }

  if (etat.kind === 'deja_pourvu') {
    return (
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-600">
            <CircleAlert className="w-5 h-5" aria-hidden />
            Ce créneau a déjà été pourvu
          </CardTitle>
          <CardDescription>
            Un·e autre vétérinaire a pris cette garde avant vous (ou elle a été réattribuée
            par l&apos;administrateur). Merci d&apos;avoir répondu à l&apos;appel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{recap}</CardContent>
        <CardFooter>
          <Link href="/planning" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Voir mon planning
          </Link>
        </CardFooter>
      </Card>
    )
  }

  if (etat.kind === 'refus') {
    return (
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Ban className="w-5 h-5" aria-hidden />
            Vous ne pouvez pas prendre ce créneau
          </CardTitle>
          <CardDescription>{etat.message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">{recap}</CardContent>
        <CardFooter>
          <Link href="/planning" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Retour au planning
          </Link>
        </CardFooter>
      </Card>
    )
  }

  // ── État initial (idle / loading / erreur réseau) ─────────
  return (
    <Card className="max-w-md w-full">
      <CardHeader>
        <CardTitle>Veux-tu prendre ce créneau ?</CardTitle>
        <CardDescription>
          Une garde cherche un remplaçant suite à une absence. Vous êtes éligible pour la
          couvrir. Le premier qui se déclare emporte le créneau.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {recap}

        {etat.kind === 'erreur' && (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <CircleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
            <span>{etat.message}</span>
          </p>
        )}
      </CardContent>

      <CardFooter className="gap-2">
        <Button onClick={handlePrendre} disabled={etat.kind === 'loading'}>
          {etat.kind === 'loading' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Enregistrement…
            </>
          ) : (
            'Oui, je prends ce créneau'
          )}
        </Button>
        <Link
          href="/planning"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          aria-disabled={etat.kind === 'loading'}
        >
          Pas maintenant
        </Link>
      </CardFooter>
    </Card>
  )
}
