// ============================================================
// GUARDVETO V2 — Les réglages personnels : ce qu'on charge pour « Pour moi »
// ============================================================
// Sortis des pages `/reglages/notifications` et `/reglages/agenda` le 10/11
// (B-202) : l'onglet Réglages refondu montre les deux dans sa section
// « Pour moi », et un réglage ne doit se charger que d'UNE façon — sinon les
// deux écrans finissent par ne plus dire la même chose.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Identite } from '@/lib/identite'
import { lireMesDesactivations, reglagesPourRole } from '@/lib/notifications-reglages'
import type { LigneReglage } from '@/components/v2/useReceptionEmails'
import type { DonneesMonAgenda } from '@/components/v2/MonAgendaCorps'
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
import { adresseDePartage, lienAjoutAgenda } from '@/lib/agenda-perso/adresse'
import { agendaDuCabinet } from '@/lib/sync-calendrier'
import { nomLisibleAgenda } from '@/lib/google-calendar'

/** Les e-mails que reçoit la personne connectée, un par ligne, avec son état. */
export async function chargerMesNotifications(
  supabase: SupabaseClient<any, any, any>,
  identite: Identite,
  userId: string | null,
): Promise<LigneReglage[]> {
  const reglages = reglagesPourRole(identite.role)
  const desactivees = userId ? await lireMesDesactivations(supabase, userId) : []
  return reglages.map((r) => ({
    cle: r.cle,
    libelle: r.libelle,
    explication: r.explication,
    recoit: !desactivees.includes(r.cle),
  }))
}

/**
 * « Mon agenda » de la personne connectée, ou `null` là où la fonction n'est
 * pas ouverte : sans elle, il n'y a rien à régler, et un réglage qui ne
 * commande rien ferait croire le contraire.
 *
 * ⚠️ EFFET DE BORD VOULU : une mise à jour en attente, ou un agenda jamais créé
 *    alors qu'il devrait l'être, est LANCÉE ici, plutôt que d'afficher un état
 *    qui ne bougera pas. Un verrou de plus de 10 minutes est celui d'une synchro
 *    coupée en route : il ne bloque pas la reprise. La page qui appelle doit
 *    donc porter `maxDuration = 300`.
 */
export async function chargerMonAgenda(identite: Identite): Promise<DonneesMonAgenda | null> {
  if (!identite.cabinetId) return null

  const admin = clientService()
  if (!(await agendaPersoOuvert(admin, identite.cabinetId))) return null

  const genre = identite.genre
  const membre = genre === 'veto'
    ? { genre: 'veto' as const, id: identite.veto.id }
    : { genre: 'secretaire' as const, id: identite.secretaire.id }
  const ligne = await ligneDuMembre(admin, identite.cabinetId, membre)

  const libre = verrouLibre(ligne)
  if (libre && (ligne.a_refaire || !!ligne.sync_depuis || (ligne.actif && !ligne.google_calendar_id))) {
    programmerAgendaPerso(ligne.id)
  }

  const email = emailPropre(genre === 'veto' ? identite.veto.email : identite.secretaire.email)
  const calCabinet = await agendaDuCabinet(admin, identite.cabinetId)
  const nomCabinet = (calCabinet ? await nomLisibleAgenda(calCabinet) : null) ?? 'l’agenda du cabinet'
  const prenom = genre === 'veto' ? identite.veto.prenom : identite.nomAffiche

  return {
    genre,
    reglages: reglagesDeLigne(ligne),
    etat: {
      agendaCree: !!ligne.google_calendar_id,
      email,
      compte: adresseDePartage(email),
      lienAjout: ligne.google_calendar_id ? lienAjoutAgenda(ligne.google_calendar_id) : null,
      invitationRecente: invitationRecente(ligne),
      partageCabinet: ligne.partage_cabinet,
      enCours: !libre || (!ligne.derniere_sync_le && ligne.actif),
      progressionFaite: ligne.progression_faite,
      progressionTotal: ligne.progression_total,
      derniereSyncLe: ligne.derniere_sync_le,
      derniereErreur: ligne.derniere_erreur,
    },
    nomAgenda: `GuardVeto — ${prenom || 'mon planning'}`,
    nomAgendaCabinet: nomCabinet,
  }
}
