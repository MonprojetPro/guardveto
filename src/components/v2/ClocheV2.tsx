'use client'

// ============================================================
// GUARDVETO V2 — La cloche des notifications (B-183, 03/11)
// ============================================================
// Disparue avec la V1 le 28/10 (B-176) : la base écrivait toujours des
// notifications, plus aucun écran ne les montrait. MiKL l'a découvert en
// recettant « Je prends la place » — l'administratrice n'était prévenue de rien.
//
// Kit retenu par MiKL (03/11) : compteur de non lues, mise à jour EN DIRECT,
// liste au clic, un clic = lue + ouvre l'écran concerné, « Tout marquer comme
// lu ». Pas de page d'historique, pas de plein écran téléphone.
//
// ⚠️ LE TEMPS RÉEL SE PROUVE : `abonnerEnSignalantLesEchecs` lit le statut de
//    l'abonnement. Un abonnement qui échoue ne renvoie aucune erreur, il ne se
//    déclenche jamais — la cloche se figerait sans que rien ne le dise.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { abonnerEnSignalantLesEchecs } from '@/lib/realtime/statut-abonnement'
import {
  lireNotifications,
  marquerNotificationLue,
  marquerToutesNotificationsLues,
} from '@/app/(v2)/cloche-actions'
import { chiffrePastille, lienInterne, tempsRelatif, type EtatCloche, type NotificationCloche } from '@/lib/notifications/types'
import '@/styles/v2-cloche.css'

export function ClocheV2() {
  const router = useRouter()
  const [etat, setEtat] = useState<EtatCloche>({ items: [], nbNonLues: 0, erreur: false })
  const [charge, setCharge] = useState(false)
  const [ouvert, setOuvert] = useState(false)
  const racine = useRef<HTMLDivElement | null>(null)
  const delai = useRef<ReturnType<typeof setTimeout> | null>(null)

  // La source de vérité est le serveur (RLS) : on relit plutôt que de deviner.
  const relire = useCallback(async () => {
    try {
      setEtat(await lireNotifications())
    } catch {
      setEtat((e) => ({ ...e, erreur: true }))
    } finally {
      setCharge(true)
    }
  }, [])

  // Première lecture au montage, hors du rendu (pas de mise à jour en cascade).
  useEffect(() => {
    const t = setTimeout(() => void relire(), 0)
    return () => clearTimeout(t)
  }, [relire])

  // Tout changement sur SES notifications (la RLS filtre) → relecture, groupée.
  useEffect(() => {
    const supabase = createClient()
    const canal = supabase.channel('cloche-v2')
    canal.on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
      if (delai.current) clearTimeout(delai.current)
      delai.current = setTimeout(() => void relire(), 500)
    })
    abonnerEnSignalantLesEchecs(canal, 'cloche : notifications')
    return () => {
      if (delai.current) clearTimeout(delai.current)
      void supabase.removeChannel(canal)
    }
  }, [relire])

  // Fermeture au clic dehors et à Échap.
  useEffect(() => {
    if (!ouvert) return
    const dehors = (e: PointerEvent) => {
      if (racine.current && !racine.current.contains(e.target as Node)) setOuvert(false)
    }
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false) }
    document.addEventListener('pointerdown', dehors)
    document.addEventListener('keydown', echap)
    return () => {
      document.removeEventListener('pointerdown', dehors)
      document.removeEventListener('keydown', echap)
    }
  }, [ouvert])

  async function ouvrir(n: NotificationCloche) {
    setOuvert(false)
    if (!n.lu) {
      setEtat((e) => ({
        ...e,
        items: e.items.map((i) => (i.id === n.id ? { ...i, lu: true } : i)),
        nbNonLues: Math.max(0, e.nbNonLues - 1),
      }))
      // Un échec remet la vérité du serveur à l'écran plutôt qu'un « lu » faux.
      if (!(await marquerNotificationLue(n.id))) void relire()
    }
    const lien = lienInterne(n.lien)
    if (lien) router.push(lien)
  }

  async function toutLire() {
    setEtat((e) => ({ ...e, items: e.items.map((i) => ({ ...i, lu: true })), nbNonLues: 0 }))
    if (!(await marquerToutesNotificationsLues())) void relire()
  }

  const pastille = chiffrePastille(etat.nbNonLues)

  return (
    <div className="ab-cloche" ref={racine}>
      <button
        type="button"
        className="cl-bouton"
        aria-haspopup="true"
        aria-expanded={ouvert}
        aria-label={etat.nbNonLues > 0 ? `Notifications, ${etat.nbNonLues} non lue${etat.nbNonLues > 1 ? 's' : ''}` : 'Notifications'}
        onClick={() => setOuvert((o) => !o)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6.3 16.6V11a5.7 5.7 0 0 1 11.4 0v5.6l1.6 1.9H4.7z" />
          <path d="M10 20.6a2.2 2.2 0 0 0 4 0" />
        </svg>
        {pastille && <span className="cl-pastille" aria-hidden="true">{pastille}</span>}
      </button>

      {ouvert && (
        <div className="cl-panneau" role="dialog" aria-label="Notifications">
          <div className="cl-tete">
            <span className="cl-titre">Notifications</span>
            {etat.nbNonLues > 0 && (
              <button type="button" className="cl-tout-lire" onClick={() => void toutLire()}>
                Tout marquer comme lu
              </button>
            )}
          </div>

          {etat.erreur ? (
            <p className="cl-vide">Les notifications n’ont pas pu être lues. Réessayez dans un instant.</p>
          ) : !charge ? (
            <p className="cl-vide">Un instant…</p>
          ) : etat.items.length === 0 ? (
            <p className="cl-vide">Aucune notification pour l’instant.</p>
          ) : (
            <ul className="cl-liste">
              {etat.items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`cl-item${n.lu ? '' : ' non-lu'}`} onClick={() => void ouvrir(n)}>
                    <span className="cl-point" aria-hidden="true" />
                    <span className="cl-corps">
                      <span className="cl-ligne">
                        <span className="cl-item-titre">{n.titre}</span>
                        <span className="cl-quand">{tempsRelatif(n.created_at)}</span>
                      </span>
                      <span className="cl-message">{n.message}</span>
                    </span>
                    {!n.lu && <span className="vh">non lue</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
