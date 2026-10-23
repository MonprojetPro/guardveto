'use client'

// ============================================================
// GUARDVETO — « Publier à l'équipe », VERSION CHANTIER (B-172)
// ============================================================
// MiKL, 23/10 : « je trouve que ce n'est pas clair et que ça va porter à
// confusion auprès des clients ».
//
// 🔴 CE QUE L'ORIGINAL TAISAIT. `v2/DialogPublication` annonçait « Le planning
//    est rempli » en ne regardant que les GARDES. Or la publication diffuse
//    aussi les JOURNÉES rattachées au planning (le filtre de diffusion lit
//    `publie_at`, pour les deux) : en publiant Hiver P2 au bac à sable, 223
//    présences devenaient visibles d'un coup sans qu'une ligne le dise. Et un
//    planning de journées seules ne pouvait pas être publié du tout.
//
// Cette version annonce ce qui part, OBJET PAR OBJET, avec le nombre lu en
// base (`contenuPeriode`, chargé par la page) — jamais un « c'est rempli »
// supposé. Elle dit aussi ce qui NE part PAS : e-mails et agendas ne portent
// que les gardes.
//
// ⚠️ Copie assumée sous `chantier/` (convention `chantier-restreint.test.ts`) :
//    l'original reste celui du client tant que le chantier n'est pas ouvert
//    à tous. Le gate serveur, lui, est le même — rien n'est dupliqué côté règle.
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Send, CheckCircle2, AlertTriangle, Mail, CalendarCheck, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { CartesViolations } from '@/components/planning/CartesViolations'
import type { ViolationRevalidation } from '@/components/planning/types-revalidation'
import { nomPeriode } from '@/lib/periodes/libelle'
import { periodeFr } from '@/lib/dates-fr'
import type { Periode } from '@/types'

/** Ce que contient le planning, lu en base. `null` = lecture impossible. */
export interface ContenuPeriode {
  gardes: number | null
  presences: number | null
  /**
   * B-172c — les présences posées sur CES dates mais rattachées à un AUTRE
   * planning (chevauchement journées / gardes). Elles partent avec lui, pas
   * avec celui-ci. `null` = lecture impossible ; absent = non chargé.
   */
  ailleurs?: { libelle: string; nb: number }[] | null
}

/** « 25 présences portées par Hiver P2 », ou null s'il n'y a rien ailleurs. */
export function phraseAilleurs(contenu: ContenuPeriode | null): string | null {
  const a = contenu?.ailleurs ?? []
  if (a.length === 0) return null
  const total = a.reduce((s, x) => s + x.nb, 0)
  const qui = a.map((x) => x.libelle).join(', ')
  return `${total} présence${total > 1 ? 's' : ''} portée${total > 1 ? 's' : ''} par ${qui}`
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  periode: Periode | null
  contenu: ContenuPeriode | null
  /** Le cabinet a-t-il le module journées ? Sinon on n'en parle pas. */
  avecJournees: boolean
}

type Etape = 'controle' | 'reserves' | 'publie'

function pluriel(n: number, un: string, plusieurs: string) {
  return `${n} ${n > 1 ? plusieurs : un}`
}

/** Une ligne du « ce qui part ». */
function Objet({ n, un, plusieurs, aucun }: { n: number | null; un: string; plusieurs: string; aucun: string }) {
  if (n === null) {
    return (
      <li className="pbc-objet inconnu">
        <AlertTriangle className="pbc-ico" aria-hidden />
        <span>{plusieurs.charAt(0).toUpperCase() + plusieurs.slice(1)} : nombre illisible pour l’instant</span>
      </li>
    )
  }
  return (
    <li className={`pbc-objet${n > 0 ? '' : ' absent'}`}>
      {n > 0 ? <CheckCircle2 className="pbc-ico" aria-hidden /> : <span className="pbc-ico vide" aria-hidden />}
      <span>{n > 0 ? pluriel(n, un, plusieurs) : aucun}</span>
    </li>
  )
}

export function DialogPublicationChantier({ open, onOpenChange, periode, contenu, avecJournees }: Props) {
  const router = useRouter()
  const [etape, setEtape] = useState<Etape>('controle')
  const [enCours, setEnCours] = useState(false)
  const [violations, setViolations] = useState<ViolationRevalidation[]>([])
  const [souhaits, setSouhaits] = useState(0)
  const [cases, setCases] = useState<{ date: string; type: string; role: string }[]>([])
  const [journeesSeules, setJourneesSeules] = useState(false)

  const nbGardes = contenu?.gardes ?? null
  const nbPresences = contenu?.presences ?? null
  // Lecture impossible : on ne prétend pas que c'est vide — le serveur
  // tranchera, il relit tout de toute façon.
  const vide = nbGardes === 0 && (nbPresences ?? 0) === 0
  const sansGardes = nbGardes === 0 && (nbPresences ?? 0) > 0

  function fermer(o: boolean) {
    if (enCours) return
    onOpenChange(o)
    if (!o) {
      setEtape('controle')
      setViolations([])
      setSouhaits(0)
      setCases([])
      setJourneesSeules(false)
    }
  }

  async function publier(confirmAvecReserves: boolean) {
    if (!periode) return
    setEnCours(true)
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodeId: periode.id, confirmAvecReserves }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Erreur lors de la publication.')
        return
      }
      if (data.requiresConfirmation) {
        setViolations((data.violations ?? []) as ViolationRevalidation[])
        setSouhaits(data.souhaitsEnAttente ?? 0)
        setCases((data.casesAPourvoir ?? []) as { date: string; type: string; role: string }[])
        setEtape('reserves')
        return
      }
      setJourneesSeules(data.journeesSeules === true)
      setEtape('publie')
      router.refresh()
    } catch {
      toast.error('Impossible de joindre le serveur.')
    } finally {
      setEnCours(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={fermer}>
      <DialogContent className="gv-modale gv-parcours">
        <DialogHeader>
          <p className="gm-kicker">
            {periode ? `${nomPeriode(periode)} · ${periodeFr(periode.date_debut, periode.date_fin)}` : 'Planning'}
          </p>
          <DialogTitle>
            {etape === 'controle' && 'Publier à l’équipe ?'}
            {etape === 'reserves' && 'Des points méritent ton attention'}
            {etape === 'publie' && 'Le planning est publié'}
          </DialogTitle>
          <DialogDescription>
            {etape === 'controle' && 'Voici ce qui part, et ce que ça déclenche.'}
            {etape === 'reserves' && 'La vérification automatique a relevé ceci avant de partir.'}
            {etape === 'publie' && 'Voilà ce qui vient de se passer.'}
          </DialogDescription>
        </DialogHeader>

        {etape === 'controle' && (
          <div className="gp-controle">
            {vide ? (
              <div className="gv-alerte danger">
                <div className="gva-tete">
                  <AlertTriangle className="gva-ico" aria-hidden />
                  <div className="gva-titres">
                    {/* B-172c — « vide » mentait à moitié quand les jours sont
                        couverts par un AUTRE planning : on dit où sont les
                        journées, et avec quoi elles partent. */}
                    {phraseAilleurs(contenu) ? (
                      <>
                        <p className="gva-titre">Rien à publier sur ce planning</p>
                        <p className="gva-sous">
                          Ses jours sont déjà couverts : {phraseAilleurs(contenu)}.{' '}
                          {contenu?.ailleurs?.length === 1
                            ? 'Elles partiront avec lui, à sa publication.'
                            : 'Elles partiront avec eux, à leur publication.'}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="gva-titre">Ce planning est vide</p>
                        <p className="gva-sous">
                          Ni garde ni journée : il n’y a rien à publier. Remplis-le d’abord.
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <ul className="pbc-objets">
                <Objet n={nbGardes} un="garde" plusieurs="gardes" aucun="Aucune garde" />
                {avecJournees && (
                  <Objet
                    n={nbPresences}
                    un="présence de journée"
                    plusieurs="présences de journée"
                    aucun="Aucune journée"
                  />
                )}
              </ul>
            )}

            {!vide && phraseAilleurs(contenu) && (
              <p className="gp-note">
                Sur ces dates, aussi : {phraseAilleurs(contenu)}. Elles ne partent pas avec
                ce planning-ci.
              </p>
            )}

            {!vide && (
              <ul className="gp-automatisations">
                <li>
                  <Eye className="gp-auto-ico" aria-hidden />
                  <span>
                    <strong>Toute l’équipe voit le planning</strong>
                    {avecJournees ? ', ses gardes et ses journées' : ''}, sur ordinateur comme sur téléphone.
                  </span>
                </li>
                {sansGardes ? (
                  <li>
                    <Mail className="gp-auto-ico" aria-hidden />
                    <span>
                      <strong>Aucun e-mail, aucun agenda</strong> : ils ne portent que les gardes,
                      et ce planning n’en a pas.
                    </span>
                  </li>
                ) : (
                  <>
                    <li>
                      <Mail className="gp-auto-ico" aria-hidden />
                      <span>
                        <strong>Les vétérinaires reçoivent un e-mail</strong> avec leurs gardes.
                      </span>
                    </li>
                    <li>
                      <CalendarCheck className="gp-auto-ico" aria-hidden />
                      <span>
                        <strong>Les agendas Google se remplissent</strong> avec les gardes
                        {avecJournees ? ' (les journées restent dans l’application)' : ''}.
                      </span>
                    </li>
                  </>
                )}
              </ul>
            )}

            <p className="gp-note">
              Tu pourras toujours modifier ensuite : l’équipe est prévenue des changements.
            </p>
          </div>
        )}

        {etape === 'reserves' && (
          <div className="gp-controle">
            {cases.length > 0 && (
              <div className="gf-card dure">
                <p className="font-medium">
                  {cases.length === 1 ? '1 garde n’a encore personne' : `${cases.length} gardes n’ont encore personne`}
                </p>
                <ul className="gp-cases">
                  {cases.slice(0, 6).map((c, i) => (
                    <li key={`${c.date}-${c.role}-${i}`}>
                      {new Date(c.date + 'T12:00:00Z').toLocaleDateString('fr-FR', {
                        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
                      })}{' '}
                      — {c.role === 'premier' ? '1er' : c.role === 'second' ? '2e' : c.role}
                    </li>
                  ))}
                  {cases.length > 6 && <li>…et {cases.length - 6} autre{cases.length - 6 > 1 ? 's' : ''}</li>}
                </ul>
                <p className="gp-note">
                  Tu peux publier quand même : l’équipe verra la case vide, et tu pourras la
                  compléter après coup.
                </p>
              </div>
            )}
            {violations.length > 0 && <CartesViolations violations={violations} />}
            {souhaits > 0 && (
              <div className="gf-card souple">
                <span className="font-medium">
                  {pluriel(souhaits, 'demande de congé en attente', 'demandes de congé en attente')}
                </span>{' '}
                sur ces dates — traite-les d’abord si tu veux qu’elles soient prises en compte.
              </div>
            )}
            <p className="gp-note">Tu peux régler d’abord, ou publier quand même en connaissance de cause.</p>
          </div>
        )}

        {etape === 'publie' && (
          <div className="gp-controle">
            <div className="gp-feu-vert">
              <CheckCircle2 className="gp-feu-ico" aria-hidden />
              <div>
                <p className="gp-feu-titre">C’est officiel</p>
                <p className="gp-feu-sous">L’équipe a son planning.</p>
              </div>
            </div>
            <ul className="gp-automatisations fait">
              <li><Eye className="gp-auto-ico" aria-hidden /><span>L’équipe y a accès.</span></li>
              {journeesSeules ? (
                <li><Mail className="gp-auto-ico" aria-hidden /><span>Aucun e-mail ni agenda : il n’y avait pas de garde.</span></li>
              ) : (
                <>
                  <li><Mail className="gp-auto-ico" aria-hidden /><span>Les e-mails sont partis.</span></li>
                  <li><CalendarCheck className="gp-auto-ico" aria-hidden /><span>Les agendas sont synchronisés.</span></li>
                </>
              )}
            </ul>
          </div>
        )}

        <DialogFooter>
          {etape === 'controle' && (
            <>
              <Button variant="outline" onClick={() => fermer(false)} disabled={enCours}>
                Pas maintenant
              </Button>
              <Button onClick={() => publier(false)} disabled={enCours || vide}>
                {enCours ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {enCours ? 'Publication…' : 'Publier'}
              </Button>
            </>
          )}
          {etape === 'reserves' && (
            <>
              <Button variant="outline" onClick={() => fermer(false)} disabled={enCours}>
                Régler d’abord
              </Button>
              <Button onClick={() => publier(true)} disabled={enCours}>
                {enCours ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                Publier quand même
              </Button>
            </>
          )}
          {etape === 'publie' && <Button onClick={() => fermer(false)}>Voir le planning</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
