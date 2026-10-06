'use server'

// ============================================================
// GUARDVETO V2 — Les trames de présence de la journée
// ============================================================
// B-120 chantier 3, lot 1. Les trois gardes viennent de `lib/journee/porte.ts`,
// partagée avec les tranches horaires du chantier 2 — jamais recopiée.
//
// ── CE QUE CES ACTIONS N'ÉCRIVENT PAS, ET C'EST LE POINT LE PLUS IMPORTANT ───
//
// Elles écrivent la RÈGLE, pas la présence. Modifier une trame ne déplace
// AUCUNE présence déjà posée, et n'en pose aucune nouvelle. L'application de la
// trame sur une période est un geste séparé, explicite, qui arrive au lot 2.
//
// Ce n'est pas une limite du lot : c'est la décision ⑤ du cadrage V3 — « le
// remplissage case par case reste possible, les trames accélèrent, elles
// n'obligent pas ». Si enregistrer une trame réécrivait le planning, l'admin
// perdrait ses retouches en corrigeant une faute de frappe.
//
// ⚠️ CONSÉQUENCE À DIRE À L'ÉCRAN, pas à taire : après avoir changé sa trame,
//    rien ne bouge tant qu'on ne l'applique pas. Un écran qui laisse croire le
//    contraire fabrique le « faut que je rafraîchisse pour voir » — sauf qu'ici
//    rafraîchir ne montrerait rien, parce qu'il n'y a rien à montrer.
// ============================================================

import { revalidatePath } from 'next/cache'
import { porteJournee } from '@/lib/journee/porte'
import {
  LIBELLE_JOUR,
  trameDejaPresente,
  validerTrame,
  validerTrames,
  type BlocPourTrame,
  type SaisieTrame,
  type SaisieTrames,
  type TrameValide,
} from '@/lib/journee/trames'
import type { SupabaseClient } from '@supabase/supabase-js'

type Resultat = { success: true } | { error: string }

/** Les tranches du cabinet, telles qu'il faut les connaître pour valider. */
async function blocsDuCabinet(
  supabase: SupabaseClient<any, any, any>,
): Promise<BlocPourTrame[]> {
  const { data } = await supabase.from('blocs_journee').select('id, nom, actif')
  return (data ?? []) as BlocPourTrame[]
}

/** Les lignes de trame du cabinet, pour le contrôle de doublon. */
async function tramesDuCabinet(supabase: SupabaseClient<any, any, any>) {
  const { data } = await supabase
    .from('trames_journee')
    .select('id, veterinaire_id, bloc_id, jour, semaine, actif')
  return (data ?? []) as {
    id: string
    veterinaire_id: string
    bloc_id: string
    jour: string
    semaine: string
    actif: boolean
  }[]
}

/**
 * Le refus de doublon, en disant OÙ se trouve la ligne qui bloque.
 *
 * Le cas « elle existe mais elle est retirée » mérite son message : sans lui,
 * l'admin lit « déjà dans la trame » en regardant une liste où la ligne
 * n'apparaît pas. C'est le correctif que le chantier 2 a dû ajouter après coup
 * pour les tranches — un refus exact mais incompréhensible envoie chercher un
 * bug qui n'existe pas.
 */
function refusDoublon(actif: boolean): string {
  return actif
    ? 'Cette présence est déjà dans la trame.'
    : 'Cette présence existe déjà dans la trame, mais elle a été retirée. Remettez-la au lieu d’en créer une seconde.'
}

/**
 * Le vétérinaire existe-t-il, est-il actif, et dans CE cabinet ?
 *
 * ⚠️ La RLS le garantit déjà (policy RESTRICTIVE sur `cabinet_id`), et pourtant
 *    ce contrôle n'est pas inutile : sans lui, un identifiant d'une autre
 *    maison produirait un refus de contrainte Postgres illisible au lieu d'une
 *    phrase. Et surtout, `actif` n'est gardé par personne en base — bâtir une
 *    trame sur quelqu'un qui a quitté le cabinet s'enregistrerait sans un mot.
 */
async function vetoUtilisable(
  supabase: SupabaseClient<any, any, any>,
  veterinaireId: string,
): Promise<{ ok: true } | { ok: false; probleme: string }> {
  const { data } = await supabase
    .from('veterinaires')
    .select('id, prenom, actif')
    .eq('id', veterinaireId)
    .maybeSingle()

  const v = data as { prenom?: string; actif?: boolean } | null
  if (!v) return { ok: false, probleme: 'Cette personne n’existe pas dans votre cabinet.' }
  if (!v.actif) {
    return {
      ok: false,
      probleme: `${v.prenom ?? 'Cette personne'} n’est plus active dans le cabinet.`,
    }
  }
  return { ok: true }
}

/**
 * Ajoute PLUSIEURS jours d'un coup à la trame de quelqu'un (B-147).
 *
 * Demande de MiKL le 06/10 : décrire « lundi + mardi + jeudi, matin » obligeait
 * à saisir trois fois la même phrase.
 *
 * ⚠️ UN JOUR DÉJÀ PRÉSENT N'ARRÊTE PAS LES AUTRES, et c'est le choix qui compte
 *    ici. Tout refuser parce qu'un jour sur cinq existe déjà obligerait l'admin
 *    à décocher au jugé pour retrouver lequel — alors que son intention
 *    (« qu'elle soit là ces jours-là ») est satisfaite dans les deux cas. On
 *    pose donc ce qui manque, et le message DIT ce qui existait déjà : un geste
 *    qui fait moins que demandé sans le dire est pire que celui qui refuse.
 */
export async function creerTrames(saisie: SaisieTrames): Promise<Resultat> {
  const porte = await porteJournee()
  if (!porte.ok) return { error: porte.probleme }
  const { supabase, cabinetId } = porte

  const blocs = await blocsDuCabinet(supabase)
  const v = validerTrames(saisie, blocs)
  if (!v.ok) return { error: v.probleme }

  const veto = await vetoUtilisable(supabase, saisie.veterinaire_id)
  if (!veto.ok) return { error: veto.probleme }

  const existantes = await tramesDuCabinet(supabase)
  const aPoser: TrameValide[] = []
  const dejaRetirees: string[] = []

  for (const valeur of v.valeurs) {
    const doublon = trameDejaPresente(valeur, existantes)
    if (!doublon.presente) {
      aPoser.push(valeur)
    } else if (!doublon.actif) {
      // Une ligne retirée bloque l'insertion (l'index unique porte aussi les
      // inactives) sans apparaître dans la liste. Sans ce message, l'admin
      // chercherait un bug devant un jour qui refuse de s'ajouter.
      dejaRetirees.push(LIBELLE_JOUR[valeur.jour])
    }
    // Un jour DÉJÀ ACTIF ne produit ni erreur ni message : la liste qui se
    // rafraîchit le montre à sa place, et c'est une information plus sûre
    // qu'une phrase — on la lit sur l'écran, pas dans un toast évanoui.
  }

  if (aPoser.length === 0) {
    return {
      error: dejaRetirees.length
        ? `Rien à ajouter : ${liste(dejaRetirees)} existe${dejaRetirees.length > 1 ? 'nt' : ''} déjà dans la trame, mais a été retiré${dejaRetirees.length > 1 ? 's' : ''}. Remettez la ligne au lieu d’en créer une seconde.`
        : 'Ces présences sont déjà dans la trame.',
    }
  }

  const { error } = await supabase
    .from('trames_journee')
    .insert(aPoser.map((t) => ({ ...t, cabinet_id: cabinetId })))

  if (error) return { error: messageLisible(error.message) }

  revalidatePath('/journee')
  revalidatePath('/equipe')
  return { success: true }
}

/** « lundi », « lundi et mardi », « lundi, mardi et jeudi ». */
function liste(mots: string[]): string {
  if (mots.length <= 1) return mots[0] ?? ''
  return `${mots.slice(0, -1).join(', ')} et ${mots[mots.length - 1]}`
}

/** Modifie une ligne de trame (tranche, jour, cadence). */
export async function modifierTrame(id: string, saisie: SaisieTrame): Promise<Resultat> {
  const porte = await porteJournee()
  if (!porte.ok) return { error: porte.probleme }
  const { supabase } = porte

  if (!id) return { error: 'Ligne de trame introuvable.' }

  const blocs = await blocsDuCabinet(supabase)
  const v = validerTrame(saisie, blocs)
  if (!v.ok) return { error: v.probleme }

  const veto = await vetoUtilisable(supabase, v.valeur.veterinaire_id)
  if (!veto.ok) return { error: veto.probleme }

  // `sauf: id` — sans quoi réenregistrer une ligne sans la changer serait
  // refusé comme doublon d'elle-même.
  const doublon = trameDejaPresente(v.valeur, await tramesDuCabinet(supabase), id)
  if (doublon.presente) return { error: refusDoublon(doublon.actif) }

  const champs: Record<string, unknown> = {
    ...(v.valeur as TrameValide),
    mis_a_jour_le: new Date().toISOString(),
  }

  // ⚠️ `.eq('id', …)` et RIEN d'autre : jamais de `.or()` sur un `.update()`
  //    Supabase (leçon `0e7d341`, ça cassait toute génération).
  const { error } = await supabase.from('trames_journee').update(champs).eq('id', id)
  if (error) return { error: messageLisible(error.message) }

  revalidatePath('/journee')
  return { success: true }
}

/**
 * Retire une ligne de la trame, ou la remet.
 *
 * ⚠️ ON NE SUPPRIME PAS, même ici où rien n'est encore posé dessus. Au lot 2,
 *    des présences porteront la trace de la ligne qui les a produites : une
 *    suppression dure effacerait cette filiation, et on ne saurait plus pourquoi
 *    quelqu'un est présent un mardi. Même doctrine que `blocs_journee.actif` et
 *    que le cadenas des gardes (B-111) — ce qui a été posé survit à un
 *    changement de configuration.
 */
export async function basculerTrame(id: string, actif: boolean): Promise<Resultat> {
  const porte = await porteJournee()
  if (!porte.ok) return { error: porte.probleme }
  const { supabase } = porte

  if (!id) return { error: 'Ligne de trame introuvable.' }

  const { error } = await supabase
    .from('trames_journee')
    .update({ actif, mis_a_jour_le: new Date().toISOString() })
    .eq('id', id)

  if (error) return { error: messageLisible(error.message) }

  revalidatePath('/journee')
  return { success: true }
}

/**
 * Traduit un refus de Postgres en phrase lisible.
 *
 * Sans ce passage, l'admin lirait « duplicate key value violates unique
 * constraint "trames_journee_sans_doublon" » dans une modale. Un message
 * technique dans une interface métier se lit comme une panne, alors que c'est
 * une saisie à corriger.
 */
function messageLisible(brut: string): string {
  if (brut.includes('trames_journee_sans_doublon')) {
    return 'Cette présence est déjà dans la trame.'
  }
  if (brut.includes('trames_journee_jour_connu')) {
    return 'Ce jour n’est pas reconnu.'
  }
  if (brut.includes('trames_journee_semaine_connue')) {
    return 'Cette cadence n’est pas reconnue. Écrivez-la au singulier : « paire », « impaire ».'
  }
  // ON DELETE RESTRICT sur `bloc_id` : le refus arrive quand on tente de
  // supprimer une tranche encore citée par une trame. Le message doit dire quoi
  // faire, pas nommer la contrainte.
  if (brut.includes('trames_journee_bloc_id_fkey')) {
    return 'Cette tranche horaire est utilisée par une trame de présence. Retirez d’abord la présence.'
  }
  if (brut.includes('row-level security') || brut.includes('violates row-level')) {
    return "Vous n'avez pas le droit de modifier les trames de ce cabinet."
  }
  return 'Enregistrement refusé par la base. Rien n’a été modifié.'
}
