'use client'

// GUARDVETO V2 — L'écran « Toutes mes notifications » (B-191).
// Même logique (`useNotifications`) et même liste que la cloche ; seul le
// canal temps réel diffère, la cloche de la barre étant montée en même temps.

import { useNotifications } from '@/components/v2/useNotifications'
import { ListeNotificationsV2 } from '@/components/v2/ListeNotificationsV2'
import '@/styles/v2-cloche.css'

export function ToutesNotificationsV2() {
  const notifs = useNotifications('notifications-page')
  return (
    <>
      <div className="page-head rise">
        <div>
          <h1>Toutes mes notifications</h1>
          <p className="lede">
            Retirer une notification ne la retire que pour vous. Les e-mails se règlent dans Réglages.
          </p>
        </div>
      </div>
      <section className="card cl-page rise rise-2" aria-label="Mes notifications">
        <ListeNotificationsV2 variante="page" {...notifs} />
      </section>
    </>
  )
}
