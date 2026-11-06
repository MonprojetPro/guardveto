// ============================================================
// GUARDVETO V2 — Toutes mes notifications (B-191, 06/11)
// ============================================================
// Le « Voir toutes » de la cloche : tout l'historique au-delà des 30 dernières,
// avec les mêmes gestes (lire, retirer, vider) — même composant que la cloche.
//
// Le secrétariat n'a pas de cloche (aucune notification ne lui est adressée :
// la table vise les vétérinaires, B-017) : il est renvoyé à l'accueil plutôt
// que de voir une liste vide qui se lirait « rien de neuf ».
// ============================================================

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import '@/styles/v2-reglages.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { ToutesNotificationsV2 } from '@/components/v2/ToutesNotificationsV2'
import { chargerDock } from '@/data/v2/dock'
import { exigerIdentite } from '@/lib/identite'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GuardVeto — Toutes mes notifications' }

export default async function ToutesNotificationsPage() {
  const supabase = await createClient()
  const identite = await exigerIdentite(supabase)
  if (identite.role === 'secretaire') redirect('/accueil')

  const dock = await chargerDock(supabase, { role_app: identite.role })

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2
          prenom={identite.veto.prenom}
          estAdmin={identite.role === 'admin'}
          estSecretaire={false}
          dock={dock}
        />
        <ToutesNotificationsV2 />
      </div>
    </>
  )
}
