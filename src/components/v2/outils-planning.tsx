'use client'

// ============================================================
// GUARDVETO V2 — Les outils du planning (pilules d'en-tête)
// ============================================================
// Reprend INTÉGRALEMENT les garde-fous de l'`ActionBar` V1 (pré-vol,
// diagnostic d'impasse, créneaux ignorés, confirmation de publication,
// réserves du gate serveur, confirmation de régénération d'une période
// publiée) — ce sont des règles métier, pas du décor : on ne les
// réécrit pas pour un changement d'habillage.
//
// Ce qui change, c'est UNIQUEMENT la mise en scène, conforme à
// `maquette/m1-planning.html` (ligne 1826) :
//
//   • la période vient de la PILULE V2 (donc du mois affiché) — l'ActionBar
//     V1 embarquait son propre `<Select>` de période et son propre badge de
//     statut, ce qui donnait deux sélecteurs affichant deux périodes
//     différentes avec deux statuts contradictoires ;
//   • les boutons sont des pilules `head-btn`, pas des boutons shadcn
//     rectangulaires maquillés au CSS ;
//   • les bandeaux d'alerte descendent dans le corps de la page, au-dessus
//     de la grille — dans l'ActionBar ils étaient coincés dans la barre
//     d'en-tête, qu'ils faisaient gonfler à trois étages.
//
// D'où la forme en HOOK plutôt qu'en composant : `PlanningV2` récupère les
// trois morceaux (pilules / alertes / modales) et les pose chacun au bon
// endroit de la page, tout en gardant un seul état partagé.
// ============================================================

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Send, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DiagnosticImpasse } from '@/components/planning/DiagnosticImpasse'
import { CreneauxIgnoresAlert } from '@/components/planning/CreneauxIgnoresAlert'
import { PreVolAlert } from '@/components/planning/PreVolAlert'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import type { AvertissementPreVol } from '@/engine/pre-vol'
import type { CreneauIgnore } from '@/engine/creneau-modele'
import type { JourNonCouvert } from '@/components/planning/types-impasse'
import type { DiagnosticImpasse as DiagnosticImpasseData } from '@/engine/diagnostic'
import type { ViolationRevalidation } from '@/components/planning/types-revalidation'
import type { Periode } from '@/types'

// ── Types ────────────────────────────────────────────────

interface OptionsOutils {
  /** Période dont relève le mois affiché — la SEULE source de vérité. */
  periode: Periode | null
  /** La période affichée a-t-elle déjà des gardes ? (PDF, publication) */
  aDesGardes: boolean
  isAdmin: boolean
  /** Ouvre la modale de signalement d'absence, portée par `PlanningV2`. */
  onSignalerAbsence: () => void
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

// ── Hook ─────────────────────────────────────────────────

export function useOutilsPlanning({
  periode,
  aDesGardes,
  isAdmin,
  onSignalerAbsence,
}: OptionsOutils) {
  const router = useRouter()
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [republishOpen, setRepublishOpen] = useState(false)
  const [reserves, setReserves] = useState<ReservesPublication | null>(null)
  const [impasse, setImpasse] = useState<ImpasseState | null>(null)
  // Créneaux du catalogue ignorés par le moteur (backlog n°4, tranche 1) —
  // affichés APRÈS la génération, succès comme impasse (fin du silence).
  const [creneauxIgnores, setCreneauxIgnores] = useState<CreneauIgnore[]>([])
  // Pré-vol (backlog n°23 + n°24) : congés en attente + cohérence des règles,
  // AVANT le clic « Générer ». Le résultat est CLÉ sur sa période : changer de
  // mois invalide l'affichage sans setState synchrone dans l'effet.
  const [preVol, setPreVol] = useState<(PreVolState & { periodeId: string }) | null>(null)
  // Bumpé après chaque génération : les règles/congés ont pu changer entre-temps
  // (assouplissement via le diagnostic, congé traité dans un autre onglet…).
  const [preVolVersion, setPreVolVersion] = useState(0)

  const periodeId = periode?.id ?? ''

  // Charge le pré-vol dès qu'une période est affichée (best-effort : un échec
  // réseau laisse simplement l'écran sans avertissement — jamais bloquant).
  useEffect(() => {
    if (!periodeId || !isAdmin) return
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
  }, [periodeId, isAdmin, preVolVersion])

  // Changer de mois peut changer de période : les résultats de la précédente
  // (impasse, créneaux ignorés) ne la concernent plus.
  useEffect(() => {
    setImpasse(null)
    setCreneauxIgnores([])
  }, [periodeId])

  // Seul le pré-vol de la période AFFICHÉE est montré (l'ancien devient inerte).
  const preVolActuel = preVol && preVol.periodeId === periodeId ? preVol : null

  const peutPublier = aDesGardes && periode?.statut === 'brouillon'

  // Clic « Générer » : si la période est publiée, on demande confirmation AVANT
  // d'écraser le planning publié (garde-fou Chantier B). Sinon on génère direct.
  function handleGenerer() {
    if (!periodeId) return
    if (periode?.statut === 'publie') {
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
      // Re-vérifie le pré-vol : les règles/congés ont pu changer depuis l'affichage.
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

  // ── Les pilules, dans l'ordre de la maquette ───────────
  // Compteurs (rendu par PlanningV2) · PDF · Absence · Générer · [Publier]
  // Le bouton principal ferme la ligne : c'est lui qui porte l'accent.

  const pilules = (
    <>
      <button
        type="button"
        className="head-btn ghost"
        disabled={!aDesGardes}
        title="Exporter le planning de la période en PDF"
        onClick={() => {
          if (periodeId) window.location.href = `/api/export-pdf?periodeId=${periodeId}`
        }}
      >
        🖨 PDF
      </button>

      {isAdmin && (
        <>
          <button
            type="button"
            className="head-btn"
            title="Signaler l’absence d’un vétérinaire et réparer le planning"
            onClick={onSignalerAbsence}
          >
            Absence
          </button>

          <button
            type="button"
            className="head-btn"
            disabled={generating || !periodeId}
            onClick={handleGenerer}
          >
            {generating ? 'Génération…' : 'Générer'}
          </button>

          <button
            type="button"
            className="head-btn primary"
            disabled={publishing || !peutPublier}
            title={
              periode?.statut === 'publie'
                ? 'Cette période est déjà publiée'
                : !aDesGardes
                  ? 'Génère d’abord le planning'
                  : 'Publier le planning auprès de l’équipe'
            }
            onClick={() => setConfirmOpen(true)}
          >
            {publishing ? 'Publication…' : periode?.statut === 'publie' ? 'Publiée' : 'Publier'}
          </button>
        </>
      )}
    </>
  )

  // ── Les bandeaux, au-dessus de la grille ───────────────

  const alertes = isAdmin ? (
    <>
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
    </>
  ) : null

  // ── Les modales de garde-fou ───────────────────────────

  const modales = isAdmin ? (
    <>
      {/* Modale de confirmation de publication */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="gv-modale">
          <DialogHeader>
            <p className="gm-kicker">Planning · publication</p>
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
        <DialogContent className="gv-modale">
          <DialogHeader>
            <p className="gm-kicker">Planning · réserves</p>
            <DialogTitle>Des points méritent ton attention</DialogTitle>
            <DialogDescription>
              La vérification automatique du planning a relevé :
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {reserves && reserves.violations.length > 0 && (
              <div className="gf-card dure">
                <p className="gf-title">
                  {reserves.violations.length} règle{reserves.violations.length > 1 ? 's' : ''} non respectée{reserves.violations.length > 1 ? 's' : ''} :
                </p>
                <ul className="space-y-1 list-disc pl-5">
                  {reserves.violations.slice(0, 6).map((v, i) => (
                    <li key={i}>
                      <span className="font-medium">{v.date}</span> — {v.detail}
                    </li>
                  ))}
                  {reserves.violations.length > 6 && (
                    <li className="list-none opacity-80">
                      … et {reserves.violations.length - 6} autre{reserves.violations.length - 6 > 1 ? 's' : ''}.
                    </li>
                  )}
                </ul>
              </div>
            )}
            {reserves && reserves.souhaitsEnAttente > 0 && (
              <div className="gf-card souple">
                <span className="font-medium">{reserves.souhaitsEnAttente} demande{reserves.souhaitsEnAttente > 1 ? 's' : ''} de congé en attente</span>{' '}
                chevauche{reserves.souhaitsEnAttente > 1 ? 'nt' : ''} cette période — valide-la/les ou refuse-la/les d&apos;abord si tu veux qu&apos;elle{reserves.souhaitsEnAttente > 1 ? 's' : ''} soi{reserves.souhaitsEnAttente > 1 ? 'ent' : 't'} prise{reserves.souhaitsEnAttente > 1 ? 's' : ''} en compte.
              </div>
            )}
            <p className="text-muted-foreground">
              Tu peux corriger d&apos;abord, ou publier quand même en connaissance de cause.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReserves(null)} disabled={publishing}>
              Corriger d&apos;abord
            </Button>
            <Button
              onClick={() => handlePublier(true)}
              disabled={publishing}
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
        <DialogContent className="gv-modale">
          <DialogHeader>
            <p className="gm-kicker">Planning · régénération</p>
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
    </>
  ) : null

  return { pilules, alertes, modales }
}
