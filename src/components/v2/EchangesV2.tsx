'use client'

// ============================================================
// GUARDVETO V2 — Échanges de gardes (onglet 2 d'« Absences & échanges »)
// ============================================================
// Porté de `maquette/m3-absences-echanges.html` (panneau `#tab-echanges`) :
// légende du cycle, note d'échéance, puis cinq cartes — à valider (admin),
// propositions reçues, gardes à reprendre, mes demandes (qui porte le bouton
// « + Proposer un échange »), historique.
//
// Le cycle métier, les actions serveur et les dialogues sont ceux de la V1
// (`components/echanges/EchangesClient`, toujours servie par la route V1
// `/echanges`) : ils portent les garde-fous et les effets de bord — notifs
// aux deux vétérinaires, application au planning publié, re-synchro agenda.
// On rhabille, on ne réimplémente aucune règle.
//
// L'en-tête de section est un <h2> : le <h1> de l'écran appartient à la page.
// ============================================================

import { useMemo, useState, useSyncExternalStore, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import type { EchangeRow, GardeLite, VetLite } from '@/components/echanges/EchangesClient'

interface Props {
  moiId: string
  isAdmin: boolean
  echanges: EchangeRow[]
  gardesFutures: GardeLite[]
  vets: VetLite[]
}

// ── Mise en forme des dates et des libellés ───────────────

const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris',
})
const DATE_COURTE = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric', month: 'long', timeZone: 'Europe/Paris',
})

function dateGarde(iso: string) {
  return DATE_LONGUE.format(new Date(iso + 'T12:00:00Z'))
}

function dateEnvoi(iso: string) {
  return DATE_COURTE.format(new Date(iso))
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

const JOUR_ISO = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Paris',
})

/**
 * Le jour courant, ou `null` tant que le navigateur n'a pas pris la main.
 *
 * Le serveur tourne en UTC et le cabinet vit à Paris : entre minuit et deux
 * heures, les deux ne sont pas le même jour. Rendre `null` côté serveur, puis
 * la vraie date après hydratation, évite l'écart — l'échéance et l'expiration
 * apparaissent une fraction de seconde plus tard, sans jamais mentir.
 */
function useJourCourant() {
  return useSyncExternalStore(
    () => () => {},
    () => JOUR_ISO.format(new Date()),
    () => null,
  )
}

function joursAvant(iso: string, aujourdHui: string) {
  return Math.round((Date.parse(iso) - Date.parse(aujourdHui)) / 86_400_000)
}

const LIBELLE_STATUT: Record<EchangeRow['statut'], { texte: string; classe: string }> = {
  proposee:      { texte: 'En attente du confrère',   classe: 'st-attente-confrere' },
  acceptee:      { texte: 'En attente de validation', classe: 'st-attente-validation' },
  refusee:       { texte: 'Décliné',                  classe: 'st-decline' },
  annulee:       { texte: 'Annulé',                   classe: 'st-annule' },
  validee:       { texte: 'Appliqué ✓',               classe: 'st-applique' },
  refusee_admin: { texte: 'Refusé admin',             classe: 'st-refuse-admin' },
}

// ── Composant principal ───────────────────────────────────

export function EchangesV2({ moiId, isAdmin, echanges, gardesFutures, vets }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [proposerOuvert, setProposerOuvert] = useState(false)
  const [refusEnCours, setRefusEnCours] = useState<{ id: string; admin: boolean } | null>(null)
  const [motifRefus, setMotifRefus] = useState('')
  const [annulationEnCours, setAnnulationEnCours] = useState<string | null>(null)

  const aujourdHui = useJourCourant()

  const parVet = useMemo(() => new Map(vets.map((v) => [v.id, v])), [vets])
  const nomDe = (id: string) => {
    const v = parVet.get(id)
    return v ? `${v.prenom} ${v.nom}`.trim() : 'Confrère'
  }
  const prenomDe = (id: string) => parVet.get(id)?.prenom ?? 'Confrère'

  // Découpage identique à la V1 : c'est lui qui décide qui peut agir sur quoi.
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

  // La phrase du haut de ligne : qui cède quoi à qui, à la bonne personne.
  const phrasePrincipale = (e: EchangeRow) => {
    const moiDemandeur = e.demandeur_id === moiId
    const moiCible = e.cible_id === moiId
    const quand = e.garde ? <b>{dateGarde(e.garde.date)}</b> : <b>date inconnue</b>
    const precisions = e.garde
      ? ` (${typeLabel(e.garde.type)}, ${roleLabel(e.role_demandeur)})`
      : ''
    return (
      <>
        {moiDemandeur ? <>Tu cèdes ta garde du </> : <><b>{prenomDe(e.demandeur_id)}</b> cède sa garde du </>}
        {quand}
        {precisions}
        {e.cible_id === null
          ? <> à toute l’équipe</>
          : moiCible
            ? <> à toi</>
            : <> à <b>{prenomDe(e.cible_id)}</b></>}
      </>
    )
  }

  // La deuxième ligne : la contrepartie s'il y en a une, et la date d'envoi.
  const phraseContrepartie = (e: EchangeRow) => {
    const envoi = ` · proposé le ${dateEnvoi(e.created_at)}`
    if (!e.gardeContrepartie || !e.role_contrepartie) {
      return e.cible_id === null
        ? `Première arrivée, première servie — rien en retour${envoi}`
        : `Cession simple — rien en retour${envoi}`
    }
    const qui = e.cible_id === moiId ? 'tu cèdes ta' : `${prenomDe(e.cible_id ?? '')} cède sa`
    const g = e.gardeContrepartie
    return `En échange : ${qui} garde du ${dateGarde(g.date)} (${typeLabel(g.type)}, ${roleLabel(e.role_contrepartie)})${envoi}`
  }

  /** La proposition attend encore alors que la garde est déjà passée. */
  const estExpiree = (e: EchangeRow) =>
    aujourdHui !== null
    && (e.statut === 'proposee' || e.statut === 'acceptee')
    && e.garde !== null
    && e.garde.date < aujourdHui

  /** Le compte à rebours des propositions sans réponse, à sept jours de la garde. */
  const echeance = (e: EchangeRow) => {
    if (aujourdHui === null || e.statut !== 'proposee' || !e.garde) return null
    const j = joursAvant(e.garde.date, aujourdHui)
    if (j < 0 || j > 7) return null
    if (j === 0) return '⏳ La garde a lieu aujourd’hui'
    if (j === 1) return '⏳ J-1 : la garde a lieu demain'
    return `⏳ J-${j} : la garde approche`
  }

  const pastilles = (e: EchangeRow) => {
    const cfg = LIBELLE_STATUT[e.statut]
    const rebours = echeance(e)
    return (
      <>
        {rebours && <span className="status-pill st-echeance">{rebours}</span>}
        {estExpiree(e) ? (
          <span className="status-pill st-expiree">Expirée</span>
        ) : (
          <span className={`status-pill ${cfg.classe}`}>
            {cfg.texte}
            {e.statut === 'proposee' && e.cible_id === moiId ? ' (toi)' : ''}
          </span>
        )}
      </>
    )
  }

  const Ligne = ({ e, actions }: { e: EchangeRow; actions?: React.ReactNode }) => {
    const vet = parVet.get(e.demandeur_id)
    return (
      <li>
        <div className="row">
          <span className="vet-dot" style={{ ['--c' as string]: vet?.couleur ?? 'var(--soft)' }}>
            {(vet?.prenom ?? '?').slice(0, 1)}
          </span>
          <div className="row-main">
            <p className="row-line">{phrasePrincipale(e)}</p>
            <p className="row-dates">{phraseContrepartie(e)}</p>
            {e.message && <p className="row-motif">« {e.message} »</p>}
            {e.motif_refus && (e.statut === 'refusee' || e.statut === 'refusee_admin') && (
              <p className="row-refus">Motif : « {e.motif_refus} »</p>
            )}
            {estExpiree(e) && (
              <p className="row-motif">
                La date est passée sans réponse : la garde n’a jamais quitté son planning.
              </p>
            )}
          </div>
          <div className="row-side">
            {pastilles(e)}
            {actions && <div className="row-actions">{actions}</div>}
          </div>
        </div>
      </li>
    )
  }

  return (
    <>
      <div className="status-legend" aria-label="Les statuts d’un échange">
        <span className="sl-label">Le cycle d’un échange :</span>
        <span className="status-pill st-attente-confrere">En attente du confrère</span>
        <span className="status-pill st-attente-validation">En attente de validation</span>
        <span className="status-pill st-decline">Décliné</span>
        <span className="status-pill st-annule">Annulé</span>
        <span className="status-pill st-applique">Appliqué ✓</span>
        <span className="status-pill st-refuse-admin">Refusé admin</span>
        <span className="status-pill st-expiree">Expirée</span>
      </div>
      <p className="echeance-note">
        🛡 Une proposition n’enlève jamais ta garde : tant que l’échange n’est pas validé, c’est toi
        qui es de garde. Personne n’est jamais « sans garde » à l’échéance.
      </p>

      {/* ── À valider (admin) ────────────────────────────── */}
      {isAdmin && (
        <section className="card" aria-label="Échanges à valider par l’administratrice">
          <div className="card-head">
            <h2>À valider</h2>
            {aValider.length > 0 && <span className="section-count">{aValider.length}</span>}
            <p className="sub">
              Le confrère a accepté : dernier mot pour toi. Valider applique l’échange au planning
              publié, refuser demande un motif.
            </p>
          </div>
          {aValider.length === 0 ? (
            <p className="empty-row">Rien à valider pour l’instant.</p>
          ) : (
            <ul className="rows">
              {aValider.map((e) => (
                <Ligne
                  key={e.id}
                  e={e}
                  actions={
                    <>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={isPending}
                        onClick={() => { setRefusEnCours({ id: e.id, admin: true }); setMotifRefus('') }}
                      >
                        Refuser…
                      </button>
                      <button
                        type="button"
                        className="btn btn-ok btn-sm"
                        disabled={isPending}
                        onClick={() => lancer(() => validerEchangeAdmin(e.id), 'Échange validé — le planning est à jour.')}
                      >
                        Valider l’échange
                      </button>
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Propositions reçues ──────────────────────────── */}
      <section className="card" aria-label="Propositions d’échange reçues">
        <div className="card-head">
          <h2>Propositions reçues</h2>
          {recues.length > 0 && <span className="section-count">{recues.length}</span>}
          <p className="sub">
            Un confrère te propose une de ses gardes : à toi d’accepter ou de décliner, avec un mot
            d’explication.
          </p>
        </div>
        {recues.length === 0 ? (
          <p className="empty-row">Aucune proposition en attente de ta réponse.</p>
        ) : (
          <ul className="rows">
            {recues.map((e) => (
              <Ligne
                key={e.id}
                e={e}
                actions={
                  <>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={isPending}
                      onClick={() => { setRefusEnCours({ id: e.id, admin: false }); setMotifRefus('') }}
                    >
                      Décliner…
                    </button>
                    <button
                      type="button"
                      className="btn btn-ok btn-sm"
                      disabled={isPending}
                      onClick={() => lancer(() => accepterEchange(e.id), 'Proposition acceptée — en attente de validation admin.')}
                    >
                      Accepter
                    </button>
                  </>
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Gardes à reprendre (propositions ouvertes) ───── */}
      <section className="card" aria-label="Gardes ouvertes à reprendre">
        <div className="card-head">
          <h2>Gardes à reprendre</h2>
          {ouvertes.length > 0 && <span className="section-count">{ouvertes.length}</span>}
          <p className="sub">
            Proposées à toute l’équipe : première arrivée, première servie. Reprendre une garde
            envoie l’échange en validation admin.
          </p>
        </div>
        {ouvertes.length === 0 ? (
          <p className="empty-row">Aucune garde ouverte à la reprise.</p>
        ) : (
          <ul className="rows">
            {ouvertes.map((e) => (
              <Ligne
                key={e.id}
                e={e}
                actions={
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={isPending}
                    onClick={() => lancer(() => accepterEchange(e.id), 'C’est noté — en attente de validation admin.')}
                  >
                    Je la prends
                  </button>
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Mes demandes — la carte qui porte le bouton ──── */}
      <section className="card" aria-label="Mes demandes d’échange">
        <div className="card-head">
          <h2>Mes demandes</h2>
          {mesDemandes.length > 0 && <span className="section-count">{mesDemandes.length}</span>}
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={() => setProposerOuvert(true)}
          >
            + Proposer un échange
          </button>
          <p className="sub">
            Les gardes que tu as proposées, tant que le cycle n’est pas terminé. Tu peux annuler
            tant que l’échange n’est pas appliqué.
          </p>
        </div>
        {mesDemandes.length === 0 ? (
          <p className="empty-row">
            Aucune demande en cours. Propose une de tes gardes avec le bouton ci-dessus.
          </p>
        ) : (
          <ul className="rows">
            {mesDemandes.map((e) => (
              <Ligne
                key={e.id}
                e={e}
                actions={
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={isPending}
                    onClick={() => setAnnulationEnCours(e.id)}
                  >
                    Annuler
                  </button>
                }
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Historique ───────────────────────────────────── */}
      {historique.length > 0 && (
        <section className="card" aria-label="Historique des échanges">
          <div className="card-head">
            <h2>Historique</h2>
            <p className="sub">
              Tous les échanges terminés, avec leur motif quand il y en a un. Rien ne s’efface :
              c’est la mémoire du cabinet.
            </p>
          </div>
          <ul className="rows">
            {historique.map((e) => <Ligne key={e.id} e={e} />)}
          </ul>
        </section>
      )}

      {/* ── Les dialogues du produit ─────────────────────── */}
      <ProposerEchangeDialog
        open={proposerOuvert}
        onClose={() => setProposerOuvert(false)}
        moiId={moiId}
        gardesFutures={gardesFutures}
        vets={vets}
        onDone={() => { setProposerOuvert(false); router.refresh() }}
      />

      {/* Refus avec motif (confrère OU admin) */}
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
            <Label htmlFor="motif-refus-v2">Motif <span className="text-muted-foreground font-normal">(facultatif)</span></Label>
            <Textarea
              id="motif-refus-v2"
              placeholder="Ex : je suis déjà bien chargé cette semaine-là…"
              value={motifRefus}
              onChange={(ev) => setMotifRefus(ev.target.value)}
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
              {isPending ? 'En cours…' : (refusEnCours?.admin ? 'Refuser l’échange' : 'Décliner')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation d'annulation */}
      <Dialog open={annulationEnCours !== null} onOpenChange={(o) => { if (!o && !isPending) setAnnulationEnCours(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Annuler ta demande d’échange ?</DialogTitle>
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
    </>
  )
}

// ── Dialogue de proposition ───────────────────────────────
// Repris à l'identique de la V1 : mêmes champs, mêmes conditions d'envoi,
// même appel à `proposerEchange`. Il rend dans la palette du terrier grâce
// au remappage des jetons shadcn (cf. `v2-terrier.css`).

interface ProposerProps {
  open: boolean
  onClose: () => void
  moiId: string
  gardesFutures: GardeLite[]
  vets: VetLite[]
  onDone: () => void
}

function ProposerEchangeDialog({ open, onClose, moiId, gardesFutures, vets, onDone }: ProposerProps) {
  const [isPending, startTransition] = useTransition()
  const [gardeId, setGardeId] = useState('')
  const [aTous, setATous] = useState(false)
  const [cibleId, setCibleId] = useState('')
  const [avecContrepartie, setAvecContrepartie] = useState(false)
  const [contrepartieId, setContrepartieId] = useState('')
  const [message, setMessage] = useState('')

  const mesGardes = useMemo(
    () => gardesFutures.filter((g) => g.premier_id === moiId || g.second_id === moiId),
    [gardesFutures, moiId],
  )
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
    `${dateGarde(g.date)} — ${typeLabel(g.type)} (${roleLabel(roleSur(g, vetId))})`

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
            L’échange ne sera appliqué qu’après son accord et la validation de l’administratrice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Ma garde à céder</Label>
            {mesGardes.length === 0 ? (
              <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
                Tu n’as aucune garde à venir sur un planning publié.
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
                Première arrivée, première servie — et forcément une cession simple (pas de garde en retour).
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
                  onChange={(ev) => { setAvecContrepartie(ev.target.checked); setContrepartieId('') }}
                />
                Je reprends une de ses gardes en échange
              </label>
              {avecContrepartie && (
                cibleId === '' ? (
                  <p className="text-xs text-muted-foreground">Choisis d’abord le confrère.</p>
                ) : gardesCible.length === 0 ? (
                  <p className="text-sm text-muted-foreground rounded-md border border-dashed p-3">
                    Ce confrère n’a aucune garde à venir sur un planning publié.
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
            <Label htmlFor="message-echange-v2">Message <span className="text-muted-foreground font-normal">(facultatif)</span></Label>
            <Textarea
              id="message-echange-v2"
              placeholder="Ex : j’ai un empêchement familial ce soir-là…"
              value={message}
              onChange={(ev) => setMessage(ev.target.value)}
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
