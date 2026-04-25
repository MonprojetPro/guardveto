'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Wand2, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Periode } from '@/types'

// ── Types ────────────────────────────────────────────────

interface JourNonCouvert {
  date: string
  type: string
  role: string
  contrainteBloquante?: string
}

interface GenerateurPlanningProps {
  periodes: Periode[]
}

// ── Helpers ──────────────────────────────────────────────

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function labelPeriode(p: Periode) {
  const saison = p.saison === 'ete' ? 'Été' : 'Hiver'
  const num = p.numero ? ` — Période ${p.numero}` : ''
  return `${saison}${num} · ${formatDate(p.date_debut)} → ${formatDate(p.date_fin)}`
}

function statutBadge(statut: Periode['statut']) {
  if (statut === 'publie') return <Badge variant="default">Publié</Badge>
  if (statut === 'verrouille') return <Badge variant="secondary">Verrouillé</Badge>
  return <Badge variant="outline">Brouillon</Badge>
}

function labelTypeGarde(type: string) {
  if (type === 'vendredi_soir') return 'Vendredi soir'
  if (type === 'weekend') return 'Week-end'
  if (type === 'semaine_soir') return 'Soir de semaine'
  return type
}

// ── Composant ────────────────────────────────────────────

export function GenerateurPlanning({ periodes }: GenerateurPlanningProps) {
  const [periodeSelectionnee, setPeriodeSelectionnee] = useState<string>(
    periodes[0]?.id ?? ''
  )
  const [enCours, setEnCours] = useState(false)
  const [impasse, setImpasse] = useState<JourNonCouvert[] | null>(null)
  const [dernierSucces, setDernierSucces] = useState<{ nbGardes: number; dureeMs: number } | null>(null)

  const periodesFiltrees = periodes.filter((p) => p.statut !== 'verrouille')

  async function handleGenerer() {
    if (!periodeSelectionnee) {
      toast.error('Sélectionnez une période avant de générer.')
      return
    }

    setEnCours(true)
    setImpasse(null)
    setDernierSucces(null)

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId: periodeSelectionnee }),
      })

      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error ?? 'Erreur serveur. Réessayez.')
        return
      }

      if (data.success) {
        setDernierSucces({ nbGardes: data.nbGardes, dureeMs: data.dureeMs })
        toast.success(
          `Planning généré — ${data.nbGardes} gardes insérées en ${data.dureeMs}ms`
        )
      } else {
        setImpasse(data.joursNonCouverts ?? [])
        toast.error('Impasse détectée — le planning n\'a pas pu être complété.')
      }
    } catch {
      toast.error('Impossible de joindre le serveur. Vérifiez votre connexion.')
    } finally {
      setEnCours(false)
    }
  }

  if (periodesFiltrees.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Aucune période disponible pour la génération.
            Créez d'abord une période de planification.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading flex items-center gap-2 text-base">
          <Wand2 className="w-5 h-5 text-primary" />
          Générer le planning
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Sélecteur de période */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Période à générer
          </label>
          <div className="space-y-2">
            {periodesFiltrees.map((p) => (
              <label
                key={p.id}
                className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  periodeSelectionnee === p.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
              >
                <input
                  type="radio"
                  name="periode"
                  value={p.id}
                  checked={periodeSelectionnee === p.id}
                  onChange={() => setPeriodeSelectionnee(p.id)}
                  className="accent-primary"
                />
                <span className="flex-1 text-sm">{labelPeriode(p)}</span>
                {statutBadge(p.statut)}
              </label>
            ))}
          </div>
        </div>

        {/* Bouton de génération */}
        <Button
          onClick={handleGenerer}
          disabled={enCours || !periodeSelectionnee}
          className="w-full sm:w-auto"
        >
          {enCours ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Génération en cours…
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4 mr-2" />
              Générer le planning
            </>
          )}
        </Button>

        {/* Résultat : succès */}
        {dernierSucces && !enCours && (
          <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950/30">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800 dark:text-green-300">
                Planning généré avec succès
              </p>
              <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                {dernierSucces.nbGardes} gardes insérées en {dernierSucces.dureeMs}ms.
                Le planning est en statut brouillon — vérifiez avant publication.
              </p>
            </div>
          </div>
        )}

        {/* Résultat : impasse */}
        {impasse && !enCours && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive">
                  Impasse — planning incomplet
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Le moteur n'a pas trouvé de solution valide pour les créneaux ci-dessous.
                  Vérifiez les contraintes ou les congés des vétérinaires.
                </p>
              </div>
            </div>

            {impasse.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {impasse.slice(0, 20).map((j, i) => (
                  <div
                    key={i}
                    className="flex items-baseline gap-2 text-xs rounded bg-destructive/10 px-2 py-1"
                  >
                    <span className="font-medium text-destructive shrink-0">
                      {formatDate(j.date)}
                    </span>
                    <span className="text-muted-foreground">
                      {labelTypeGarde(j.type)} · {j.role === 'premier' ? '1er' : '2nd'} de garde
                    </span>
                    {j.contrainteBloquante && (
                      <span className="text-muted-foreground/70 truncate">
                        — {j.contrainteBloquante}
                      </span>
                    )}
                  </div>
                ))}
                {impasse.length > 20 && (
                  <p className="text-xs text-muted-foreground px-2">
                    … et {impasse.length - 20} autres créneaux non couverts.
                  </p>
                )}
              </div>
            )}

            {/* Suggestions d'assouplissement */}
            <div className="border-t border-destructive/20 pt-3 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Suggestions pour débloquer l'impasse :</p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/conges"
                  className="text-xs text-destructive hover:text-destructive/80 underline underline-offset-2"
                >
                  Modifier les congés des vétérinaires →
                </Link>
                <Link
                  href="/admin/veterinaires"
                  className="text-xs text-destructive hover:text-destructive/80 underline underline-offset-2"
                >
                  Réviser les contraintes individuelles →
                </Link>
                <span className="text-xs text-muted-foreground">
                  ou forcer manuellement via le calendrier
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
