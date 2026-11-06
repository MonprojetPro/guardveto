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

type Resultat<T> = ({ ok: true } & T) | { ok: false; error: string }

const COLONNES_MESSAGE =
  'id, conversation_id, auteur_user_id, auteur_nom, corps, pieces_jointes, cree_le, modifie_le, retire_le'

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
}

export async function envoyerMessage(envoi: EnvoiMessage): Promise<Resultat<{ message: MessageFil }>> {
  if (!estUuid(envoi.id) || !estUuid(envoi.conversationId)) {
    return { ok: false, error: 'Ce message est mal formé. Rechargez la page.' }
  }
  const corps = typeof envoi.corps === 'string' ? envoi.corps : ''
  const pieces = Array.isArray(envoi.pieces) ? envoi.pieces : []
  const refus = refusMessage({ corps, nbPieces: pieces.length })
  if (refus) return { ok: false, error: refus }

  const o = await ouvrir()
  if ('error' in o) return { ok: false, error: o.error }

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
  return { ok: true, message: versMessage(data as RangeeMessage) }
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
