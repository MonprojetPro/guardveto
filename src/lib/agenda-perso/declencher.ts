// ============================================================
// GUARDVETO — B-173 : déclencher la mise à jour des agendas perso
// ============================================================
// Appelé après chaque écriture qui change ce qu'un agenda perso montre :
// publication, journée posée ou retirée, trames appliquées, absence qui retire
// des journées, garde modifiée ou échangée, planning retiré, horaires d'un
// créneau, fiche d'un membre, réglages « Mon agenda ».
//
// La mise à jour tourne APRÈS la réponse (`after`) : personne n'attend Google
// pour voir son écran se rafraîchir. Une synchro coupée en route reprend au
// passage suivant (chaque événement écrit est mémorisé aussitôt) ; la tâche de
// nuit `/api/cron/agendas-perso` rattrape ce qui aurait manqué.
//
// ⚠️ Ne lève JAMAIS : un agenda perso en panne ne doit pas faire échouer la
//    pose d'une journée ou une publication.
// ============================================================

import { after } from 'next/server'
import { clientService, rapprocherAgenda, rapprocherCabinet } from './rapprocher'

function lancer(travail: () => Promise<void>, quoi: string): void {
  const protege = async () => {
    try {
      await travail()
    } catch (e) {
      console.error(`[agenda-perso] ${quoi} :`, e instanceof Error ? e.message : e)
    }
  }
  try {
    after(protege)
  } catch {
    // Hors d'une requête (script, test) : `after` n'existe pas. On n'envoie
    // rien — mieux vaut une synchro manquée, rattrapée la nuit, qu'un appel
    // Google lancé depuis un test.
  }
}

/** Tous les agendas perso du cabinet. Sans effet si la fonction n'y est pas ouverte. */
export function programmerAgendasPerso(cabinetId: string | null | undefined): void {
  if (!cabinetId) return
  lancer(() => rapprocherCabinet(clientService(), cabinetId), `cabinet ${cabinetId}`)
}

/** Un seul agenda (réglage modifié par la personne). */
export function programmerAgendaPerso(agendaId: string): void {
  lancer(() => rapprocherAgenda(clientService(), agendaId), `agenda ${agendaId}`)
}
