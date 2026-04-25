'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Wand2, Send, FileText, LayoutGrid, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Periode } from '@/types'

// ── Types ────────────────────────────────────────────────

interface ActionBarProps {
  periodes: Periode[]
  periodesAvecGardes: string[]
}

interface JourNonCouvert {
  date: string
  type: string
  role: string
  contrainteBloquante?: string
}

// ── Helpers ──────────────────────────────────────────────

function labelPeriode(p: Periode) {
  const saison = p.saison === 'ete' ? 'Été' : 'Hiver'
  const num = p.numero ? ` P${p.numero}` : ''
  const debut = new Date(p.date_debut + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  })
  const fin = new Date(p.date_fin + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
  return `${saison}${num} · ${debut} → ${fin}`
}

function StatutBadge({ statut }: { statut: Periode['statut'] }) {
  if (statut === 'publie')
    return (
      <Badge className="bg-green-100 text-green-800 border border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800">
        Publié
      </Badge>
    )
  if (statut === 'verrouille') return <Badge variant="secondary">Verrouillé</Badge>
  return <Badge variant="outline">Brouillon</Badge>
}

// ── Composant ────────────────────────────────────────────

export function ActionBar({ periodes, periodesAvecGardes }: ActionBarProps) {
  const router = useRouter()
  const [periodeId, setPeriodeId] = useState<string>(periodes[0]?.id ?? '')
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [impasse, setImpasse] = useState<JourNonCouvert[] | null>(null)

  const periodeSelectionnee = periodes.find((p) => p.id === periodeId) ?? null
  const aDesGardes = periodesAvecGardes.includes(periodeId)
  const peutPublier = aDesGardes && periodeSelectionnee?.statut === 'brouillon'

  async function handleGenerer() {
    if (!periodeId) return
    setGenerating(true)
    setImpasse(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erreur lors de la génération.')
        return
      }
      if (data.success) {
        toast.success(`${data.nbGardes} gardes générées en ${data.dureeMs}ms`)
        router.refresh()
      } else {
        setImpasse(data.joursNonCouverts ?? [])
        toast.error(`Impasse — ${data.joursNonCouverts?.length ?? 0} créneaux non couverts`)
      }
    } catch {
      toast.error('Impossible de joindre le serveur.')
    } finally {
      setGenerating(false)
    }
  }

  async function handlePublier() {
    if (!periodeId) return
    setPublishing(true)
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erreur lors de la publication.')
        return
      }
      toast.success('Planning publié — les vétérinaires peuvent y accéder.')
      router.refresh()
    } catch {
      toast.error('Impossible de joindre le serveur.')
    } finally {
      setPublishing(false)
    }
  }

  if (periodes.length === 0) return null

  return (
    <div className="space-y-3">
      {/* Barre principale */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
        {/* Sélecteur de période */}
        <Select value={periodeId} onValueChange={(v) => { if (v) { setPeriodeId(v); setImpasse(null) } }}>
          <SelectTrigger className="w-[300px]">
            <SelectValue placeholder="Choisir une période…" />
          </SelectTrigger>
          <SelectContent>
            {periodes.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {labelPeriode(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Badge statut */}
        {periodeSelectionnee && (
          <StatutBadge statut={periodeSelectionnee.statut} />
        )}

        <div className="flex-1" />

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            onClick={handleGenerer}
            disabled={generating || !periodeId}
            className="bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4 mr-2" />
            )}
            Générer le planning
          </Button>

          <Button
            onClick={handlePublier}
            disabled={publishing || !peutPublier}
            className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
          >
            {publishing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            Publier
          </Button>

          <Button
            variant="outline"
            disabled={!aDesGardes}
            onClick={() => window.open(`/export-pdf?periodeId=${periodeId}`, '_blank')}
          >
            <FileText className="w-4 h-4 mr-2" />
            Exporter PDF
          </Button>

          <a
            href="/admin/periodes"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
          >
            <LayoutGrid className="w-4 h-4" />
            Périodes
          </a>
        </div>
      </div>

      {/* Rapport d'impasse */}
      {impasse && !generating && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-destructive">
                Impasse — planning incomplet
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Le moteur n'a pas trouvé de solution valide pour{' '}
                {impasse.length} créneau{impasse.length > 1 ? 'x' : ''}.
                Vérifiez les contraintes ou les congés des vétérinaires.
              </p>
            </div>
          </div>
          {impasse.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {impasse.slice(0, 20).map((j, i) => (
                <div
                  key={i}
                  className="flex items-baseline gap-2 text-xs rounded bg-destructive/10 px-2 py-1"
                >
                  <span className="font-medium text-destructive shrink-0">
                    {new Date(j.date + 'T12:00:00Z').toLocaleDateString('fr-FR', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className="text-muted-foreground">
                    {j.role === 'premier' ? '1er' : '2nd'} de garde
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
        </div>
      )}
    </div>
  )
}
