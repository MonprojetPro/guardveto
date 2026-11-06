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
// B-191 (06/11) — MiKL : « pourquoi je n'ai pas la fonction vider la cloche ?! ».
// La cloche avait été refaite depuis l'ancien code, sans ouvrir le kit cloche
// ni le module de foxeo-one. Ajouts : « Vider », la croix d'une notification,
// « Voir toutes » vers `/notifications`. La logique vit dans `useNotifications`
// et la liste dans `ListeNotificationsV2`, partagées avec cette page.
//
// ⚠️ LE TEMPS RÉEL SE PROUVE : `abonnerEnSignalantLesEchecs` lit le statut de
//    l'abonnement. Un abonnement qui échoue ne renvoie aucune erreur, il ne se
//    déclenche jamais — la cloche se figerait sans que rien ne le dise.
// ============================================================

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useNotifications } from '@/components/v2/useNotifications'
import { ListeNotificationsV2 } from '@/components/v2/ListeNotificationsV2'
import { chiffrePastille } from '@/lib/notifications/types'
import '@/styles/v2-cloche.css'

export function ClocheV2() {
  const notifs = useNotifications('cloche-v2')
  const { etat } = notifs
  const [ouvert, setOuvert] = useState(false)
  const racine = useRef<HTMLDivElement | null>(null)

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
          <ListeNotificationsV2 variante="cloche" {...notifs} avantOuverture={() => setOuvert(false)} />
          <div className="cl-pied">
            <Link href="/notifications" className="cl-action" onClick={() => setOuvert(false)}>
              Voir toutes mes notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
