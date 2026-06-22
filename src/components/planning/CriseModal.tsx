'use client'

// ============================================================
// GUARDVETO — CriseModal (Gestion de crise — LOT 5)
// ============================================================
// Interface admin pour SIGNALER une absence imprévue (après publication) et
// APPLIQUER la réparation du planning, créneau par créneau.
//
// Parcours en 2 étapes au sein d'une même modale :
//   1. DÉCLARATION : choisir le véto absent, les dates (début/fin), le motif
//      et un commentaire facultatif → POST /api/absences.
//   2. RÉPARATION : pour chaque créneau impacté, une ligne AVANT → APRÈS.
//      • remplaçant proposé (`meilleur`) + menu déroulant des autres candidats
//        (Mode 3 — choix manuel) avec leurs `warnings` ;
//      • bouton « Demander aux volontaires » (Mode 2 — déclenche un envoi) ;
//      • si aucun candidat (`diagnostic` présent) : encart honnête « non
//        réparable par simple remplacement » + règles en cause.
//      → POST /api/absences/[id]/reparer avec les décisions choisies.
//
// HONNÊTETÉ UX (règle projet) : on ne fait JAMAIS croire qu'un créneau est
// réparé s'il ne l'est pas. Les créneaux sans candidat sont marqués « non
// résolus » et ne partent PAS dans les décisions appliquées. Le récap de fin
// affiche clairement ce qui reste à traiter.
//
// Admin uniquement : le composant n'est monté que pour les admins (cf. ActionBar).
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Loader2,
  AlertTriangle,
  ArrowRight,
  Users,
  CheckCircle2,
  CircleAlert,
  Ban,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MotifAbsence, Absence } from '@/types'
import type {
  DiagnosticImpasse as DiagnosticImpasseData,
  RegleEnCause,
} from '@/engine/diagnostic'

// ── Types des contrats API (LOT 3) ───────────────────────

/** Véto sélectionnable comme absent + référentiel pour résoudre les candidats. */
export interface VetCrise {
  id: string
  prenom: string
  nom: string
  couleur: string
}

interface CandidatReparation {
  vetId: string
  score: number
  warnings: string[]
}

/** Un créneau impacté tel que renvoyé par POST /api/absences. */
interface CreneauImpacte {
  gardeId: string
  date: string
  type: 'semaine' | 'weekend' | 'ferie'
  role: 'premier' | 'second'
  meilleur: string | null
  candidats: CandidatReparation[]
  diagnostic?: DiagnosticImpasseData
}

interface DeclarationResponse {
  absence: Absence
  creneauxImpactes: CreneauImpacte[]
}

/** Décision affichée/choisie par l'admin pour un créneau (état local). */
interface DecisionUI {
  /** vetId du remplaçant choisi, ou null = « ne pas réparer maintenant ». */
  remplacantId: string | null
}

// ── Props ────────────────────────────────────────────────

interface CriseModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Tous les vétos actifs du cabinet (pour le choix de l'absent + résolution noms). */
  vets: VetCrise[]
  /** Date pré-remplie (jour cliqué dans le calendrier), facultatif. */
  dateDefaut?: string
  /**
   * Début de la PLAGE pré-remplie (ex : ouverture depuis un conflit de congé),
   * facultatif. Prioritaire sur `dateDefaut`. Permet de pré-remplir un congé
   * validé qui couvre plusieurs jours (et pas un jour unique).
   */
  dateDebutDefaut?: string
  /** Fin de la PLAGE pré-remplie, facultatif. Prioritaire sur `dateDefaut`. */
  dateFinDefaut?: string
  /** Véto pré-sélectionné comme absent (ex : « déclarer ce véto absent »), facultatif. */
  vetDefautId?: string
}

// ── Helpers de formatage FR ──────────────────────────────

function formatDateFr(dateIso: string): string {
  return new Date(dateIso + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function labelType(type: 'semaine' | 'weekend' | 'ferie'): string {
  if (type === 'weekend') return 'Week-end'
  if (type === 'ferie') return 'Jour férié'
  return 'Soir de semaine'
}

function labelRole(role: 'premier' | 'second'): string {
  return role === 'premier' ? '1er de garde' : '2nd de garde'
}

const MOTIFS: { value: MotifAbsence; label: string }[] = [
  { value: 'maladie', label: 'Maladie' },
  { value: 'urgence', label: 'Urgence' },
  { value: 'autre', label: 'Autre' },
]

// ── Avatar (réutilise le style de GardeDetailModal) ──────

function VetAvatar({ prenom, couleur }: { prenom: string; couleur: string }) {
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
      style={{ backgroundColor: couleur }}
    >
      {prenom.charAt(0)}
    </div>
  )
}

// ── Encart « créneau non réparable » (style DiagnosticImpasse) ──

function EncartDiagnostic({ diagnostic }: { diagnostic: DiagnosticImpasseData }) {
  const reglesTriees: RegleEnCause[] = [...diagnostic.reglesEnCause].sort(
    (a, b) => b.occurrences - a.occurrences,
  )

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <Ban className="w-4 h-4 text-destructive mt-0.5 shrink-0" aria-hidden />
        <p className="text-xs font-medium text-destructive">
          Ce créneau ne peut pas être réparé par simple remplacement
        </p>
      </div>
      {reglesTriees.length > 0 ? (
        <ul className="space-y-1 pl-6">
          {reglesTriees.map((r, i) => (
            <li
              key={`${r.code}-${r.vetId ?? r.contrainteId ?? i}`}
              className="flex items-baseline gap-2 text-xs text-muted-foreground"
            >
              <span className="text-destructive/70 shrink-0" aria-hidden>
                •
              </span>
              <span>
                <span className="text-foreground">{r.libelle}</span>
                {r.occurrences > 0 && (
                  <span className="text-muted-foreground/70">
                    {' '}
                    (bloque {r.occurrences} créneau{r.occurrences > 1 ? 'x' : ''})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground pl-6">
          Aucun vétérinaire ne peut être assigné sans enfreindre une règle (ex : week-end,
          repos, congés). À traiter manuellement ou via les volontaires.
        </p>
      )}
    </div>
  )
}

// ── Ligne de réparation d'un créneau (AVANT → APRÈS) ─────

function LigneReparation({
  creneau,
  vetsById,
  absentPrenom,
  decision,
  onChange,
  onVolontaires,
  volontairesEnCours,
}: {
  creneau: CreneauImpacte
  vetsById: Map<string, VetCrise>
  absentPrenom: string
  decision: DecisionUI
  onChange: (remplacantId: string | null) => void
  onVolontaires: () => void
  volontairesEnCours: boolean
}) {
  const aucunCandidat = creneau.candidats.length === 0
  const remplacant = decision.remplacantId ? vetsById.get(decision.remplacantId) : null
  const meilleurVet = creneau.meilleur ? vetsById.get(creneau.meilleur) : null

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      {/* En-tête créneau */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-foreground capitalize">
          {formatDateFr(creneau.date)}
        </span>
        <span className="text-xs text-muted-foreground">
          {labelType(creneau.type)} · {labelRole(creneau.role)}
        </span>
      </div>

      {/* AVANT → APRÈS */}
      <div className="flex items-stretch gap-3">
        {/* AVANT : l'absent */}
        <div className="flex-1 min-w-0 rounded-md bg-muted/40 p-2.5 space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Avant
          </p>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-foreground line-through decoration-destructive/60">
              {absentPrenom}
            </span>
            <span className="text-[11px] text-destructive">absent·e</span>
          </div>
        </div>

        <div className="flex items-center shrink-0">
          <ArrowRight className="w-4 h-4 text-muted-foreground" aria-hidden />
        </div>

        {/* APRÈS : le remplaçant proposé / choisi */}
        <div className="flex-1 min-w-0 rounded-md bg-muted/40 p-2.5 space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Après
          </p>
          {aucunCandidat ? (
            <div className="flex items-center gap-1.5 text-sm text-destructive">
              <CircleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span>Non résolu</span>
            </div>
          ) : remplacant ? (
            <div className="flex items-center gap-2 text-sm">
              <VetAvatar prenom={remplacant.prenom} couleur={remplacant.couleur} />
              <span className="text-foreground font-medium truncate">
                {remplacant.prenom} {remplacant.nom}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-amber-600">
              <CircleAlert className="w-3.5 h-3.5 shrink-0" aria-hidden />
              <span>À traiter plus tard</span>
            </div>
          )}
        </div>
      </div>

      {/* Diagnostic (aucun candidat) */}
      {aucunCandidat && creneau.diagnostic && (
        <EncartDiagnostic diagnostic={creneau.diagnostic} />
      )}

      {/* Sélecteur de remplaçant (Mode 1 proposé / Mode 3 manuel) */}
      {!aucunCandidat && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label className="text-xs text-muted-foreground">Remplaçant·e</Label>
            {meilleurVet && creneau.meilleur === decision.remplacantId && (
              <span className="text-[11px] text-accent inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" aria-hidden />
                Proposition la plus équitable
              </span>
            )}
          </div>

          <Select
            value={decision.remplacantId ?? '__aucun__'}
            onValueChange={(v) => onChange(v === '__aucun__' ? null : v)}
          >
            <SelectTrigger className="w-full h-auto">
              {/* base-ui SelectValue rend la VALEUR brute (UUID) → on affiche le nom. */}
              {remplacant ? (
                <span className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                    style={{ backgroundColor: remplacant.couleur }}
                  />
                  {remplacant.prenom} {remplacant.nom}
                </span>
              ) : (
                <span className="text-muted-foreground">Ne pas réparer maintenant</span>
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__aucun__">
                <span className="text-muted-foreground">Ne pas réparer maintenant</span>
              </SelectItem>
              {creneau.candidats.map((c) => {
                const vet = vetsById.get(c.vetId)
                if (!vet) return null
                const estMeilleur = c.vetId === creneau.meilleur
                return (
                  <SelectItem key={c.vetId} value={c.vetId}>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">
                        {vet.prenom} {vet.nom}
                      </span>
                      {estMeilleur && (
                        <span className="text-[10px] text-accent">· recommandé</span>
                      )}
                      {c.warnings.length > 0 && (
                        <span className="text-[10px] text-amber-600">
                          · {c.warnings.length} alerte{c.warnings.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>

          {/* Warnings du candidat sélectionné */}
          {decision.remplacantId &&
            (() => {
              const cand = creneau.candidats.find((c) => c.vetId === decision.remplacantId)
              if (!cand || cand.warnings.length === 0) return null
              return (
                <ul className="space-y-1">
                  {cand.warnings.map((w, i) => (
                    <li
                      key={i}
                      className="flex items-baseline gap-1.5 text-[11px] text-amber-600"
                    >
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden />
                      <span>{w.replace(/^R\d+ : /, '')}</span>
                    </li>
                  ))}
                </ul>
              )
            })()}
        </div>
      )}

      {/* Mode 2 — demander aux volontaires */}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={onVolontaires}
          disabled={volontairesEnCours}
        >
          {volontairesEnCours ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Users className="w-3.5 h-3.5 mr-1.5" />
          )}
          Demander aux volontaires
        </Button>
      </div>
    </div>
  )
}

// ── Composant principal ──────────────────────────────────

export function CriseModal({
  open,
  onOpenChange,
  vets,
  dateDefaut,
  dateDebutDefaut,
  dateFinDefaut,
  vetDefautId,
}: CriseModalProps) {
  const router = useRouter()

  // Plage pré-remplie résolue : une plage explicite (dateDebutDefaut/dateFinDefaut)
  // prime sur le jour unique (dateDefaut), qui prime sur vide.
  const debutInitial = dateDebutDefaut ?? dateDefaut ?? ''
  const finInitiale = dateFinDefaut ?? dateDefaut ?? ''

  // Étape 1 — déclaration
  const [absentId, setAbsentId] = useState<string>(vetDefautId ?? '')
  const [dateDebut, setDateDebut] = useState<string>(debutInitial)
  const [dateFin, setDateFin] = useState<string>(finInitiale)
  const [motif, setMotif] = useState<MotifAbsence>('maladie')
  const [commentaire, setCommentaire] = useState<string>('')
  const [declaring, setDeclaring] = useState(false)

  // Étape 2 — réparation
  const [resultat, setResultat] = useState<DeclarationResponse | null>(null)
  const [decisions, setDecisions] = useState<Record<string, DecisionUI>>({})
  const [applying, setApplying] = useState(false)
  const [volontairesEnCours, setVolontairesEnCours] = useState(false)

  const vetsById = new Map(vets.map((v) => [v.id, v]))
  const absentVet = absentId ? vetsById.get(absentId) : null

  // ── Reset complet à la fermeture ──────────────────────
  function resetAll() {
    setAbsentId(vetDefautId ?? '')
    setDateDebut(debutInitial)
    setDateFin(finInitiale)
    setMotif('maladie')
    setCommentaire('')
    setResultat(null)
    setDecisions({})
  }

  function handleOpenChange(next: boolean, eventDetails?: { reason?: string }) {
    // Anti-perte : un clic à côté (outside-press) ou Échap NE ferme PAS la fenêtre
    // de crise — on ne perd plus une réparation en cours par accident. La fermeture
    // volontaire passe par Annuler / Fermer / la croix.
    if (!next && (eventDetails?.reason === 'outside-press' || eventDetails?.reason === 'escape-key')) {
      return
    }
    if (!next) resetAll()
    onOpenChange(next)
  }

  // ── Étape 1 → POST /api/absences ──────────────────────
  async function handleDeclarer() {
    if (!absentId) {
      toast.error('Choisis le vétérinaire absent.')
      return
    }
    if (!dateDebut || !dateFin) {
      toast.error('Renseigne les dates de début et de fin.')
      return
    }
    if (dateFin < dateDebut) {
      toast.error('La date de fin doit être après (ou égale à) la date de début.')
      return
    }

    setDeclaring(true)
    try {
      const res = await fetch('/api/absences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          veterinaire_id: absentId,
          date_debut: dateDebut,
          date_fin: dateFin,
          motif,
          commentaire: commentaire.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Erreur lors de la déclaration de l'absence.")
        return
      }
      const data = json as DeclarationResponse
      setResultat(data)

      // Pré-remplir les décisions avec la meilleure proposition (Mode 1).
      const initial: Record<string, DecisionUI> = {}
      for (const c of data.creneauxImpactes) {
        initial[`${c.gardeId}|${c.role}`] = { remplacantId: c.meilleur }
      }
      setDecisions(initial)

      if (data.creneauxImpactes.length === 0) {
        toast.success('Absence déclarée — aucun créneau de garde impacté.')
      } else {
        toast.success(
          `Absence déclarée — ${data.creneauxImpactes.length} créneau${
            data.creneauxImpactes.length > 1 ? 'x' : ''
          } à réparer.`,
        )
      }
    } catch {
      toast.error('Impossible de joindre le serveur.')
    } finally {
      setDeclaring(false)
    }
  }

  // ── Mode 2 → envoi d'un APPEL AUX VOLONTAIRES ─────────
  // L'admin ne s'engage PAS lui-même : il DEMANDE aux vétos de se porter
  // volontaires (chacun répondra ensuite via POST /api/absences/[id]/volontaire,
  // déclenché par le lien de l'e-mail). Ici on déclenche uniquement l'ENVOI de
  // l'appel. L'endpoint d'envoi (LOT 4) peut ne pas encore être déployé : on le
  // gère honnêtement (404 → message clair), sans jamais faire croire à un succès.
  async function handleVolontaires(creneau: CreneauImpacte) {
    if (!resultat) return
    setVolontairesEnCours(true)
    try {
      const res = await fetch(`/api/absences/${resultat.absence.id}/appel-volontaires`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gardeId: creneau.gardeId, role: creneau.role }),
      })
      if (res.status === 404) {
        toast.error("L'envoi d'un appel aux volontaires n'est pas encore disponible.")
        return
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(json.error ?? "Échec de l'envoi de l'appel aux volontaires.")
        return
      }
      toast.success('Appel envoyé aux vétérinaires — ils peuvent se porter volontaires.')
    } catch {
      toast.error('Impossible de joindre le serveur.')
    } finally {
      setVolontairesEnCours(false)
    }
  }

  // ── Étape 2 → POST /api/absences/[id]/reparer ─────────
  async function handleAppliquer() {
    if (!resultat) return

    // On ne soumet QUE les créneaux où un remplaçant a été choisi.
    const aSoumettre = resultat.creneauxImpactes
      .map((c) => {
        const dec = decisions[`${c.gardeId}|${c.role}`]
        if (!dec?.remplacantId) return null
        return { gardeId: c.gardeId, role: c.role, remplacant_id: dec.remplacantId }
      })
      .filter((d): d is { gardeId: string; role: 'premier' | 'second'; remplacant_id: string } => d !== null)

    if (aSoumettre.length === 0) {
      toast.error('Aucun remplaçant choisi. Sélectionne au moins un remplaçant ou ferme la fenêtre.')
      return
    }

    setApplying(true)
    try {
      const res = await fetch(`/api/absences/${resultat.absence.id}/reparer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions: aSoumettre }),
      })
      const json = await res.json()
      if (!res.ok) {
        // 400 « non éligible » / 409 « déjà pourvu » → message clair renvoyé par l'API.
        toast.error(json.error ?? 'Erreur lors de la réparation.')
        return
      }

      const restants: unknown[] = Array.isArray(json.creneauxRestants) ? json.creneauxRestants : []
      if (restants.length === 0) {
        toast.success('Planning réparé — tous les créneaux sont pourvus.')
      } else {
        toast.success(
          `Réparation appliquée. ${restants.length} créneau${
            restants.length > 1 ? 'x restent' : ' reste'
          } à traiter.`,
        )
      }
      router.refresh()
      handleOpenChange(false)
    } catch {
      toast.error('Impossible de joindre le serveur.')
    } finally {
      setApplying(false)
    }
  }

  // Décompte pour le récap honnête de l'étape 2.
  const nbChoisis = resultat
    ? resultat.creneauxImpactes.filter(
        (c) => decisions[`${c.gardeId}|${c.role}`]?.remplacantId,
      ).length
    : 0
  const nbNonResolus = resultat
    ? resultat.creneauxImpactes.length - nbChoisis
    : 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* ══════════ ÉTAPE 1 — DÉCLARATION ══════════ */}
        {!resultat && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Signaler une absence
              </DialogTitle>
              <DialogDescription>
                Déclare l&apos;absence imprévue d&apos;un vétérinaire. Le planning publié sera
                analysé et une réparation te sera proposée pour chaque garde impactée.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1">
              {/* Véto absent */}
              <div className="space-y-1.5">
                <Label>Vétérinaire absent·e</Label>
                <Select value={absentId} onValueChange={(v) => setAbsentId(v ?? '')}>
                  <SelectTrigger className="w-full">
                    {/* base-ui SelectValue rend la VALEUR brute (un UUID ici) → on
                        affiche le nom à la main, comme l'ActionBar. */}
                    {absentVet ? (
                      <span className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full inline-block"
                          style={{ backgroundColor: absentVet.couleur }}
                        />
                        {absentVet.prenom} {absentVet.nom}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Choisir un vétérinaire…</span>
                    )}
                  </SelectTrigger>
                  <SelectContent>
                    {vets.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full inline-block"
                            style={{ backgroundColor: v.couleur }}
                          />
                          {v.prenom} {v.nom}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="crise-date-debut">Du</Label>
                  <input
                    id="crise-date-debut"
                    type="date"
                    value={dateDebut}
                    onChange={(e) => {
                      setDateDebut(e.target.value)
                      // Si la fin est vide ou antérieure, on l'aligne sur le début.
                      if (!dateFin || dateFin < e.target.value) setDateFin(e.target.value)
                    }}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="crise-date-fin">Au</Label>
                  <input
                    id="crise-date-fin"
                    type="date"
                    value={dateFin}
                    min={dateDebut || undefined}
                    onChange={(e) => setDateFin(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>
              </div>

              {/* Motif */}
              <div className="space-y-1.5">
                <Label>Motif</Label>
                <Select value={motif} onValueChange={(v) => { if (v) setMotif(v as MotifAbsence) }}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOTIFS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Commentaire */}
              <div className="space-y-1.5">
                <Label htmlFor="crise-commentaire">Commentaire (facultatif)</Label>
                <Textarea
                  id="crise-commentaire"
                  value={commentaire}
                  onChange={(e) => setCommentaire(e.target.value)}
                  placeholder="Précision sur l'absence…"
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={declaring}>
                Annuler
              </Button>
              <Button onClick={handleDeclarer} disabled={declaring}>
                {declaring ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyse…
                  </>
                ) : (
                  'Analyser l’impact'
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ══════════ ÉTAPE 2 — RÉPARATION ══════════ */}
        {resultat && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Réparer le planning
              </DialogTitle>
              <DialogDescription>
                {absentVet ? `${absentVet.prenom} ${absentVet.nom}` : 'Le vétérinaire'} est
                absent·e. Choisis un remplaçant pour chaque garde, puis applique la réparation.
              </DialogDescription>
            </DialogHeader>

            {resultat.creneauxImpactes.length === 0 ? (
              <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950/20">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-400">
                    Aucune garde impactée
                  </p>
                  <p className="text-xs text-green-700 mt-0.5">
                    L&apos;absence est déclarée, mais aucune garde publiée ne concerne ce
                    vétérinaire sur la période. Rien à réparer.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Récap honnête */}
                <div className="flex items-center gap-3 text-xs rounded-md bg-muted/40 px-3 py-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-accent" aria-hidden />
                    {nbChoisis} prêt{nbChoisis > 1 ? 's' : ''} à réparer
                  </span>
                  {nbNonResolus > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-destructive">
                      <CircleAlert className="w-3.5 h-3.5" aria-hidden />
                      {nbNonResolus} non résolu{nbNonResolus > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Lignes de réparation */}
                {resultat.creneauxImpactes.map((c) => {
                  const cle = `${c.gardeId}|${c.role}`
                  return (
                    <LigneReparation
                      key={cle}
                      creneau={c}
                      vetsById={vetsById}
                      absentPrenom={absentVet?.prenom ?? 'Le vétérinaire'}
                      decision={decisions[cle] ?? { remplacantId: null }}
                      onChange={(remplacantId) =>
                        setDecisions((prev) => ({ ...prev, [cle]: { remplacantId } }))
                      }
                      onVolontaires={() => handleVolontaires(c)}
                      volontairesEnCours={volontairesEnCours}
                    />
                  )
                })}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={applying}>
                Fermer
              </Button>
              {resultat.creneauxImpactes.length > 0 && (
                <Button onClick={handleAppliquer} disabled={applying || nbChoisis === 0}>
                  {applying ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Application…
                    </>
                  ) : (
                    `Appliquer la réparation${nbChoisis > 0 ? ` (${nbChoisis})` : ''}`
                  )}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
