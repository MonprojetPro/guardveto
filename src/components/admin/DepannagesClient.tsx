'use client'

import { useState, useTransition } from 'react'
import { Check, X, LifeBuoy } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { changerStatutCompensation } from '@/app/(protected)/admin/depannages/actions'
import type { StatutCompensation, RoleCompensation, TypeGarde } from '@/types'

/** Ligne aplatie (jointures résolues côté serveur) consommée par l'écran. */
export interface CompensationLigne {
  id: string
  statut: StatutCompensation
  role: RoleCompensation | null
  gardeDate: string | null
  gardeType: TypeGarde | null
  remplacantPrenom: string | null
  remplacePrenom: string | null
  absenceMotif: 'maladie' | 'urgence' | 'autre' | null
  absenceDateDebut: string | null
}

interface DepannagesClientProps {
  lignes: CompensationLigne[]
  stats: { ouvertes: number; compensees: number }
}

const TYPE_GARDE_LABELS: Record<TypeGarde, string> = {
  semaine: 'Soir semaine',
  weekend: 'Week-end',
  ferie: 'Férié',
}

const ROLE_LABELS: Record<RoleCompensation, string> = {
  premier: '1er',
  second: '2nd',
}

const MOTIF_LABELS: Record<'maladie' | 'urgence' | 'autre', string> = {
  maladie: 'Maladie',
  urgence: 'Urgence',
  autre: 'Autre',
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  })
}

function StatutBadge({ statut }: { statut: StatutCompensation }) {
  if (statut === 'compensee')
    return <Badge className="bg-green-100 text-green-800 border border-green-200">Compensée</Badge>
  if (statut === 'annulee')
    return <Badge variant="secondary">Annulée</Badge>
  return <Badge className="bg-amber-100 text-amber-800 border border-amber-200">À compenser</Badge>
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
      <LifeBuoy className="w-10 h-10 opacity-30" />
      <p className="text-sm">Aucun dépannage enregistré.</p>
      <p className="text-xs">Les compensations apparaîtront ici dès qu'un véto en dépanne un autre.</p>
    </div>
  )
}

export function DepannagesClient({ lignes, stats }: DepannagesClientProps) {
  const [isPending, startTransition] = useTransition()
  const [enCours, setEnCours] = useState<string | null>(null)

  function muter(id: string, nouveauStatut: StatutCompensation) {
    setEnCours(id)
    startTransition(async () => {
      await changerStatutCompensation(id, nouveauStatut)
      setEnCours(null)
    })
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">Dépannages</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Qui a dépanné qui, et où en sont les compensations
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Dettes ouvertes', value: stats.ouvertes,   color: 'text-amber-600' },
          { label: 'Compensées',      value: stats.compensees,  color: 'text-green-600' },
          { label: 'Total',           value: lignes.length,     color: 'text-foreground' },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tableau */}
      {lignes.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <EmptyState />
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Créneau</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Rôle</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Absent</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">A dépanné</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Motif</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Statut</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {lignes.map((l) => {
                const busy = isPending && enCours === l.id
                return (
                  <tr key={l.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium whitespace-nowrap">{formatDate(l.gardeDate)}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {l.gardeType ? TYPE_GARDE_LABELS[l.gardeType] : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.role ? ROLE_LABELS[l.role] : '—'}
                    </td>
                    <td className="px-4 py-3">{l.remplacePrenom ?? '—'}</td>
                    <td className="px-4 py-3 font-medium">{l.remplacantPrenom ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.absenceMotif ? MOTIF_LABELS[l.absenceMotif] : '—'}
                    </td>
                    <td className="px-4 py-3"><StatutBadge statut={l.statut} /></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        {l.statut === 'a_compenser' && (
                          <Button
                            variant="ghost" size="sm"
                            className="h-8 text-emerald-600 hover:text-emerald-600 hover:bg-emerald-50"
                            onClick={() => muter(l.id, 'compensee')}
                            disabled={busy}
                            title="Marquer compensé"
                          >
                            <Check className="w-3.5 h-3.5 mr-1" />
                            Compensé
                          </Button>
                        )}
                        {l.statut !== 'annulee' && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => muter(l.id, 'annulee')}
                            disabled={busy}
                            title="Annuler"
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {l.statut === 'annulee' && (
                          <Button
                            variant="ghost" size="sm"
                            className="h-8 text-muted-foreground"
                            onClick={() => muter(l.id, 'a_compenser')}
                            disabled={busy}
                            title="Rouvrir la dette"
                          >
                            Rouvrir
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <a href="/planning" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-block">
        ← Retour au planning
      </a>
    </div>
  )
}
