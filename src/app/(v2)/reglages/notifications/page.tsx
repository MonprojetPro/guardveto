// ============================================================
// GUARDVETO V2 — Mes notifications (B-134 lot 5c)
// ============================================================
// MiKL, le 26/09 : « faudrait prévoir un toggle pour ces demandes de réception
// de mail […] dans les réglages… prévoir aussi que ce soit le cas du côté des
// autres profils ».
//
// ── POURQUOI UN ÉCRAN À PART, ET PAS UNE CARTE DANS `/reglages` ─────────────
// `/reglages` est réservé aux administratrices — la page elle-même renvoie
// ailleurs tout autre rôle (`role_app !== 'admin'` → `/accueil`). Y poser les
// interrupteurs aurait livré la moitié de la demande : les vétérinaires, qui
// sont justement les premiers concernés (leurs congés, leurs gardes), n'y
// auraient jamais accédé.
//
// Cet écran-ci est donc ouvert aux TROIS rôles, et c'est ce qui rend l'entrée
// possible dans le dock pour les non-admins. `/reglages` y renvoie par une
// carte, pour que l'administratrice le trouve là où MiKL l'a demandé.
//
// ⚠️ CE QUE CET ÉCRAN NE RÈGLE PAS, ET LE DIT : la cloche. Couper un e-mail
//    réduit le bruit d'une boîte mail ; couper la cloche supprimerait
//    l'information. L'écran l'écrit noir sur blanc plutôt que de laisser
//    quelqu'un croire qu'il s'est rendu totalement injoignable.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import '@/styles/v2-reglages.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { MesNotificationsV2 } from '@/components/v2/MesNotificationsV2'
import { chargerDock } from '@/data/v2/dock'
import { exigerIdentite } from '@/lib/identite'
import {
  lireMesDesactivations,
  reglagesPourRole,
} from '@/lib/notifications-reglages'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GuardVeto — Mes notifications' }

export default async function MesNotificationsPage() {
  const supabase = await createClient()

  // Les trois rôles passent par là — c'est le sens de la demande. `exigerIdentite`
  // est le seul point du code qui sait répondre « qui est connecté » sans
  // supposer une fiche vétérinaire (B-017 : le secrétariat n'en a pas).
  const identite = await exigerIdentite(supabase)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const reglages = reglagesPourRole(identite.role)
  const desactivees = user ? await lireMesDesactivations(supabase, user.id) : []

  const dock = await chargerDock(supabase, { role_app: identite.role })

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2
          prenom={identite.genre === 'veto' ? identite.veto.prenom : identite.nomAffiche}
          estAdmin={identite.role === 'admin'}
          estSecretaire={identite.role === 'secretaire'}
          dock={dock}
        />
        <MesNotificationsV2
          reglages={reglages.map((r) => ({
            cle: r.cle,
            libelle: r.libelle,
            explication: r.explication,
            recoit: !desactivees.includes(r.cle),
          }))}
          role={identite.role}
        />
      </div>
    </>
  )
}
