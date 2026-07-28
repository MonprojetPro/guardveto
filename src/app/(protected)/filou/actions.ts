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
import { faireTravaillerFilou, type EchangeFilou } from '@/lib/ia/agentFilou'
import { assistantIaDisponible } from '@/lib/ia/proposerRegle'
import { outilsPour, trouverOutil } from '@/lib/ia/outils/registre'
import type { ContexteOutil, PropositionAction } from '@/lib/ia/outils/types'

/** Ce que la tablette reçoit. Une seule forme, toujours : la réponse va sur le
 *  tableau, avec un bouton quand il y a quelque chose à décider. */
export type ReponseFilou =
  | { error: string }
  | {
      /** La phrase courte qui reste dans la conversation. */
      mot: string
      titre: string
      introduction: string
      lignes: string[]
      action?: {
        outil: string
        params: unknown
        charge?: unknown
        libelle: string
        avertissement?: string
      }
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

/** Combien de tours de parole Filou garde en tête. Assez pour qu'un échange
 *  aille au bout (« qui peut le mardi ? » → « et Anne-Cat ? » → « alors
 *  change-le »), pas assez pour qu'une longue matinée reparte en entier à
 *  chaque phrase : chaque tour est facturé. */
const TOURS_MEMORISES = 10

/** Longueur retenue par tour. Une réponse de Filou tient largement dedans ;
 *  au-delà, c'est du copier-coller qui n'apporte rien au fil. */
const LONGUEUR_TOUR = 1500

/**
 * Le fil vient du NAVIGATEUR : il n'est pas de confiance, et il est borné ici.
 *
 * Ce qu'un fil trafiqué permettrait au pire : faire croire à Filou qu'il a dit
 * quelque chose qu'il n'a pas dit, dans sa propre session. Ça ne lui donne
 * aucun pouvoir de plus — les lectures restent filtrées par les droits et la
 * RLS, et une modification passe toujours par `appliquerActionFilou`, qui
 * revalide l'outil et ses paramètres avant d'écrire. Le bornage sert donc
 * surtout à ce qu'un fil énorme ne parte pas en analyse à chaque phrase.
 */
function assainirHistorique(brut: unknown): EchangeFilou[] {
  if (!Array.isArray(brut)) return []
  const retenus: EchangeFilou[] = []
  for (const e of brut) {
    const role = (e as { role?: unknown })?.role
    const texte = (e as { texte?: unknown })?.texte
    if (role !== 'user' && role !== 'assistant') continue
    if (typeof texte !== 'string') continue
    const propre = texte.trim().slice(0, LONGUEUR_TOUR)
    if (propre) retenus.push({ role, texte: propre })
  }
  return retenus.slice(-TOURS_MEMORISES)
}

export async function parlerAFilou(
  phrase: string,
  historique?: unknown,
): Promise<ReponseFilou> {
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
    assainirHistorique(historique),
  )

  if (issue.erreur) return { error: issue.erreur }
  return {
    mot: issue.mot,
    titre: issue.titre,
    introduction: issue.introduction,
    lignes: issue.lignes,
    action: issue.action,
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
