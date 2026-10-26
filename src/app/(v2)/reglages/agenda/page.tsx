// ============================================================
// GUARDVETO V2 — Mon agenda (B-173)
// ============================================================
// Chaque membre reçoit son planning dans SON agenda Google, comme il le veut.
// Ouvert aux trois rôles, comme « Mes notifications » : c'est un réglage
// personnel, pas un réglage du cabinet. Maquette validée par MiKL le 26/10 :
// `docs/maquettes/B-173-mon-agenda.html`.
//
// La page n'existe que là où la fonction est ouverte (`agenda_perso_ouvert`)
// et où le cabinet a un agenda Google : ailleurs, il n'y a rien à régler, et
// une page de réglages qui ne commande rien ferait croire le contraire.
// ============================================================

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import '@/styles/v2-reglages.css'
import { Satin } from '@/components/v2/Satin'
import { BarreV2 } from '@/components/v2/BarreV2'
import { MonAgendaV2 } from '@/components/v2/MonAgendaV2'
import { chargerDock } from '@/data/v2/dock'
import { exigerIdentite } from '@/lib/identite'
import {
  agendaPersoOuvert,
  clientService,
  emailPropre,
  invitationRecente,
  ligneDuMembre,
  reglagesDeLigne,
  verrouLibre,
} from '@/lib/agenda-perso/rapprocher'
import { programmerAgendaPerso } from '@/lib/agenda-perso/declencher'
import { agendaDuCabinet } from '@/lib/sync-calendrier'
import { nomLisibleAgenda } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'
// La mise à jour lancée à l'ouverture tourne après la réponse, dans cette
// exécution : une première synchro écrit plusieurs dizaines d'événements.
export const maxDuration = 300
export const metadata = { title: 'GuardVeto — Mon agenda' }

export default async function MonAgendaPage() {
  const supabase = await createClient()
  const identite = await exigerIdentite(supabase)
  if (!identite.cabinetId) redirect('/accueil')

  const admin = clientService()
  if (!(await agendaPersoOuvert(admin, identite.cabinetId))) redirect('/accueil')

  const genre = identite.genre
  const membre = genre === 'veto'
    ? { genre: 'veto' as const, id: identite.veto.id }
    : { genre: 'secretaire' as const, id: identite.secretaire.id }
  const ligne = await ligneDuMembre(admin, identite.cabinetId, membre)

  // Une mise à jour en attente, ou un agenda jamais créé alors qu'il devrait
  // l'être : on la lance, plutôt que d'afficher un état qui ne bougera pas.
  // Un verrou de plus de 10 minutes est celui d'une synchro coupée en route
  // (délai serveur dépassé) : il ne doit pas bloquer la reprise.
  const libre = verrouLibre(ligne)
  if (libre && (ligne.a_refaire || !!ligne.sync_depuis || (ligne.actif && !ligne.google_calendar_id))) {
    programmerAgendaPerso(ligne.id)
  }

  const email = emailPropre(genre === 'veto' ? identite.veto.email : identite.secretaire.email)
  const calCabinet = await agendaDuCabinet(admin, identite.cabinetId)
  const nomCabinet = (calCabinet ? await nomLisibleAgenda(calCabinet) : null) ?? 'l’agenda du cabinet'
  const dock = await chargerDock(supabase, { role_app: identite.role })

  return (
    <>
      <Satin />
      <div className="shell">
        <BarreV2
          prenom={genre === 'veto' ? identite.veto.prenom : identite.nomAffiche}
          estAdmin={identite.role === 'admin'}
          estSecretaire={identite.role === 'secretaire'}
          dock={dock}
        />
        <MonAgendaV2
          genre={genre}
          reglages={reglagesDeLigne(ligne)}
          etat={{
            agendaCree: !!ligne.google_calendar_id,
            email,
            invitationRecente: invitationRecente(ligne),
            partageCabinet: ligne.partage_cabinet,
            enCours: !libre || (!ligne.derniere_sync_le && ligne.actif),
            progressionFaite: ligne.progression_faite,
            progressionTotal: ligne.progression_total,
            derniereSyncLe: ligne.derniere_sync_le,
            derniereErreur: ligne.derniere_erreur,
          }}
          nomAgendaCabinet={nomCabinet}
        />
      </div>
    </>
  )
}
