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
//   • 409 needsConfirmation → règles enfreintes : on les affiche et on
//                       redemande. Le dépannage reste possible (le système
//                       INFORME, il n'interdit pas) — un mur devant quelqu'un
//                       qui rend service laisserait surtout le créneau vide.
//   • 409             → « Ce créneau a déjà été pourvu »
//   • 400 (inéligible)→ affiche la raison renvoyée par le serveur
//   • réseau / autre  → message générique
// On ne fait JAMAIS croire à un succès qui n'a pas eu lieu (règle projet).
// ============================================================

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, CheckCircle2, CircleAlert, Ban, Calendar, AlertTriangle } from 'lucide-react'
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
  /** Règles dures enfreintes : on montre, on redemande, on n'interdit pas. */
  | { kind: 'a_confirmer'; warnings: string[] }
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

  async function handlePrendre(confirmerAvertissements = false) {
    setEtat({ kind: 'loading' })
    try {
      const res = await fetch(`/api/absences/${absenceId}/volontaire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gardeId, role, confirmerAvertissements }),
      })

      const json = await res.json().catch(() => ({}))

      // 409 porte DEUX cas distincts : le créneau vient d'être pris (rien à
      // faire), ou le dépannage enfreint des règles (à confirmer). On lit donc
      // le corps AVANT de conclure — les confondre dirait « trop tard » à
      // quelqu'un qui peut encore parfaitement rendre service.
      if (res.status === 409 && json?.needsConfirmation) {
        const warnings: string[] =
          Array.isArray(json.warnings) && json.warnings.length > 0
            ? json.warnings
            : [json.error ?? 'Ce dépannage demande une confirmation.']
        setEtat({ kind: 'a_confirmer', warnings })
        return
      }
      if (res.status === 409) {
        setEtat({ kind: 'deja_pourvu' })
        return
      }

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

  // ── Règles enfreintes : on montre, et on laisse la porte ouverte ──
  // Le ton compte : la personne rend service. On ne l'accuse de rien, on lui
  // dit ce que son geste change, et le bouton principal reste « je prends ».
  if (etat.kind === 'a_confirmer') {
    return (
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="w-5 h-5" aria-hidden />
            Ce dépannage enfreint des règles
          </CardTitle>
          <CardDescription>
            Rien ne t&apos;empêche de prendre ce créneau — mais autant que tu le saches
            avant. L&apos;administrateur en sera informé.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {recap}
          <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 space-y-1.5 dark:bg-amber-950/20 dark:border-amber-900">
            {etat.warnings.map((w, i) => (
              <p key={i} className="text-xs text-foreground">{w}</p>
            ))}
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button onClick={() => handlePrendre(true)}>Je prends quand même</Button>
          <Link
            href="/planning"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Finalement non
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
        <Button onClick={() => handlePrendre()} disabled={etat.kind === 'loading'}>
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
