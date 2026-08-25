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
import { faireTravaillerFilou, type EchangeFilou, type MesureFilou } from '@/lib/ia/agentFilou'
import { assistantIaDisponible } from '@/lib/ia/proposerRegle'
import { outilsPour, trouverOutil } from '@/lib/ia/outils/registre'
import { sourcesLisibles, sansAucuneLecture } from '@/lib/ia/outils/sources'
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
        /** Ce que le clic changerait — tenu à part du constat. */
        changements?: string[]
        avertissement?: string
      }
      /** Ce que l'attente a été occupée à faire. Admin seulement (cf. plus bas). */
      mesure?: MesureFilou
      /** Sur quoi la réponse s'appuie, déjà en français et prêt à afficher.
       *  Rendu à TOUT LE MONDE, contrairement au chronomètre : savoir d'où
       *  vient une affirmation n'est pas un réglage d'administrateur, c'est ce
       *  qui permet de décider si on s'y fie. */
      sources: string[]
      /** Vrai quand AUCUNE lecture n'a fondé la réponse. Le cas qui compte. */
      sansLecture: boolean
    }

async function contexte(): Promise<{ error: string } | { ctx: ContexteOutil }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: vet, error: erreurVet } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .maybeSingle()

  // L'erreur est LUE : une base qui ne répond pas ne doit pas devenir « ton
  // profil n'existe pas » (leçon B-011, 2026-08-24 — Filou affirmait qu'une
  // personne n'existait pas alors que la lecture avait simplement échoué).
  if (erreurVet) {
    console.error('[Filou] Lecture du profil impossible :', erreurVet.message)
    return { error: "Je n'arrive pas à lire ton profil pour le moment. Réessaie dans un instant." }
  }

  if (!vet) {
    // ⚠️ REFUS EXPLICITE DU SECRÉTARIAT (arbitrage MiKL du 2026-08-25).
    //
    // Sans ce bloc, une secrétaire était DÉJÀ refusée — mais par accident :
    // elle n'a pas de fiche vétérinaire, donc la lecture ne rendait rien, et
    // le refus tombait sur un message technique (« Profil vétérinaire
    // introuvable »). Un refus obtenu par effet de bord disparaît au premier
    // remaniement de cette fonction, et personne ne s'en apercevrait : Filou
    // se mettrait simplement à répondre à quelqu'un qui n'y a pas droit.
    //
    // On distingue donc les deux cas, et on le dit en français.
    const { data: sec } = await supabase
      .from('secretaires')
      .select('id')
      .eq('user_id', user.id)
      .eq('actif', true)
      .maybeSingle()

    if (sec) {
      return {
        error:
          "Filou n’est pas ouvert au secrétariat. Le planning et les absences se consultent directement à l’écran.",
      }
    }
    return { error: 'Profil vétérinaire introuvable.' }
  }

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
    // Le chronomètre ne sort que pour un administrateur : c'est un outil de
    // réglage, pas une information de cabinet. Un vétérinaire n'a rien à faire
    // du nombre d'allers-retours ni du nom du modèle.
    mesure: c.ctx.estAdmin ? issue.mesure : undefined,
    // `outilsAppeles` était constitué à chaque tour puis jamais utilisé, et pas
    // même transmis ici. Traduit en français, il devient la seule chose qui dise
    // à la personne si Filou a regardé son cabinet ou s'il a parlé tout seul.
    sources: sourcesLisibles(issue.outilsAppeles),
    sansLecture: sansAucuneLecture(issue.outilsAppeles),
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

  // Une lecture en panne LÈVE désormais (cf. `lib/ia/outils/lecture.ts`). Dans
  // la boucle de Filou, la boucle la rattrape ; ici, personne ne le faisait —
  // une panne serait ressortie en erreur générique de l'hébergeur, à côté d'un
  // bouton qu'on vient de cliquer, sans dire si quelque chose a été écrit.
  let r: Awaited<ReturnType<typeof outil.executer>>
  try {
    r = await outil.executer(valides.data, c.ctx, charge)
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Cette action n'a pas pu aboutir." }
  }
  if (r.error) return { error: r.error }

  // Les écrans lisent la base : sans ça, le tableau et la barre garderaient
  // l'ancien état après une modification acceptée.
  revalidatePath('/accueil')
  revalidatePath('/equipe')
  revalidatePath('/regles')
  return { success: true }
}
