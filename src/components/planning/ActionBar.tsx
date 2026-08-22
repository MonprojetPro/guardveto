'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Wand2, Send, FileText, LayoutGrid, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DiagnosticImpasse } from '@/components/planning/DiagnosticImpasse'
import { CreneauxIgnoresAlert } from '@/components/planning/CreneauxIgnoresAlert'
import { PreVolAlert } from '@/components/planning/PreVolAlert'
import type { AvertissementPreVol } from '@/engine/pre-vol'
import { CriseModal, type VetCrise } from '@/components/planning/CriseModal'
import type { CreneauIgnore } from '@/engine/creneau-modele'
import type { JourNonCouvert } from '@/components/planning/types-impasse'
import type { DiagnosticImpasse as DiagnosticImpasseData } from '@/engine/diagnostic'
import { CartesViolations } from '@/components/planning/CartesViolations'
import type { ViolationRevalidation } from '@/components/planning/types-revalidation'
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
  /** Vétos actifs du cabinet — pour le signalement d'absence (gestion de crise). */
  vets: VetCrise[]
}

/** Réponse d'impasse renvoyée par /api/generate (success:false). */
interface ImpasseState {
  diagnostic: DiagnosticImpasseData | null
  joursNonCouverts: JourNonCouvert[]
}

/** Réserves renvoyées par le gate de /api/publish (requiresConfirmation). */
interface ReservesPublication {
  violations: ViolationRevalidation[]
  souhaitsEnAttente: number
}

/** Résultat du pré-vol (backlog n°23 + n°24) — GET /api/generate/pre-vol. */
interface PreVolState {
  avertissements: AvertissementPreVol[]
  souhaitsEnAttente: number
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

export function ActionBar({ periodes, periodesAvecGardes, vets }: ActionBarProps) {
  const router = useRouter()
  const [periodeId, setPeriodeId] = useState<string>(periodes[0]?.id ?? '')
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [republishOpen, setRepublishOpen] = useState(false)
  const [reserves, setReserves] = useState<ReservesPublication | null>(null)
  const [impasse, setImpasse] = useState<ImpasseState | null>(null)
  // Créneaux du catalogue ignorés par le moteur (backlog n°4, tranche 1) —
  // affichés APRÈS la génération, succès comme impasse (fin du silence).
  const [creneauxIgnores, setCreneauxIgnores] = useState<CreneauIgnore[]>([])
  const [criseOpen, setCriseOpen] = useState(false)
  // Pré-vol (backlog n°23 + n°24) : avertissements de cohérence des règles +
  // souhaits de congé en attente — affichés AVANT le clic « Générer ».
  // Le résultat est CLÉ sur sa période : changer de période invalide l'affichage
  // sans setState synchrone dans l'effet (règle react-hooks/set-state-in-effect).
  const [preVol, setPreVol] = useState<(PreVolState & { periodeId: string }) | null>(null)
  // Bumpé après chaque génération : les règles/congés ont pu changer entre-temps
  // (assouplissement via le diagnostic, congé traité dans un autre onglet…).
  const [preVolVersion, setPreVolVersion] = useState(0)

  // Charge le pré-vol dès qu'une période est sélectionnée (best-effort : un
  // échec réseau laisse simplement l'écran sans avertissement — jamais bloquant).
  useEffect(() => {
    if (!periodeId) return
    let annule = false
    fetch(`/api/generate/pre-vol?periodeId=${encodeURIComponent(periodeId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (annule || !data) return
        setPreVol({
          periodeId,
          avertissements: (data.avertissements ?? []) as AvertissementPreVol[],
          souhaitsEnAttente: typeof data.souhaitsEnAttente === 'number' ? data.souhaitsEnAttente : 0,
        })
      })
      .catch(() => { /* silencieux — le pré-vol ne bloque jamais */ })
    return () => { annule = true }
  }, [periodeId, preVolVersion])

  // Seul le pré-vol de la période AFFICHÉE est montré (l'ancien devient inerte).
  const preVolActuel = preVol && preVol.periodeId === periodeId ? preVol : null

  const periodeSelectionnee = periodes.find((p) => p.id === periodeId) ?? null
  const aDesGardes = periodesAvecGardes.includes(periodeId)
  const peutPublier = aDesGardes && periodeSelectionnee?.statut === 'brouillon'

  // Clic « Générer » : si la période est publiée, on demande confirmation AVANT
  // d'écraser le planning publié (garde-fou Chantier B). Sinon on génère direct.
  function handleGenerer() {
    if (!periodeId) return
    if (periodeSelectionnee?.statut === 'publie') {
      setRepublishOpen(true)
      return
    }
    void lancerGeneration(false)
  }

  async function lancerGeneration(confirmRepublication: boolean) {
    if (!periodeId) return
    setGenerating(true)
    setImpasse(null)
    setCreneauxIgnores([])
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId, confirmRepublication }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erreur lors de la génération.')
        return
      }
      // Filet de sécurité serveur : période publiée sans confirmation → dialogue.
      if (data.requiresConfirmation) {
        setRepublishOpen(true)
        return
      }
      setCreneauxIgnores((data.creneauxIgnores ?? []) as CreneauIgnore[])
      if (data.success) {
        setRepublishOpen(false)
        toast.success(`${data.nbGardes} gardes générées en ${data.dureeMs}ms`)
        router.refresh()
      } else if (data.interrompu) {
        // Coupe propre du backtracking (calcul trop long) — PAS une impasse
        // prouvée : message dédié, on n'affiche pas de diagnostic (il n'y en a pas).
        setImpasse(null)
        toast.error(data.error ?? 'Génération interrompue : le planning est trop contraint (calcul trop long).')
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
      // Re-vérifie le pré-vol : les règles/congés ont pu changer depuis la sélection.
      setPreVolVersion((v) => v + 1)
    }
  }

  async function handlePublier(confirmAvecReserves = false) {
    if (!periodeId) return
    setPublishing(true)
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId, confirmAvecReserves }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erreur lors de la publication.')
        return
      }
      // Gate serveur : violations dures ou souhaits de congé en attente →
      // on montre les réserves et on demande une confirmation explicite.
      if (data.requiresConfirmation) {
        setConfirmOpen(false)
        setReserves({
          violations: data.violations ?? [],
          souhaitsEnAttente: data.souhaitsEnAttente ?? 0,
        })
        return
      }
      toast.success('Planning publié — les vétérinaires peuvent y accéder.')
      setConfirmOpen(false)
      setReserves(null)
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
        <Select value={periodeId} onValueChange={(v) => { if (v) { setPeriodeId(v); setImpasse(null); setCreneauxIgnores([]) } }}>
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

          <Button
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30"
            onClick={() => setCriseOpen(true)}
          >
            <AlertTriangle className="w-4 h-4 mr-2" />
            Signaler une absence
          </Button>

          <a
            href="/historique"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted"
          >
            <LayoutGrid className="w-4 h-4" />
            Périodes
          </a>
        </div>
      </div>

      {/* Pré-vol (backlog n°23 + n°24) : congés en attente + cohérence des
          règles — AVANT le clic « Générer ». Rien détecté → rien d'affiché. */}
      {preVolActuel && !generating && (
        <PreVolAlert
          avertissements={preVolActuel.avertissements}
          souhaitsEnAttente={preVolActuel.souhaitsEnAttente}
        />
      )}

      {/* Créneaux du catalogue ignorés par le moteur (backlog n°4, tranche 1) */}
      {!generating && <CreneauxIgnoresAlert creneaux={creneauxIgnores} />}

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
              onClick={() => handlePublier(false)}
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

      {/* Modale des RÉSERVES de publication (gate serveur) */}
      <Dialog open={reserves !== null} onOpenChange={(o) => { if (!publishing && !o) setReserves(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Des points méritent ton attention avant de publier</DialogTitle>
            <DialogDescription>
              La vérification automatique du planning a relevé :
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {reserves && reserves.violations.length > 0 && (
              <CartesViolations violations={reserves.violations} />
            )}
            {reserves && reserves.souhaitsEnAttente > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-amber-800 dark:text-amber-300">
                <span className="font-medium">{reserves.souhaitsEnAttente} demande{reserves.souhaitsEnAttente > 1 ? 's' : ''} de congé en attente</span>{' '}
                chevauche{reserves.souhaitsEnAttente > 1 ? 'nt' : ''} cette période — valide-la/les ou refuse-la/les d'abord si tu veux qu'elle{reserves.souhaitsEnAttente > 1 ? 's' : ''} soi{reserves.souhaitsEnAttente > 1 ? 'ent' : 't'} prise{reserves.souhaitsEnAttente > 1 ? 's' : ''} en compte.
              </div>
            )}
            <p className="text-muted-foreground">
              Tu peux corriger d'abord, ou publier quand même en connaissance de cause.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReserves(null)} disabled={publishing}>
              Corriger d'abord
            </Button>
            <Button
              onClick={() => handlePublier(true)}
              disabled={publishing}
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
            >
              {publishing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Publier quand même
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modale de confirmation de RÉGÉNÉRATION d'une période publiée (Chantier B) */}
      <Dialog open={republishOpen} onOpenChange={(o) => { if (!generating) setRepublishOpen(o) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Régénérer un planning publié ?</DialogTitle>
            <DialogDescription>
              Cette période est <strong>publiée</strong>. La régénérer va l’écraser :
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-5">
            <li>Le planning actuel est <strong>remplacé</strong> (sauf les gardes verrouillées).</li>
            <li>La période <strong>repasse en brouillon</strong> : les vétérinaires ne la verront plus tant qu’elle n’est pas republiée.</li>
            <li>Les <strong>événements Google Agenda</strong> de la période sont supprimés puis recréés à la republication.</li>
            <li>Republier <strong>renvoie des e-mails</strong> de notification aux vétérinaires.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepublishOpen(false)} disabled={generating}>
              Annuler
            </Button>
            <Button
              onClick={() => lancerGeneration(true)}
              disabled={generating}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4 mr-2" />
              )}
              Régénérer quand même
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modale de gestion de crise — signaler une absence + réparer (Lot 5) */}
      <CriseModal open={criseOpen} onOpenChange={setCriseOpen} vets={vets} />
    </div>
  )
}
