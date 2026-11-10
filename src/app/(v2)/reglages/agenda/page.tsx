// ============================================================
// GUARDVETO V2 — Mon agenda (B-173)
// ============================================================
// Chaque membre reçoit son planning dans SON agenda Google, comme il le veut.
// Ouvert aux trois rôles, comme « Mes notifications » : c'est un réglage
// personnel, pas un réglage du cabinet. Maquette validée par MiKL le 03/11 :
// `docs/maquettes/B-181-mon-agenda.html` (B-181, remplace celle du 26/10).
//
// La page n'existe que là où la fonction est ouverte (`agenda_perso_ouvert`)
// et où le cabinet a un agenda Google : ailleurs, il n'y a rien à régler, et
// une page de réglages qui ne commande rien ferait croire le contraire.
//
// B-202 — là où l'onglet Réglages refondu est ouvert (chantier `reglages-v2`,
// bac à sable seul), ce réglage vit dans sa section « Pour moi » : l'adresse
// y renvoie, pour que les anciens liens mènent toujours au bon endroit.
// ============================================================

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import '@/styles/v2-reglages.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { MonAgendaV2 } from '@/components/v2/MonAgendaV2'
import { chargerDock } from '@/data/v2/dock'
import { chargerMonAgenda } from '@/data/v2/mesReglages'
import { exigerIdentite } from '@/lib/identite'
import { chantierOuvertPourLeCabinet } from '@/lib/produit/chantiers-serveur'

export const dynamic = 'force-dynamic'
// La mise à jour lancée à l'ouverture tourne après la réponse, dans cette
// exécution : une première synchro écrit plusieurs dizaines d'événements.
export const maxDuration = 300
export const metadata = { title: 'GuardVeto — Mon agenda' }

export default async function MonAgendaPage() {
  const supabase = await createClient()
  const identite = await exigerIdentite(supabase)

  if (await chantierOuvertPourLeCabinet(supabase, 'reglages-v2')) redirect('/reglages?section=moi')

  const donnees = await chargerMonAgenda(identite)
  if (!donnees) redirect('/accueil')

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
        <MonAgendaV2 {...donnees} />
      </div>
    </>
  )
}
