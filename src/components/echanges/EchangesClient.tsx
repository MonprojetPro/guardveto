'use client'

// ============================================================
// GUARDVETO — Échanges de gardes (client)
// ============================================================
// Sections : à valider (admin) · reçues (cible=moi) · mes demandes ·
// historique. + Dialogue de proposition (ma garde → confrère →
// contrepartie optionnelle → message).
// ============================================================

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeftRight, Check, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import {
  proposerEchange,
  accepterEchange,
  refuserEchange,
  annulerEchange,
  validerEchangeAdmin,
  refuserEchangeAdmin,
} from '@/app/(protected)/echanges/actions'
import { humaniserCodeGarde } from '@/lib/libelles-gardes'

// ── Types partagés avec la page (serveur) ─────────────────

export interface GardeLite {
  id: string
  date: string
  type: string
  premier_id: string | null
  second_id: string | null
}

export interface VetLite {
  id: string
  prenom: string
  nom: string
  couleur: string
}

export interface EchangeRow {
  id: string
  statut: 'proposee' | 'acceptee' | 'refusee' | 'annulee' | 'validee' | 'refusee_admin'
  message: string | null
  motif_refus: string | null
  role_demandeur: 'premier' | 'second'
  role_contrepartie: 'premier' | 'second' | null
  demandeur_id: string
  /** null = proposition OUVERTE à tous (premier arrivé, premier servi). */
  cible_id: string | null
  created_at: string
  garde: { id: string; date: string; type: string } | null
  gardeContrepartie: { id: string; date: string; type: string } | null
}

interface EchangesClientProps {
  moiId: string
  isAdmin: boolean
  echanges: EchangeRow[]
  gardesFutures: GardeLite[]
  vets: VetLite[]
  /** Garde pré-sélectionnée (entrée depuis le planning : /echanges?proposer=ID). */
  gardePreselectionnee?: string | null
}

// ── Helpers d'affichage ───────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

function typeLabel(type: string) {
  switch (type) {
    case 'weekend': return 'week-end'
    case 'ferie':   return 'jour férié'
    case 'semaine': return 'semaine'
    // Type SUR-MESURE (P3b) : son nom humanisé.
    default:        return humaniserCodeGarde(type).toLowerCase()
  }
}

function roleLabel(role: 'premier' | 'second') {
  return role === 'premier' ? '1er' : '2nd'
}

const STATUT_CONFIG: Record<EchangeRow['statut'], { label: string; className: string }> = {
  proposee:      { label: 'En attente du confrère', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  acceptee:      { label: 'En attente de validation', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  refusee:       { label: 'Décliné', className: 'bg-red-100 text-red-700 border-red-200' },
  annulee:       { label: 'Annulé', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  validee:       { label: 'Appliqué ✓', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  refusee_admin: { label: 'Refusé (admin)', className: 'bg-red-100 text-red-700 border-red-200' },
}

// ── Composant principal ───────────────────────────────────

export function EchangesClient({ moiId, isAdmin, echanges, gardesFutures, vets, gardePreselectionnee }: EchangesClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // Entrée depuis le planning : le dialogue s'ouvre pré-rempli sur la garde.
  const [proposerOpen, setProposerOpen] = useState(Boolean(gardePreselectionnee))
  const [refusEnCours, setRefusEnCours] = useState<{ id: string; admin: boolean } | null>(null)
  const [motifRefus, setMotifRefus] = useState('')
  const [annulationEnCours, setAnnulationEnCours] = useState<string | null>(null)
  // Règles dures enfreintes par l'échange que l'admin s'apprête à valider.
  // Le serveur les a calculées sur l'état réel ; on les montre telles quelles et
  // on laisse l'admin trancher — le système INFORME, il n'interdit pas.
  const [avertEchange, setAvertEchange] = useState<
    { id: string; warnings: string[] } | null
  >(null)

  const vetById = useMemo(() => new Map(vets.map((v) => [v.id, v])), [vets])
  const nomDe = (id: string) => {
    const v = vetById.get(id)
    return v ? `${v.prenom} ${v.nom}` : 'Confrère'
  }

  const aValider = isAdmin ? echanges.filter((e) => e.statut === 'acceptee') : []
  const recues = echanges.filter((e) => e.cible_id === moiId && e.statut === 'proposee')
  // Propositions OUVERTES des confrères : premier arrivé, premier servi.
  const ouvertes = echanges.filter(
    (e) => e.cible_id === null && e.statut === 'proposee' && e.demandeur_id !== moiId,
  )
  const mesDemandes = echanges.filter(
    (e) => e.demandeur_id === moiId && (e.statut === 'proposee' || e.statut === 'acceptee'),
  )
  const historique = echanges.filter(
    (e) =>
      !aValider.includes(e) && !recues.includes(e) && !ouvertes.includes(e) && !mesDemandes.includes(e),
  )

  const lancer = (fn: () => Promise<{ error?: string; success?: boolean }>, okMsg: string) => {
    startTransition(async () => {
      const result = await fn()
      if (result.error) { toast.error(result.error); return }
      toast.success(okMsg)
      setRefusEnCours(null)
      setMotifRefus('')
      setAnnulationEnCours(null)
      router.refresh()
    })
  }

  /**
   * Validation admin — le seul geste de cet écran qui écrit dans le planning,
   * donc le seul soumis au garde-fou des règles dures. Premier appel sans
   * confirmation : si le serveur remonte des règles enfreintes, on les affiche
   * au lieu d'appliquer. Second appel, après le clic de l'admin, avec `true`.
   */
  const validerEchange = (id: string, confirmer = false) => {
    startTransition(async () => {
      const result = await validerEchangeAdmin(id, confirmer)
      if ('needsConfirmation' in result) {
        setAvertEchange({ id, warnings: result.warnings })
        return
      }
      if ('error' in result) { toast.error(result.error); return }
      toast.success('Échange validé — le planning est à jour.')
      setAvertEchange(null)
      router.refresh()
    })
  }

  // Carte d'un échange (résumé lisible : qui cède quoi à qui, contrepartie).
  const EchangeCard = ({ e, actions }: { e: EchangeRow; actions?: React.ReactNode }) => {
    const cfg = STATUT_CONFIG[e.statut]
    return (
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="text-sm space-y-1 min-w-0">
            <p className="font-medium text-foreground">
              {nomDe(e.demandeur_id)} cède sa garde
              {e.garde && <> du <strong>{formatDate(e.garde.date)}</strong> ({typeLabel(e.garde.type)}, {roleLabel(e.role_demandeur)})</>}
              {' '}{e.cible_id ? <>à {nomDe(e.cible_id)}</> : <>au premier confrère intéressé</>}
            </p>
            {e.gardeContrepartie && e.role_contrepartie && (
              <p className="text-muted-foreground flex items-center gap-1.5">
                <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                En échange de la garde du <strong>{formatDate(e.gardeContrepartie.date)}</strong>
                {' '}({typeLabel(e.gardeContrepartie.type)}, {roleLabel(e.role_contrepartie)})
              </p>
            )}
            {!e.gardeContrepartie && (
              <p className="text-muted-foreground text-xs">Cession simple (rien en retour)</p>
            )}
            {e.message && (
              <p className="text-xs text-muted-foreground italic">« {e.message} »</p>
            )}
            {e.motif_refus && (e.statut === 'refusee' || e.statut === 'refusee_admin') && (
              <p className="text-xs text-destructive italic">Motif : {e.motif_refus}</p>
            )}
          </div>
          <Badge variant="outline" className={`text-xs shrink-0 ${cfg.className}`}>{cfg.label}</Badge>
        </div>
        {actions && <div className="flex gap-2 justify-end flex-wrap">{actions}</div>}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Échanges de gardes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Propose une de tes gardes à un confrère — l&apos;administrateur valide, le planning se met à jour tout seul.
          </p>
        </div>
        <Button onClick={() => setProposerOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Proposer un échange
        </Button>
      </div>

      {/* À valider (admin) */}
      {isAdmin && aValider.length > 0 && (
        <section className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-800">
            {aValider.length} échange{aValider.length > 1 ? 's' : ''} accepté{aValider.length > 1 ? 's' : ''} — ta validation applique le changement
          </p>
          <div className="space-y-2">
            {aValider.map((e) => (
              <EchangeCard
                key={e.id}
                e={e}
                actions={
                  <>
                    <Button
                      size="sm" variant="outline"
                      className="text-destructive border-destructive/30 hover:bg-destructive/5"
                      disabled={isPending}
                      onClick={() => { setRefusEnCours({ id: e.id, admin: true }); setMotifRefus('') }}
                    >
                      <X className="w-3.5 h-3.5 mr-1.5" /> Refuser
                    </Button>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={isPending}
                      onClick={() => validerEchange(e.id)}
                    >
                      <Check className="w-3.5 h-3.5 mr-1.5" /> Valider et appliquer
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Propositions reçues */}
      {recues.length > 0 && (
        <section className="rounded-xl border-2 border-orange-200 bg-orange-50/50 p-4 space-y-3">
          <p className="text-sm font-semibold text-orange-800">
            {recues.length} proposition{recues.length > 1 ? 's' : ''} pour toi
          </p>
          <div className="space-y-2">
            {recues.map((e) => (
              <EchangeCard
                key={e.id}
                e={e}
                actions={
                  <>
                    <Button
                      size="sm" variant="outline"
                      className="text-destructive border-destructive/30 hover:bg-destructive/5"
                      disabled={isPending}
                      onClick={() => { setRefusEnCours({ id: e.id, admin: false }); setMotifRefus('') }}
                    >
                      <X className="w-3.5 h-3.5 mr-1.5" /> Décliner
                    </Button>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      disabled={isPending}
                      onClick={() => lancer(() => accepterEchange(e.id), 'Proposition acceptée — en attente de validation admin.')}
                    >
                      <Check className="w-3.5 h-3.5 mr-1.5" /> Accepter
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Propositions ouvertes (premier arrivé, premier servi) */}
      {ouvertes.length > 0 && (
        <section className="rounded-xl border-2 border-violet-200 bg-violet-50/50 p-4 space-y-3">
          <p className="text-sm font-semibold text-violet-800">
            {ouvertes.length} garde{ouvertes.length > 1 ? 's' : ''} à reprendre — premier arrivé, premier servi
          </p>
          <div className="space-y-2">
            {ouvertes.map((e) => (
              <EchangeCard
                key={e.id}
                e={e}
                actions={
                  <Button
                    size="sm"
                    className="bg-violet-600 hover:bg-violet-700 text-white"
                    disabled={isPending}
                    onClick={() => lancer(() => accepterEchange(e.id), 'C\'est noté — en attente de validation admin.')}
                  >
                    <Check className="w-3.5 h-3.5 mr-1.5" /> Je la prends
                  </Button>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Mes demandes en cours */}
      {mesDemandes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Mes demandes en cours</h2>
          <div className="space-y-2">
            {mesDemandes.map((e) => (
              <EchangeCard
                key={e.id}
                e={e}
                actions={
                  <Button
                    size="sm" variant="ghost"
                    className="text-muted-foreground"
                    disabled={isPending}
                    onClick={() => setAnnulationEnCours(e.id)}
                  >
                    Annuler ma demande
                  </Button>
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* État vide global */}
      {aValider.length === 0 && recues.length === 0 && ouvertes.length === 0 && mesDemandes.length === 0 && historique.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <ArrowLeftRight className="w-10 h-10 opacity-30" />
          <p className="text-sm">Aucun échange pour le moment.</p>
          <p className="text-xs">Propose une de tes gardes à un confrère avec le bouton ci-dessus.</p>
        </div>
      )}

      {/* Historique */}
      {historique.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Historique</h2>
          <div className="space-y-2 opacity-80">
            {historique.map((e) => <EchangeCard key={e.id} e={e} />)}
          </div>
        </section>
      )}

      {/* Dialogue : proposer un échange */}
      <ProposerEchangeDialog
        open={proposerOpen}
        onClose={() => setProposerOpen(false)}
        moiId={moiId}
        gardesFutures={gardesFutures}
        vets={vets}
        gardePreselectionnee={gardePreselectionnee}
        onDone={() => { setProposerOpen(false); router.refresh() }}
      />

      {/* Dialogue : refus avec motif (confrère OU admin) */}
      <Dialog open={refusEnCours !== null} onOpenChange={(o) => { if (!o && !isPending) setRefusEnCours(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">
              {refusEnCours?.admin ? 'Refuser cet échange ?' : 'Décliner cette proposition ?'}
            </DialogTitle>
            <DialogDescription>
              Le motif est facultatif — il sera transmis {refusEnCours?.admin ? 'aux deux vétérinaires' : 'à ton confrère'}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="motif-refus">Motif <span className="text-muted-foreground font-normal">(facultatif)</span></Label>
            <Textarea
              id="motif-refus"
              placeholder="Ex : je suis déjà bien chargé cette semaine-là…"
              value={motifRefus}
              onChange={(e) => setMotifRefus(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefusEnCours(null)} disabled={isPending}>Retour</Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                if (!refusEnCours) return
                const { id, admin } = refusEnCours
                lancer(
                  () => (admin ? refuserEchangeAdmin(id, motifRefus) : refuserEchange(id, motifRefus)),
                  admin ? 'Échange refusé — les vétérinaires sont prévenus.' : 'Proposition déclinée.',
                )
              }}
            >
              {isPending ? 'En cours…' : (refusEnCours?.admin ? 'Refuser l\'échange' : 'Décliner')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue : confirmation d'annulation */}
      <Dialog open={annulationEnCours !== null} onOpenChange={(o) => { if (!o && !isPending) setAnnulationEnCours(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Annuler ta demande d&apos;échange ?</DialogTitle>
            <DialogDescription>
              Ta proposition sera retirée. Tu pourras en refaire une plus tard.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnnulationEnCours(null)} disabled={isPending}>Garder ma demande</Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => annulationEnCours && lancer(() => annulerEchange(annulationEnCours), 'Demande annulée.')}
            >
              {isPending ? 'Annulation…' : 'Annuler la demande'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogue : règles enfreintes par l'échange à valider.
          Même vocabulaire que la modale d'édition d'une garde — c'est le même
          garde-fou, il ne doit pas parler deux langues selon l'écran. */}
      <Dialog
        open={avertEchange !== null}
        onOpenChange={(o) => { if (!o && !isPending) setAvertEchange(null) }}
      >
        <DialogContent className="gv-modale">
          <DialogHeader>
            <DialogTitle className="font-heading">Cet échange enfreint des règles</DialogTitle>
            <DialogDescription>
              L&apos;échange reste possible : à toi de juger s&apos;il est acceptable.
            </DialogDescription>
          </DialogHeader>
          <div className="gf-card souple">
            <p className="gf-title">
              <AlertTriangle className="w-3.5 h-3.5" />
              Ce que la vérification a relevé
            </p>
            {(avertEchange?.warnings ?? []).map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAvertEchange(null)}
              disabled={isPending}
            >
              Ne pas valider
            </Button>
            <Button
              disabled={isPending}
              onClick={() => avertEchange && validerEchange(avertEchange.id, true)}
            >
              {isPending ? 'Application…' : 'Valider quand même'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Dialogue de proposition ───────────────────────────────

interface ProposerEchangeDialogProps {
  open: boolean
  onClose: () => void
  moiId: string
  gardesFutures: GardeLite[]
  vets: VetLite[]
  gardePreselectionnee?: string | null
  onDone: () => void
}

function ProposerEchangeDialog({ open, onClose, moiId, gardesFutures, vets, gardePreselectionnee, onDone }: ProposerEchangeDialogProps) {
  const [isPending, startTransition] = useTransition()
  const mesGardes = useMemo(
    () => gardesFutures.filter((g) => g.premier_id === moiId || g.second_id === moiId),
    [gardesFutures, moiId],
  )
  // Pré-sélection depuis le planning (seulement si la garde est bien à moi).
  const preselValide = gardePreselectionnee && mesGardes.some((g) => g.id === gardePreselectionnee)
    ? gardePreselectionnee
    : ''
  const [gardeId, setGardeId] = useState(preselValide)
  const [aTous, setATous] = useState(false)
  const [cibleId, setCibleId] = useState('')
  const [avecContrepartie, setAvecContrepartie] = useState(false)
  const [contrepartieId, setContrepartieId] = useState('')
  const [message, setMessage] = useState('')
  const gardesCible = useMemo(
    () => (cibleId
      ? gardesFutures.filter((g) => g.premier_id === cibleId || g.second_id === cibleId)
      : []),
    [gardesFutures, cibleId],
  )
  const confreres = vets.filter((v) => v.id !== moiId)

  const roleSur = (g: GardeLite, vetId: string): 'premier' | 'second' =>
    g.premier_id === vetId ? 'premier' : 'second'

  const labelGarde = (g: GardeLite, vetId: string) =>
    `${formatDate(g.date)} — ${typeLabel(g.type)} (${roleLabel(roleSur(g, vetId))})`

  const reset = () => {
    setGardeId(''); setATous(false); setCibleId(''); setAvecContrepartie(false); setContrepartieId(''); setMessage('')
  }

  const peutEnvoyer = gardeId && (aTous || cibleId) && (aTous || !avecContrepartie || contrepartieId)

  const envoyer = () => {
    const maGarde = mesGardes.find((g) => g.id === gardeId)
    if (!maGarde) return
    const contrepartie = !aTous && avecContrepartie ? gardesCible.find((g) => g.id === contrepartieId) : null
    startTransition(async () => {
      const result = await proposerEchange({
        gardeId: maGarde.id,
        roleDemandeur: roleSur(maGarde, moiId),
        cibleId: aTous ? null : cibleId,
        gardeContrepartieId: contrepartie?.id ?? null,
        roleContrepartie: contrepartie ? roleSur(contrepartie, cibleId) : null,
        message: message || null,
      })
      if (result.error) { toast.error(result.error); return }
      toast.success(aTous
        ? 'Proposition envoyée à tous les confrères — le premier qui accepte la prend.'
        : 'Proposition envoyée — ton confrère est prévenu.')
      reset()
      onDone()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isPending) { reset(); onClose() } }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">Proposer un échange de garde</DialogTitle>
          <DialogDescription>
            Choisis la garde que tu cèdes et le confrère à qui tu la proposes.
            L&apos;échange ne sera appliqué qu&apos;après son accord et la validation de l&apos;administrateur.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Ma garde à céder</Label>
            {mesGardes.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
                Tu n&apos;as aucune garde à venir sur un planning publié.
              </p>
            ) : (
              <Select value={gardeId} onValueChange={(v) => v && setGardeId(v)}>
                <SelectTrigger className="w-full">
                  <span className="flex-1 text-left truncate text-sm">
                    {gardeId
                      ? labelGarde(mesGardes.find((g) => g.id === gardeId)!, moiId)
                      : <span className="text-muted-foreground">Choisir une garde…</span>}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {mesGardes.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{labelGarde(g, moiId)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>À proposer à</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setATous(false)}
                aria-pressed={!aTous}
                className={`rounded-md border px-3 py-2 text-sm transition-colors ${!aTous ? 'border-primary bg-primary/5 font-medium' : 'border-border text-muted-foreground hover:bg-muted/40'}`}
              >
                Un confrère précis
              </button>
              <button
                type="button"
                onClick={() => { setATous(true); setCibleId(''); setAvecContrepartie(false); setContrepartieId('') }}
                aria-pressed={aTous}
                className={`rounded-md border px-3 py-2 text-sm transition-colors ${aTous ? 'border-primary bg-primary/5 font-medium' : 'border-border text-muted-foreground hover:bg-muted/40'}`}
              >
                Tous les confrères
              </button>
            </div>
            {aTous ? (
              <p className="text-xs text-muted-foreground">
                Premier arrivé, premier servi — et forcément une cession simple (pas de garde en retour).
              </p>
            ) : (
              <Select value={cibleId} onValueChange={(v) => { if (v) { setCibleId(v); setContrepartieId('') } }}>
                <SelectTrigger className="w-full">
                  <span className="flex-1 text-left truncate text-sm">
                    {cibleId
                      ? (() => { const v = confreres.find((x) => x.id === cibleId); return v ? `${v.prenom} ${v.nom}` : '' })()
                      : <span className="text-muted-foreground">Choisir un confrère…</span>}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {confreres.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.prenom} {v.nom}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {!aTous && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={avecContrepartie}
                onChange={(e) => { setAvecContrepartie(e.target.checked); setContrepartieId('') }}
              />
              Je reprends une de ses gardes en échange
            </label>
            {avecContrepartie && (
              cibleId === '' ? (
                <p className="text-xs text-muted-foreground">Choisis d&apos;abord le confrère.</p>
              ) : gardesCible.length === 0 ? (
                <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
                  Ce confrère n&apos;a aucune garde à venir sur un planning publié.
                </p>
              ) : (
                <Select value={contrepartieId} onValueChange={(v) => v && setContrepartieId(v)}>
                  <SelectTrigger className="w-full">
                    <span className="flex-1 text-left truncate text-sm">
                      {contrepartieId
                        ? labelGarde(gardesCible.find((g) => g.id === contrepartieId)!, cibleId)
                        : <span className="text-muted-foreground">Choisir sa garde…</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {gardesCible.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{labelGarde(g, cibleId)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            )}
          </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="message-echange">Message <span className="text-muted-foreground font-normal">(facultatif)</span></Label>
            <Textarea
              id="message-echange"
              placeholder="Ex : j'ai un empêchement familial ce soir-là…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose() }} disabled={isPending}>Annuler</Button>
          <Button onClick={envoyer} disabled={isPending || !peutEnvoyer}>
            {isPending ? 'Envoi…' : 'Envoyer la proposition'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
