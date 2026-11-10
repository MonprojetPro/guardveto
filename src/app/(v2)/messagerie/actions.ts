'use server'

// ============================================================
// GUARDVETO V2 — Les gestes de la messagerie (B-193)
// ============================================================
// ⚠️ L'AUTORITE EST EN BASE (migration 20261106120000) : qui lit quoi, qui
//    ecrit ou, l'auteur et son nom, le module allume. Ce fichier ne fait que
//    deux choses de plus : ① refuser tot, avec un message en francais, ce que
//    la base refuserait en anglais ; ② ne JAMAIS croire le client sur les
//    chemins de pieces jointes (deux gardiens : celui-ci dit pourquoi, la
//    policy du bucket dit non).
//
// Chaque action commence par `exigerModule(…, 'chat')` : un module eteint
// refuse au serveur, pas seulement a l'ecran.
//
// Aucune action n'ecrit de notification : c'est le trigger
// `messagerie_apres_insertion` qui le fait, sous une identite qui en a le
// droit. Ecrite d'ici, elle tournerait sous l'identite de l'EXPEDITEUR et la
// RLS la refuserait en silence (lecon du 26/09, « un envoi tourne sous
// l'identite du declencheur »).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { exigerModule, ModuleEteintError } from '@/lib/produit/modules-serveur'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import {
  BUCKET_MESSAGERIE,
  COLONNES_MESSAGE,
  cheminDansConversation,
  estUuid,
  refusMessage,
  refusPiece,
  versMessage,
  type ConversationListe,
  type MessageFil,
  type PieceMessage,
  type RangeeMessage,
} from '@/lib/messagerie/regles'
import { sendBrevoEmail } from '@/lib/brevo'
import { adresseUtilisable } from '@/lib/emails/destinataire'
import { adresseProduit, corpsMailMessage, sujetMailMessage } from '@/lib/emails/message'

type Resultat<T> = ({ ok: true } & T) | { ok: false; error: string }

/** Au-delà, ce n'est plus un message : c'est un publipostage. */
const MAILS_MAX_PAR_MESSAGE = 40

type Client = Awaited<ReturnType<typeof createClient>>

/** Le client, une fois le module verifie. Rend un message lisible sinon. */
async function ouvrir(): Promise<{ supabase: Client } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Vous n’êtes plus connecté. Rechargez la page.' }
  try {
    await exigerModule(supabase, 'chat')
  } catch (e) {
    if (e instanceof ModuleEteintError) return { error: e.message }
    return { error: 'Je n’arrive pas à vérifier vos accès pour le moment. Réessayez.' }
  }
  return { supabase }
}

/**
 * Traduit un refus de la base. Les `RAISE` de la migration sont deja en
 * francais : on les rend tels quels. Un refus de RLS, lui, est en anglais et
 * ne dit rien — on le remplace par ce qu'il veut dire ici.
 */
function traduire(erreur: { message: string; code?: string }, contexte: string): string {
  console.error(`[Messagerie] ${contexte} :`, erreur.code, erreur.message)
  if (erreur.code === '42501' && !/row-level security/i.test(erreur.message)) return erreur.message
  if (erreur.code === '22023' || erreur.code === '23503') return erreur.message
  if (/row-level security/i.test(erreur.message)) {
    return 'Vous ne pouvez pas écrire dans cette conversation (la personne a peut-être quitté le cabinet).'
  }
  return 'L’enregistrement a échoué. Réessayez dans un instant.'
}

interface RangeeConversation {
  id: string
  genre: 'equipe' | 'privee'
  autre_user_id: string | null
  autre_nom: string | null
  autre_actif: boolean | null
  dernier_le: string | null
  dernier_extrait: string | null
  dernier_auteur_nom: string | null
  dernier_de_moi: boolean | null
  dernier_retire: boolean | null
  nb_non_lus: number | null
}

export async function lireConversations(): Promise<Resultat<{ conversations: ConversationListe[] }>> {
  const o = await ouvrir()
  if ('error' in o) return { ok: false, error: o.error }

  const { data, error } = await o.supabase.rpc('messagerie_conversations')
  if (error) return { ok: false, error: traduire(error, 'Lecture des conversations') }

  return {
    ok: true,
    conversations: ((data ?? []) as RangeeConversation[]).map((r) => ({
      id: r.id,
      genre: r.genre,
      autreUserId: r.autre_user_id,
      autreNom: r.autre_nom,
      autreActif: r.autre_actif !== false,
      dernierLe: r.dernier_le,
      dernierExtrait: r.dernier_extrait,
      dernierAuteurNom: r.dernier_auteur_nom,
      dernierDeMoi: r.dernier_de_moi === true,
      dernierRetire: r.dernier_retire === true,
      nbNonLus: r.nb_non_lus ?? 0,
    })),
  }
}

/** Ouvre (ou retrouve) la conversation privee avec quelqu'un du cabinet. */
export async function ouvrirConversationPrivee(
  autreUserId: string,
): Promise<Resultat<{ conversationId: string }>> {
  if (!estUuid(autreUserId)) return { ok: false, error: 'Cette personne est introuvable.' }
  const o = await ouvrir()
  if ('error' in o) return { ok: false, error: o.error }

  const { data, error } = await o.supabase.rpc('messagerie_ouvrir_privee', { p_autre: autreUserId })
  if (error || typeof data !== 'string') {
    return { ok: false, error: error ? traduire(error, 'Ouverture') : 'Conversation introuvable.' }
  }
  return { ok: true, conversationId: data }
}

export interface EnvoiMessage {
  /** Choisi par l'ecran AVANT l'envoi : le temps reel le reconnait ainsi. */
  id: string
  conversationId: string
  corps: string
  pieces: PieceMessage[]
  /**
   * B-193c — les comptes (user_id) a prevenir AUSSI par mail. Reserve a
   * l'administratrice, choisis par elle parmi les membres de la conversation.
   */
  mailA?: string[]
}

interface DestinataireMail {
  userId: string
  veterinaireId: string | null
  nom: string
  email: string
}

/**
 * Qui peut recevoir le mail de ce message, et a quelle adresse.
 *
 * Tout est relu EN BASE, sous l'identite de l'administratrice : la liste
 * envoyee par l'ecran n'est qu'une DEMANDE. Un identifiant qui n'est pas
 * membre de la conversation refuse l'envoi entier — on ne previent pas en
 * silence une partie des gens choisis.
 */
async function preparerMail(
  supabase: Client,
  userId: string,
  conversationId: string,
  demandes: string[],
): Promise<{ destinataires: DestinataireMail[]; equipe: boolean; auteur: string } | { error: string }> {
  const { data: moi, error: erreurMoi } = await supabase
    .from('veterinaires')
    .select('prenom, nom, role_app')
    .eq('user_id', userId)
    .eq('actif', true)
    .maybeSingle()
  if (erreurMoi) return { error: 'Je n’arrive pas à vérifier vos droits pour le moment. Réessayez.' }
  if (!moi || moi.role_app !== 'admin') {
    return { error: 'Seule l’administratrice peut prévenir aussi par mail.' }
  }

  const uniques = [...new Set(demandes)]
  if (uniques.length > MAILS_MAX_PAR_MESSAGE) {
    return { error: `${MAILS_MAX_PAR_MESSAGE} destinataires au maximum par message.` }
  }
  if (!uniques.every(estUuid)) return { error: 'Un destinataire est introuvable. Rechargez la page.' }

  const { data: conv, error: erreurConv } = await supabase
    .from('conversations')
    .select('genre')
    .eq('id', conversationId)
    .maybeSingle()
  if (erreurConv || !conv) return { error: 'Conversation introuvable.' }
  const equipe = conv.genre === 'equipe'

  // Les personnes autorisees : tout le cabinet actif pour le fil d'equipe,
  // l'autre membre pour une conversation privee.
  let permis: Set<string>
  if (equipe) {
    const { data, error } = await supabase.rpc('messagerie_annuaire')
    if (error) return { error: 'Je n’arrive pas à lire l’équipe pour le moment. Réessayez.' }
    permis = new Set(((data ?? []) as { user_id: string }[]).map((m) => m.user_id))
  } else {
    const { data, error } = await supabase
      .from('conversation_membres')
      .select('user_id')
      .eq('conversation_id', conversationId)
    if (error) return { error: 'Je n’arrive pas à lire cette conversation pour le moment. Réessayez.' }
    permis = new Set(((data ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((u) => u !== userId))
  }
  if (uniques.some((u) => !permis.has(u))) {
    return { error: 'Une des personnes choisies ne fait pas partie de cette conversation.' }
  }

  const [vets, secrs] = await Promise.all([
    supabase.from('veterinaires').select('id, user_id, prenom, nom, email').in('user_id', uniques).eq('actif', true),
    supabase.from('secretaires').select('user_id, nom, email').in('user_id', uniques).eq('actif', true),
  ])
  if (vets.error || secrs.error) return { error: 'Je n’arrive pas à lire les adresses pour le moment. Réessayez.' }

  const destinataires: DestinataireMail[] = [
    ...((vets.data ?? []) as { id: string; user_id: string; prenom: string; nom: string; email: string | null }[]).map(
      (v) => ({ userId: v.user_id, veterinaireId: v.id, nom: `${v.prenom} ${v.nom}`.trim(), email: v.email ?? '' }),
    ),
    ...((secrs.data ?? []) as { user_id: string; nom: string; email: string | null }[]).map((s) => ({
      userId: s.user_id,
      veterinaireId: null,
      nom: s.nom,
      email: s.email ?? '',
    })),
  ]
  const sansAdresse = destinataires.filter((d) => !adresseUtilisable(d.email))
  if (sansAdresse.length > 0) {
    return { error: `Pas d’adresse mail pour ${sansAdresse.map((d) => d.nom).join(', ')}. Retirez-les de la liste.` }
  }
  return { destinataires, equipe, auteur: `${moi.prenom} ${moi.nom}`.trim() }
}

/**
 * Envoie le mail, une personne apres l'autre, par `sendBrevoEmail` — le MEME
 * chemin que tous les autres mails du produit (lecon du 21/08 : « deux chemins
 * d'envoi, un seul corrige »). Chaque envoi est journalise dans `email_log`.
 */
async function expedierMail(
  supabase: Client,
  message: MessageFil,
  preparation: { destinataires: DestinataireMail[]; equipe: boolean; auteur: string },
): Promise<{ envoyes: number; echecs: number }> {
  const { data: cab } = await supabase
    .from('cabinets')
    .select('nom, brevo_from_email, brevo_from_name')
    .eq('id', await resoudreCabinetId(supabase))
    .maybeSingle()
  const cabinet = ((cab?.nom as string | null) ?? '').trim() || 'Votre cabinet'
  const lien = `${adresseProduit()}/messagerie?c=${message.conversationId}`
  const subject = sujetMailMessage({ auteur: preparation.auteur, cabinet, equipe: preparation.equipe })
  const htmlContent = corpsMailMessage({
    auteur: preparation.auteur,
    cabinet,
    equipe: preparation.equipe,
    corps: message.corps,
    pieces: message.pieces,
    lien,
  })

  let envoyes = 0
  let echecs = 0
  for (const d of preparation.destinataires) {
    const r = await sendBrevoEmail({
      to: d.email,
      toName: d.nom,
      subject,
      htmlContent,
      fromEmail: (cab?.brevo_from_email as string | null) ?? null,
      fromName: (cab?.brevo_from_name as string | null) ?? null,
    })
    const ok = 'success' in r
    if (ok) envoyes += 1
    else echecs += 1
    const { error } = await supabase.from('email_log').insert({
      type: 'message',
      destinataire: d.email,
      veterinaire_id: d.veterinaireId,
      resend_id: ok ? r.messageId : null,
      statut: ok ? 'envoye' : 'erreur',
      erreur: ok ? null : r.error,
    })
    // Journaliser est un effet de bord : on ne fait pas echouer l'envoi, mais
    // on le DIT (un silence audible vaut mieux qu'un silence).
    if (error) console.error('[Messagerie] Journal du mail refusé :', error.message)
  }
  return { envoyes, echecs }
}

export async function envoyerMessage(envoi: EnvoiMessage): Promise<Resultat<{ message: MessageFil }>> {
  if (!estUuid(envoi.id) || !estUuid(envoi.conversationId)) {
    return { ok: false, error: 'Ce message est mal formé. Rechargez la page.' }
  }
  const corps = typeof envoi.corps === 'string' ? envoi.corps : ''
  const pieces = Array.isArray(envoi.pieces) ? envoi.pieces : []
  const mailA = Array.isArray(envoi.mailA) ? envoi.mailA.filter((u) => typeof u === 'string') : []
  const refus = refusMessage({ corps, nbPieces: pieces.length })
  if (refus) return { ok: false, error: refus }

  const o = await ouvrir()
  if ('error' in o) return { ok: false, error: o.error }

  // B-193c — le mail se prepare AVANT d'enregistrer : un destinataire refuse
  // doit l'etre avant que le message soit publie, pas apres.
  let preparation: Awaited<ReturnType<typeof preparerMail>> | null = null
  if (mailA.length > 0) {
    const {
      data: { user },
    } = await o.supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Vous n’êtes plus connecté. Rechargez la page.' }
    preparation = await preparerMail(o.supabase, user.id, envoi.conversationId, mailA)
    if ('error' in preparation) return { ok: false, error: preparation.error }
  }

  // Le prefixe d'un chemin EST la frontiere entre cabinets et conversations.
  if (pieces.length > 0) {
    let cabinetId: string
    try {
      cabinetId = await resoudreCabinetId(o.supabase)
    } catch {
      return { ok: false, error: 'Votre compte n’est rattaché à aucun cabinet.' }
    }
    for (const p of pieces) {
      if (!cheminDansConversation(p.chemin, cabinetId, envoi.conversationId)) {
        console.warn('[Messagerie] Chemin de pièce hors périmètre, refusé :', p.chemin)
        return { ok: false, error: 'Une pièce jointe ne correspond pas à cette conversation.' }
      }
      const r = refusPiece(p)
      if (r) return { ok: false, error: r }
    }
  }

  // Auteur, nom, cabinet et heure sont poses par le trigger : on ne les
  // envoie pas. `auteur_nom` est requis par la table, le trigger l'ecrase.
  const { data, error } = await o.supabase
    .from('messages')
    .insert({
      id: envoi.id,
      conversation_id: envoi.conversationId,
      corps,
      pieces_jointes: pieces.map((p) => ({ chemin: p.chemin, nom: p.nom, taille: p.taille, type: p.type })),
      auteur_nom: '—',
    })
    .select(COLONNES_MESSAGE)
    .single()

  if (error || !data) {
    return { ok: false, error: error ? traduire(error, 'Envoi') : 'L’envoi a échoué.' }
  }
  const message = versMessage(data as RangeeMessage)
  if (!preparation || 'error' in preparation) return { ok: true, message }

  // Le message est publie quoi qu'il arrive au mail (decision MiKL du 06/11).
  let resultat = { envoyes: 0, echecs: preparation.destinataires.length }
  try {
    resultat = await expedierMail(o.supabase, message, preparation)
  } catch (e) {
    console.error('[Messagerie] Envoi des mails interrompu :', e instanceof Error ? e.message : e)
  }
  const { error: erreurTrace } = await o.supabase.rpc('messagerie_noter_envoi_mail', {
    p_message: message.id,
    p_envoyes: resultat.envoyes,
    p_echecs: resultat.echecs,
  })
  if (erreurTrace) console.error('[Messagerie] Trace d’envoi non notée :', erreurTrace.message)
  return {
    ok: true,
    message: { ...message, mailEnvoyeA: resultat.envoyes, mailEchecs: resultat.echecs },
  }
}

export async function modifierMessage(
  messageId: string,
  corps: string,
): Promise<Resultat<{ message: MessageFil }>> {
  if (!estUuid(messageId)) return { ok: false, error: 'Message introuvable.' }
  const texte = typeof corps === 'string' ? corps : ''
  if (!texte.trim()) return { ok: false, error: 'Un message modifié ne peut pas être vide. Retirez-le plutôt.' }
  const refus = refusMessage({ corps: texte, nbPieces: 0 })
  if (refus) return { ok: false, error: refus }

  const o = await ouvrir()
  if ('error' in o) return { ok: false, error: o.error }

  const { data, error } = await o.supabase
    .from('messages')
    .update({ corps: texte })
    .eq('id', messageId)
    .select(COLONNES_MESSAGE)
    .maybeSingle()

  if (error) return { ok: false, error: traduire(error, 'Modification') }
  // Zero ligne : la RLS a filtre en silence (ce n'est pas son message).
  if (!data) return { ok: false, error: 'Vous ne pouvez modifier que vos propres messages.' }
  return { ok: true, message: versMessage(data as RangeeMessage) }
}

/**
 * Retire un message : son auteur, ou l'administratrice. Definitif.
 * Les fichiers joints sont supprimes du stockage au passage — un message
 * retire ne doit pas laisser une photo accessible a qui garde son chemin.
 */
export async function retirerMessage(messageId: string): Promise<Resultat<{ message: MessageFil }>> {
  if (!estUuid(messageId)) return { ok: false, error: 'Message introuvable.' }
  const o = await ouvrir()
  if ('error' in o) return { ok: false, error: o.error }

  const { data: avant, error: erreurLecture } = await o.supabase
    .from('messages')
    .select('pieces_jointes')
    .eq('id', messageId)
    .maybeSingle()
  if (erreurLecture) return { ok: false, error: traduire(erreurLecture, 'Lecture avant retrait') }
  if (!avant) return { ok: false, error: 'Message introuvable.' }

  const { data, error } = await o.supabase
    .from('messages')
    .update({ retire_le: new Date().toISOString() })
    .eq('id', messageId)
    .select(COLONNES_MESSAGE)
    .maybeSingle()

  if (error) return { ok: false, error: traduire(error, 'Retrait') }
  if (!data) return { ok: false, error: 'Vous ne pouvez retirer que vos propres messages.' }

  const chemins = versMessage({ ...(data as RangeeMessage), pieces_jointes: avant.pieces_jointes }).pieces.map(
    (p) => p.chemin,
  )
  if (chemins.length > 0) {
    const { error: erreurStockage } = await o.supabase.storage.from(BUCKET_MESSAGERIE).remove(chemins)
    // Le message est retire quoi qu'il arrive : un fichier reste en place est
    // un defaut de menage, pas une raison de laisser le texte visible.
    if (erreurStockage) console.error('[Messagerie] Fichiers non supprimés :', erreurStockage.message)
  }
  return { ok: true, message: versMessage(data as RangeeMessage) }
}

/** « J'ai lu jusqu'ici » — eteint aussi la notification de la cloche. */
export async function marquerConversationLue(conversationId: string): Promise<Resultat<object>> {
  if (!estUuid(conversationId)) return { ok: false, error: 'Conversation introuvable.' }
  const o = await ouvrir()
  if ('error' in o) return { ok: false, error: o.error }

  const { error } = await o.supabase.rpc('messagerie_marquer_lu', { p_conv: conversationId })
  if (error) return { ok: false, error: traduire(error, 'Marquer lu') }
  return { ok: true }
}

/** Le total des non-lus : la pastille du dock. `null` si la lecture echoue. */
export async function nombreMessagesNonLus(): Promise<number | null> {
  const o = await ouvrir()
  if ('error' in o) return null
  const { data, error } = await o.supabase.rpc('messagerie_non_lus_total')
  if (error) {
    console.error('[Messagerie] Non-lus illisibles :', error.message)
    return null
  }
  return typeof data === 'number' ? data : 0
}
