// ============================================================
// GUARDVETO — Le contrat d'un outil de Filou
// ============================================================
// SERVER-ONLY. Filou ne suit plus un chemin de code par capacité : on lui donne
// un CATALOGUE D'OUTILS et il choisit lesquels appeler, dans quel ordre, pour
// répondre. Ajouter une capacité, c'est décrire un outil — pas écrire une
// plomberie de plus.
//
// Le partage est net et non négociable :
//
//   • LECTURE  — s'exécute directement pendant que Filou réfléchit. Il peut en
//     enchaîner plusieurs, recouper, revenir. Rien n'est modifié.
//   • ÉCRITURE — ne s'exécute JAMAIS pendant la réflexion. L'outil produit une
//     PROPOSITION affichée sur le tableau ; l'écriture n'a lieu qu'après un clic
//     humain, et repasse par les mêmes actions serveur que les boutons de
//     l'application (mêmes gardes, même RLS, mêmes invariants métier).
//
// Un seul schéma Zod par outil sert aux deux bouts : converti en JSON Schema
// pour l'API, et utilisé tel quel pour valider ce que le modèle a renvoyé. Deux
// définitions séparées auraient divergé — et c'est précisément la frontière où
// une divergence devient une écriture non validée.
// ============================================================

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

/** Ce que tout outil sait de la personne qui parle à Filou. */
export interface ContexteOutil {
  supabase: SupabaseClient
  /** L'id du vétérinaire connecté (table `veterinaires`, pas `auth.users`). */
  vetoId: string
  /**
   * Son prénom et son nom — ce qui permet à Filou de résoudre « je », « moi »,
   * « mon planning » (B-040, 2026-08-26).
   *
   * Sans eux, il connaissait l'IDENTIFIANT de la personne mais pas son NOM : à
   * « je veux une règle pour moi les lundis », il répondait « quel est ton
   * prénom ? ». Une question absurde posée à quelqu'un de connecté, et qui
   * donne l'impression d'un assistant qui ne sait pas à qui il parle.
   */
  prenom: string
  nom: string
  estAdmin: boolean
  cabinetId: string
}

/** Ce qu'une écriture proposée raconte à l'humain AVANT qu'il ne décide.
 *  Jamais « 3 modifications » : on nomme ce qu'on va toucher, ligne par ligne. */
export interface PropositionAction {
  /** Titre de la fenêtre. Ex. « Retirer le statut dernier recours ». */
  titre: string
  /** Une phrase qui dit ce qui va se passer, en français simple. */
  phrase: string
  /** Le détail, un élément par ligne. Vide si l'action ne touche qu'une chose. */
  lignes?: string[]
  /** Libellé du bouton qui exécute. Ex. « Retirer le statut ». */
  action: string
  /** Avertissement affiché sous la proposition (irréversible, portée…). */
  avertissement?: string
}

interface OutilCommun {
  /** Le nom que le modèle appelle. En minuscules avec des underscores. */
  nom: string
  /** Ce que l'outil fait ET QUAND l'appeler — la seconde partie compte autant
   *  que la première : c'est elle qui décide si Filou y pense au bon moment. */
  description: string
  /** Réservé à l'administrateur du cabinet. Un vétérinaire ne voit même pas
   *  l'outil dans son catalogue : lui promettre une capacité pour répondre
   *  « accès refusé » serait une coquille vide. */
  adminSeulement?: boolean
}

export interface OutilLecture<S extends z.ZodType = z.ZodType> extends OutilCommun {
  genre: 'lecture'
  params: S
  /** Renvoie la donnée telle quelle : le modèle la lira, la recoupera et la
   *  formulera. On ne rédige pas de phrase ici — ce serait deux voix. */
  executer(params: z.infer<S>, ctx: ContexteOutil): Promise<unknown>
}

export interface OutilEcriture<S extends z.ZodType = z.ZodType> extends OutilCommun {
  genre: 'ecriture'
  params: S
  /** Décrit ce qui SERAIT fait, sans rien faire. Renvoie une raison si l'action
   *  est impossible : Filou l'expliquera plutôt que de proposer un bouton mort.
   *
   *  `charge` : ce que l'aperçu a déjà calculé et que l'exécution doit
   *  retrouver À L'IDENTIQUE. Sans elle, un outil dont l'aperçu passe par un
   *  modèle recalculerait à l'exécution et pourrait écrire autre chose que ce
   *  qui a été montré — on afficherait A et on créerait B. Elle fait l'aller-
   *  retour par le navigateur : ne rien y mettre qui ne soit revalidé côté
   *  serveur au moment d'écrire. */
  resumer(
    params: z.infer<S>,
    ctx: ContexteOutil,
  ): Promise<
    | { ok: true; proposition: PropositionAction; charge?: unknown }
    | { ok: false; raison: string }
  >
  /** N'est appelé QU'APRÈS le clic humain. */
  executer(params: z.infer<S>, ctx: ContexteOutil, charge?: unknown): Promise<{ error?: string }>
}

/**
 * Un outil qui n'agit ni ne lit : il POSE une réponse sur le tableau.
 *
 * Sans lui, tout ce que Filou trouve ressort dans la tablette — une liste de
 * règles ou de compteurs y arrive illisible, dans une colonne étroite. Le
 * tableau existe pour ça. On ne devine donc pas « cette réponse est longue,
 * elle mérite le tableau » avec une heuristique : c'est Filou qui décide, en
 * appelant l'outil, et c'est un geste qu'on peut lui décrire.
 */
export interface OutilAffichage<S extends z.ZodType = z.ZodType> extends OutilCommun {
  genre: 'affichage'
  params: S
}

export type Outil = OutilLecture | OutilEcriture | OutilAffichage

/** Le catalogue tel que l'API le reçoit. Le schéma est dérivé du Zod de
 *  l'outil : une seule définition sert donc au modèle ET à la validation. */
export function versDefinitionApi(outil: Outil): Anthropic.Tool {
  return {
    name: outil.nom,
    description: outil.description,
    input_schema: z.toJSONSchema(outil.params, {
      target: 'draft-7',
    }) as unknown as Anthropic.Tool['input_schema'],
  }
}

/** Aide à la rédaction : un outil sans paramètre reste un objet vide, jamais
 *  `null` — l'API exige un schéma d'objet. */
export const SANS_PARAMETRE = z.object({})
