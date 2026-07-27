'use server'

// ============================================================
// GUARDVETO — Parler à Filou, et appliquer ce qu'il propose
// ============================================================
// Deux actions, et la frontière entre les deux est le cœur du dispositif :
//
//   parlerAFilou()        — Filou lit, recoupe, répond. N'écrit JAMAIS.
//   appliquerActionFilou() — exécute une proposition, APRÈS le clic humain.
//
// La seconde ne fait pas confiance à ce que le client lui renvoie : elle
// retrouve l'outil dans le catalogue autorisé pour CE rôle, revalide les
// paramètres par le schéma de l'outil, et laisse l'outil repasser par les
// actions serveur de l'application (mêmes gardes, même RLS). Un client modifié
// ne peut donc ni inventer un outil, ni élargir son périmètre, ni glisser des
// paramètres que le schéma refuse.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { revalidatePath } from 'next/cache'
import { faireTravaillerFilou } from '@/lib/ia/agentFilou'
import { assistantIaDisponible } from '@/lib/ia/proposerRegle'
import { outilsPour, trouverOutil } from '@/lib/ia/outils/registre'
import type { ContexteOutil, PropositionAction } from '@/lib/ia/outils/types'

/** Ce que la tablette reçoit. */
export type ReponseFilou =
  | { error: string }
  /** Filou a répondu — ça reste dans la conversation. */
  | { genre: 'message'; texte: string }
  /** Filou veut faire quelque chose : ça part sur le tableau, avec un bouton. */
  | {
      genre: 'action'
      /** Le mot d'accompagnement, s'il en a écrit un. */
      texte: string
      outil: string
      params: unknown
      charge?: unknown
      proposition: PropositionAction
    }
  /** Filou pose une réponse sur le tableau : rien à décider, juste à lire. */
  | {
      genre: 'affichage'
      texte: string
      titre: string
      introduction: string
      lignes: string[]
    }

async function contexte(): Promise<{ error: string } | { ctx: ContexteOutil }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()
  if (!vet) return { error: 'Profil vétérinaire introuvable.' }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  return {
    ctx: {
      supabase,
      vetoId: vet.id as string,
      estAdmin: (vet.role_app as string) === 'admin',
      cabinetId,
    },
  }
}

/** La date du jour à Paris, en toutes lettres — Filou raisonne sur « ce soir »,
 *  « la semaine prochaine », et n'a aucune horloge par lui-même. */
function aujourdhuiEnFrancais(): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date())
}

export async function parlerAFilou(phrase: string): Promise<ReponseFilou> {
  const c = await contexte()
  if ('error' in c) return c

  if (!assistantIaDisponible()) {
    return { error: 'Assistant IA non configuré (clé API manquante côté serveur).' }
  }
  const texte = phrase?.trim() ?? ''
  if (texte.length < 3) return { error: 'Décris ta demande en quelques mots.' }

  const issue = await faireTravaillerFilou(
    texte,
    outilsPour(c.ctx),
    c.ctx,
    aujourdhuiEnFrancais(),
  )

  if (issue.genre === 'erreur') return { error: issue.texte }
  if (issue.genre === 'message') return { genre: 'message', texte: issue.texte }
  if (issue.genre === 'affichage') {
    return {
      genre: 'affichage',
      texte: issue.texte,
      titre: issue.titre,
      introduction: issue.introduction,
      lignes: issue.lignes,
    }
  }
  return {
    genre: 'action',
    texte: issue.texte,
    outil: issue.outil,
    params: issue.params,
    charge: issue.charge,
    proposition: issue.proposition,
  }
}

export async function appliquerActionFilou(
  nomOutil: string,
  params: unknown,
  charge?: unknown,
): Promise<{ error: string } | { success: true }> {
  const c = await contexte()
  if ('error' in c) return c

  const outil = trouverOutil(nomOutil, c.ctx)
  if (!outil) return { error: "Cette action n'existe pas ou ne t'est pas permise." }
  if (outil.genre !== 'ecriture') return { error: "Cette action ne modifie rien." }

  // Deuxième passage par le schéma : le premier a eu lieu avant l'affichage,
  // mais c'est ce corps-ci qui va écrire, et il vient du navigateur.
  const valides = outil.params.safeParse(params ?? {})
  if (!valides.success) return { error: 'Paramètres invalides.' }

  const r = await outil.executer(valides.data, c.ctx, charge)
  if (r.error) return { error: r.error }

  // Les écrans lisent la base : sans ça, le tableau et la barre garderaient
  // l'ancien état après une modification acceptée.
  revalidatePath('/accueil')
  revalidatePath('/equipe')
  revalidatePath('/regles')
  return { success: true }
}
