'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Wand2, Send, FileText, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DiagnosticImpasse } from '@/components/planning/DiagnosticImpasse'
import type { JourNonCouvert } from '@/components/planning/types-impasse'
import type { DiagnosticImpasse as DiagnosticImpasseData } from '@/engine/diagnostic'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import type { Periode } from '@/types'

// ── Types ────────────────────────────────────────────────

interface ActionBarProps {
  periodes: Periode[]
  periodesAvecGardes: string[]
}

/** Réponse d'impasse renvoyée par /api/generate (success:false). */
interface ImpasseState {
  diagnostic: DiagnosticImpasseData | null
  joursNonCouverts: JourNonCouvert[]
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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [impasse, setImpasse] = useState<ImpasseState | null>(null)

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
        const jours: JourNonCouvert[] = data.joursNonCouverts ?? []
        setImpasse({
          diagnostic: (data.diagnostic ?? null) as DiagnosticImpasseData | null,
          joursNonCouverts: jours,
        })
        toast.error('Aucun planning possible avec les règles actuelles.')
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
      setConfirmOpen(false)
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
            <span className="flex-1 text-left truncate text-sm">
              {periodeId && periodes.find((p) => p.id === periodeId)
                ? labelPeriode(periodes.find((p) => p.id === periodeId)!)
                : <span className="text-muted-foreground">Choisir une période…</span>
              }
            </span>
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
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {generating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Wand2 className="w-4 h-4 mr-2" />
            )}
            Générer le planning
          </Button>

          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={publishing || !peutPublier}
            className="bg-accent hover:bg-accent/90 text-accent-foreground disabled:opacity-50"
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
            onClick={() => { window.location.href = `/api/export-pdf?periodeId=${periodeId}` }}
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

      {/* Diagnostic d'impasse actionnable (Lot 5) */}
      {impasse && !generating && (
        <DiagnosticImpasse
          diagnostic={impasse.diagnostic}
          joursNonCouverts={impasse.joursNonCouverts}
        />
      )}

      {/* Modale de confirmation de publication */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publier le planning ?</DialogTitle>
            <DialogDescription>
              Cette action a des conséquences immédiates pour le cabinet :
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
            <li>Tous les <strong>vétérinaires verront le planning</strong> (il ne sera plus en brouillon).</li>
            <li>Des <strong>e-mails de notification</strong> sont envoyés aux vétérinaires concernés.</li>
            <li>Le planning est <strong>synchronisé sur Google Agenda</strong>.</li>
            <li>Tu pourras toujours <strong>modifier une garde manuellement</strong> ensuite (les compteurs se mettront à jour).</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={publishing}>
              Annuler
            </Button>
            <Button
              onClick={handlePublier}
              disabled={publishing}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Confirmer la publication
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
