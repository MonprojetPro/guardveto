'use server'

// ============================================================
// B-173 — « Mon agenda » : chacun règle son agenda Google personnel
// ============================================================
// Comme « Mes notifications », ces actions sont PERSONNELLES : aucune ne prend
// d'identifiant de personne en argument. Elles agissent sur l'agenda de la
// personne connectée, et d'elle seule — il n'existe aucun chemin, même buggé,
// pour régler l'agenda d'un collègue.
//
// Les tables sont fermées au navigateur (RLS sans policy) : on vérifie QUI est
// connecté avec sa session, puis on écrit avec la clé de service.
// ============================================================

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { resoudreIdentite } from '@/lib/identite'
import { programmerAgendaPerso } from '@/lib/agenda-perso/declencher'
import {
  agendaPersoOuvert,
  clientService,
  ligneDuMembre,
  type LigneAgendaPerso,
} from '@/lib/agenda-perso/rapprocher'
import type { ChoixJournees, Placement } from '@/lib/agenda-perso/planifier'

export type ResultatMonAgenda = { success: true } | { error: string }

const JOURNEES: readonly ChoixJournees[] = ['miennes', 'equipe', 'aucune']
const PLACEMENTS: readonly Placement[] = ['heures', 'haut']

/** La ligne de la personne connectée — ou la raison pour laquelle il n'y en a pas. */
async function maLigne(): Promise<{ ok: true; ligne: LigneAgendaPerso } | { ok: false; error: string }> {
  const supabase = await createClient()
  const r = await resoudreIdentite(supabase)
  if (!r.ok) return { ok: false, error: 'Session expirée. Reconnectez-vous.' }
  const identite = r.identite
  if (!identite.cabinetId) return { ok: false, error: 'Cabinet introuvable — réglage non enregistré.' }

  const admin = clientService()
  if (!(await agendaPersoOuvert(admin, identite.cabinetId))) {
    return { ok: false, error: 'L’agenda personnel n’est pas ouvert pour votre cabinet.' }
  }
  const membre = identite.genre === 'veto'
    ? { genre: 'veto' as const, id: identite.veto.id }
    : { genre: 'secretaire' as const, id: identite.secretaire.id }
  try {
    return { ok: true, ligne: await ligneDuMembre(admin, identite.cabinetId, membre) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Lecture impossible.' }
  }
}

async function ecrire(id: string, champs: Record<string, unknown>): Promise<ResultatMonAgenda> {
  const { error } = await clientService()
    .from('agendas_perso')
    .update({ ...champs, mis_a_jour_le: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Le réglage n’a pas pu être enregistré. Réessayez dans un instant.' }
  // Après la réponse : l'écran affiche « mise à jour en cours » tout de suite.
  programmerAgendaPerso(id)
  revalidatePath('/reglages/agenda')
  return { success: true }
}

/** Allume ou coupe l'envoi du planning dans Google Agenda. */
export async function basculerMonAgenda(actif: boolean): Promise<ResultatMonAgenda> {
  const m = await maLigne()
  if (!m.ok) return { error: m.error }
  return ecrire(m.ligne.id, { actif: actif === true })
}

/** Enregistre une personnalisation (toutes les combinaisons sont permises). */
export async function personnaliserMonAgenda(saisie: {
  journees: ChoixJournees
  placement: Placement
  mesGardes: boolean
  gardesAutres: boolean
}): Promise<ResultatMonAgenda> {
  // Le serveur refuse ce que l'écran ne propose pas : une porte retirée du
  // menu reste ouverte à qui forge l'appel.
  if (!JOURNEES.includes(saisie?.journees) || !PLACEMENTS.includes(saisie?.placement)) {
    return { error: 'Ce choix n’existe pas.' }
  }
  const m = await maLigne()
  if (!m.ok) return { error: m.error }
  return ecrire(m.ligne.id, {
    actif: true,
    personnalise: true,
    journees: saisie.journees,
    placement: saisie.placement,
    mes_gardes: saisie.mesGardes === true,
    gardes_autres: saisie.gardesAutres === true,
  })
}

/** Revient au mode par défaut (et l'agenda du cabinet est rendu). */
export async function revenirAuModeParDefaut(): Promise<ResultatMonAgenda> {
  const m = await maLigne()
  if (!m.ok) return { error: m.error }
  return ecrire(m.ligne.id, { personnalise: false })
}

/** Renvoie l'invitation Google (e-mail perdu, agenda jamais ajouté). */
export async function renvoyerInvitationAgenda(): Promise<ResultatMonAgenda> {
  const m = await maLigne()
  if (!m.ok) return { error: m.error }
  if (!m.ligne.google_calendar_id) return { error: 'Votre agenda n’a pas encore été créé : il le sera à la prochaine mise à jour.' }
  // Oublier l'adresse partagée fait repartager, avec l'e-mail de Google.
  return ecrire(m.ligne.id, { partage_email: null })
}
