// ============================================================
// GUARDVETO V2 — Planning de la journée (chantier 2 : les tranches horaires)
// ============================================================
// B-120 chantier 2. PREMIER ÉCRAN D'UN MODULE ÉTEIGNABLE du produit.
//
// Trois choses se jouent ici, et aucune n'est cosmétique :
//
// ① LE MODULE. Si `planning-journee` est éteint pour ce cabinet, l'écran dit
//    la vérité au lieu de rendre un 404 (B-120a ②). Vérifié en base le
//    01/10 : seul « Démo MonProjetPro » l'a allumé ; Val d'Allier ne verra
//    donc que le message, et c'est exactement le rollout voulu (décision ⑨).
//
// ② L'ADMIN. Cet écran est de la CONFIGURATION de cabinet : il se règle une
//    fois et vaut pour tout le monde. Un vétérinaire n'a rien à y faire — mais
//    il DOIT pouvoir lire ces tranches, parce qu'elles composeront son
//    planning : c'est pourquoi la RLS en ouvre la LECTURE à tout le cabinet
//    alors que cet écran-ci est réservé. La grille du chantier 3 s'appuiera
//    sur cette lecture-là.
//
// ③ LA PORTE. Ce refus-ci est un refus SERVEUR, pas un masquage de menu. Le
//    dock cache l'entrée en plus, par confort — « une porte retirée du menu
//    reste ouverte à qui connaît l'adresse ».
//
// Le module est volontairement vérifié AVANT le rôle : sur un cabinet qui n'a
// pas cette capacité, même l'administratrice n'a pas à voir un écran de
// configuration — elle verrait un réglage qu'elle ne peut pas obtenir.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { exigerVeterinaire } from '@/lib/identite'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { BlocsJournee } from '@/components/v2/BlocsJournee'
import { ModuleEteint } from '@/components/v2/ModuleEteint'
import { modulesDuCabinet } from '@/lib/produit/modules-serveur'
import { chargerDock } from '@/data/v2/dock'
import type { BlocJournee, Veterinaire } from '@/types'
import '@/styles/v2-journee.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GuardVeto — Journée' }

const MODULE = 'planning-journee'

export default async function JourneePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { veto: moi } = await exigerVeterinaire(supabase)
  const vet = moi as Veterinaire
  const estAdmin = vet.role_app === 'admin'

  const dock = await chargerDock(supabase, vet)
  const modules = await modulesDuCabinet(supabase)

  // ① Le module, avant tout le reste.
  if (!modules.includes(MODULE)) {
    return (
      <>
        <Satin />
        <div className="shell">
          <BarreV2 prenom={vet.prenom} estAdmin={estAdmin} dock={dock} />
          <ModuleEteint module={MODULE} estAdmin={estAdmin} />
        </div>
      </>
    )
  }

  // ② Le rôle. Les vétérinaires liront les tranches sur la grille du chantier
  //    3 ; ici, il n'y a que des commandes de configuration.
  if (!estAdmin) redirect('/accueil')

  // La RLS borne au cabinet (policy RESTRICTIVE) : pas de `.eq('cabinet_id')`
  // à ajouter ici. On lit TOUT, actif ou non — l'écran range lui-même les
  // tranches retirées dans leur section, et les masquer ici aurait rendu la
  // remise en service impossible depuis l'interface.
  const { data } = await supabase
    .from('blocs_journee')
    .select('id, cabinet_id, nom, debut, fin, creneau, ordre, actif')
    .order('ordre', { ascending: true })

  const blocs = (data ?? []) as BlocJournee[]

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2 prenom={vet.prenom} estAdmin={estAdmin} dock={dock} />
        <BlocsJournee blocs={blocs} />
      </div>
    </>
  )
}
