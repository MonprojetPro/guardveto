'use client'

// ============================================================
// GUARDVETO V2 — Publier : le contrôle final, puis le décollage
// ============================================================
// Demande MiKL du 2026-08-02 : « puis choisissent de publier, avec une autre
// pop-up qui apparaît et qui vérifie bien que tout est opérationnel, et publie
// avec toutes les automatisations qui vont avec ».
//
// Trois temps, dans une seule fenêtre :
//   ① CONTRÔLE  — ce qui est vérifié (le planning est rempli, les règles
//                 tiennent, aucun congé en attente), et ce que la publication
//                 va DÉCLENCHER. Rien n'est caché : les e-mails partent, les
//                 agendas se remplissent, l'équipe voit tout.
//   ② RÉSERVES  — le gate serveur a trouvé quelque chose. On le montre, et on
//                 laisse le choix : corriger d'abord, ou publier en connaissance
//                 de cause. (Comportement conservé de la V1 — c'est un garde-fou
//                 métier, pas du décor.)
//   ③ PUBLIÉ    — ce qui vient réellement de se passer. Un « c'est fait » qui
//                 énumère les automatisations plutôt qu'un toast qui s'efface.
// ============================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Send, CheckCircle2, AlertTriangle, Mail, CalendarCheck, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import type { ViolationRevalidation } from '@/components/planning/types-revalidation'
import type { Periode } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  periode: Periode | null
  /** Le planning a-t-il des gardes ? Sans elles, il n'y a rien à publier. */
  aDesGardes: boolean
}

type Etape = 'controle' | 'reserves' | 'publie'

export function DialogPublication({ open, onOpenChange, periode, aDesGardes }: Props) {
  const router = useRouter()
  const [etape, setEtape] = useState<Etape>('controle')
  const [enCours, setEnCours] = useState(false)
  const [violations, setViolations] = useState<ViolationRevalidation[]>([])
  const [souhaits, setSouhaits] = useState(0)

  function fermer(o: boolean) {
    if (enCours) return
    onOpenChange(o)
    if (!o) {
      setEtape('controle')
      setViolations([])
      setSouhaits(0)
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
      // Gate serveur : violations dures ou congés en attente → on montre les
      // réserves et on demande une confirmation explicite.
      if (data.requiresConfirmation) {
        setViolations((data.violations ?? []) as ViolationRevalidation[])
        setSouhaits(data.souhaitsEnAttente ?? 0)
        setEtape('reserves')
        return
      }
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
            Planning · publication
            {periode?.libelle && <span className="gp-fil"> · {periode.libelle}</span>}
          </p>
          <DialogTitle>
            {etape === 'controle' && 'Tout est prêt à partir ?'}
            {etape === 'reserves' && 'Des points méritent ton attention'}
            {etape === 'publie' && 'Le planning est publié'}
          </DialogTitle>
          <DialogDescription>
            {etape === 'controle' && 'Voilà ce que la publication va déclencher, tout de suite et automatiquement.'}
            {etape === 'reserves' && 'La vérification automatique du planning a relevé ceci avant de partir.'}
            {etape === 'publie' && 'Voilà ce qui vient de se passer.'}
          </DialogDescription>
        </DialogHeader>

        {/* ── ① Le contrôle ─────────────────────────────── */}
        {etape === 'controle' && (
          <div className="gp-controle">
            <div className={aDesGardes ? 'gp-feu-vert' : 'gv-alerte danger'}>
              {aDesGardes ? (
                <>
                  <CheckCircle2 className="gp-feu-ico" aria-hidden />
                  <div>
                    <p className="gp-feu-titre">Le planning est rempli</p>
                    <p className="gp-feu-sous">
                      Il passera de <strong>brouillon</strong> à <strong>publié</strong> :
                      c’est ce moment qui le rend officiel pour le cabinet.
                    </p>
                  </div>
                </>
              ) : (
                <div className="gva-tete">
                  <AlertTriangle className="gva-ico" aria-hidden />
                  <div className="gva-titres">
                    <p className="gva-titre">Ce planning n’a aucune garde</p>
                    <p className="gva-sous">Génère-le d’abord — il n’y a rien à publier.</p>
                  </div>
                </div>
              )}
            </div>

            <ul className="gp-automatisations">
              <li>
                <Eye className="gp-auto-ico" aria-hidden />
                <span>
                  <strong>Toute l’équipe voit le planning</strong> — chacun y trouve ses gardes,
                  sur ordinateur comme sur téléphone.
                </span>
              </li>
              <li>
                <Mail className="gp-auto-ico" aria-hidden />
                <span>
                  <strong>Les e-mails de notification partent</strong> aux vétérinaires concernés.
                </span>
              </li>
              <li>
                <CalendarCheck className="gp-auto-ico" aria-hidden />
                <span>
                  <strong>Les agendas Google se remplissent</strong> avec les gardes de chacun.
                </span>
              </li>
            </ul>

            <p className="gp-note">
              Tu pourras toujours modifier une garde ensuite : les compteurs et les agendas
              suivront tout seuls.
            </p>
          </div>
        )}

        {/* ── ② Les réserves du gate serveur ────────────── */}
        {etape === 'reserves' && (
          <div className="gp-controle">
            {violations.length > 0 && (
              <div className="gf-card dure">
                <p className="gf-title">
                  {violations.length} règle{violations.length > 1 ? 's' : ''} non respectée{violations.length > 1 ? 's' : ''}
                </p>
                <ul className="space-y-1 list-disc pl-5">
                  {violations.slice(0, 6).map((v, i) => (
                    <li key={i}>
                      <span className="font-medium">{v.date}</span> — {v.detail}
                    </li>
                  ))}
                  {violations.length > 6 && (
                    <li className="list-none opacity-80">
                      … et {violations.length - 6} autre{violations.length - 6 > 1 ? 's' : ''}.
                    </li>
                  )}
                </ul>
              </div>
            )}
            {souhaits > 0 && (
              <div className="gf-card souple">
                <span className="font-medium">
                  {souhaits} demande{souhaits > 1 ? 's' : ''} de congé en attente
                </span>{' '}
                chevauche{souhaits > 1 ? 'nt' : ''} ce planning — traite-la{souhaits > 1 ? 's' : ''} d’abord
                si tu veux qu’elle{souhaits > 1 ? 's' : ''} soi{souhaits > 1 ? 'ent' : 't'} prise{souhaits > 1 ? 's' : ''} en compte.
              </div>
            )}
            <p className="gp-note">
              Tu peux corriger d’abord, ou publier quand même en connaissance de cause.
            </p>
          </div>
        )}

        {/* ── ③ C'est fait ──────────────────────────────── */}
        {etape === 'publie' && (
          <div className="gp-controle">
            <div className="gp-feu-vert">
              <CheckCircle2 className="gp-feu-ico" aria-hidden />
              <div>
                <p className="gp-feu-titre">C’est officiel</p>
                <p className="gp-feu-sous">Le cabinet a son planning.</p>
              </div>
            </div>
            <ul className="gp-automatisations fait">
              <li><Eye className="gp-auto-ico" aria-hidden /><span>L’équipe y a accès.</span></li>
              <li><Mail className="gp-auto-ico" aria-hidden /><span>Les e-mails sont partis.</span></li>
              <li><CalendarCheck className="gp-auto-ico" aria-hidden /><span>Les agendas sont synchronisés.</span></li>
            </ul>
            <p className="gp-note">
              Une garde à changer ? Clique sur sa case : le planning reste modifiable, et
              tout le monde est prévenu automatiquement.
            </p>
          </div>
        )}

        <DialogFooter>
          {etape === 'controle' && (
            <>
              <Button variant="outline" onClick={() => fermer(false)} disabled={enCours}>
                Pas maintenant
              </Button>
              <Button onClick={() => publier(false)} disabled={enCours || !aDesGardes}>
                {enCours ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                {enCours ? 'Publication…' : 'Publier le planning'}
              </Button>
            </>
          )}
          {etape === 'reserves' && (
            <>
              <Button variant="outline" onClick={() => fermer(false)} disabled={enCours}>
                Corriger d’abord
              </Button>
              <Button onClick={() => publier(true)} disabled={enCours}>
                {enCours ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                Publier quand même
              </Button>
            </>
          )}
          {etape === 'publie' && (
            <Button onClick={() => fermer(false)}>Voir le planning</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
