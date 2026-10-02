'use server'

// ============================================================
// GUARDVETO V2 — Les tranches horaires de la journée
// ============================================================
// B-120 chantier 2. Première écriture du module `planning-journee`.
//
// ⚠️ CE FICHIER EST LE PREMIER APPELANT RÉEL DE `exigerModule()` — B-120a ①.
//
// La garde serveur des modules a été écrite et testée le 11/09, et elle
// n'avait AUCUN appelant depuis : aucun module éteignable n'avait encore
// d'action à garder. C'est mot pour mot la leçon du 26/08 — « un grep prouve
// qu'un code est écrit, jamais qu'il est exécuté ». Trois mois de dispositif
// anti-silence reposaient sur une fonction que rien n'appelait.
//
// L'appel est donc EN PREMIÈRE LIGNE de chaque action, avant toute lecture et
// toute écriture. Pas après la garde admin, pas après la validation : si le
// module est éteint, ce cabinet n'a pas à exister du point de vue de cet
// écran, et une action éteinte ne doit pas même révéler qu'un réglage existe.
//
// ── L'ORDRE DES TROIS GARDES, ET POURQUOI IL EST CELUI-LÀ ───────────────────
//   ① le module  — ce cabinet a-t-il acheté cette capacité ?
//   ② l'admin    — cette personne a-t-elle le droit de la régler ?
//   ③ la saisie  — ce qu'elle envoie est-il cohérent ?
// Chacune est doublée en base par la RLS et les CHECK de la migration
// 20261001120000. Deux gardiens qui disent la même chose, délibérément.
// ============================================================

import { revalidatePath } from 'next/cache'
import { validerBloc, nomDejaPris } from '@/lib/journee/blocs'
import { porteJournee as porteOuverte } from '@/lib/journee/porte'
import type { SupabaseClient } from '@supabase/supabase-js'

// ⚠️ `porteOuverte` VIVAIT ICI et a été extraite dans `lib/journee/porte.ts` au
//    chantier 3, quand un second fichier d'actions (les trames) a eu besoin des
//    mêmes gardes. Le motif est celui écrit à sa création : « une garde recopiée
//    quatre fois est une garde oubliée la cinquième ». La dupliquer aurait
//    rejoué « convention recopiée trois fois, appliquée deux fois » (30/09).
//
//    Elle n'a pas pu rester ici : ce fichier est `'use server'`, et un module
//    `'use server'` ne peut exporter que des actions sérialisables — un client
//    Supabase ne franchit pas la frontière réseau.

type Resultat = { success: true } | { error: string }

/**
 * Les blocs du cabinet, pour contrôler les doublons de nom.
 *
 * ⚠️ `actif` est lu, et il compte. L'index unique de la base ne distingue pas
 * les tranches retirées : reprendre le nom d'une tranche retirée est refusé.
 * Sans cette colonne, l'admin lisait « Une tranche "Matin" existe déjà » en
 * regardant une liste où aucun "Matin" n'apparaît — il est plus bas, dans
 * « Tranches retirées ». Un refus exact mais incompréhensible envoie chercher
 * un bug qui n'existe pas.
 */
async function blocsExistants(
  supabase: SupabaseClient<any, any, any>,
): Promise<{ id: string; nom: string; actif: boolean }[]> {
  const { data } = await supabase.from('blocs_journee').select('id, nom, actif')
  return (data ?? []) as { id: string; nom: string; actif: boolean }[]
}

/** Le refus de doublon, en disant OÙ se trouve la tranche qui bloque. */
function refusDoublon(
  nom: string,
  existants: readonly { id: string; nom: string; actif: boolean }[],
): string {
  const cible = nom.trim().toLowerCase()
  const bloquant = existants.find((b) => b.nom.trim().toLowerCase() === cible)
  return bloquant && !bloquant.actif
    ? `Une tranche « ${nom} » existe déjà : elle a été retirée. Remettez-la au lieu d’en créer une seconde.`
    : `Une tranche « ${nom} » existe déjà.`
}

/**
 * Ajoute une tranche horaire au cabinet.
 *
 * L'ordre d'affichage est calculé ici (dernier + 1) plutôt que demandé à
 * l'admin : personne n'a envie de saisir un numéro de rang pour ajouter
 * « Visites du matin ». Elle réordonne ensuite si elle veut.
 */
export async function creerBloc(saisie: {
  nom: string
  debut: string
  fin: string
  creneau: string
}): Promise<Resultat> {
  const porte = await porteOuverte()
  if (!porte.ok) return { error: porte.probleme }
  const { supabase, cabinetId } = porte

  // ③ LA SAISIE.
  const v = validerBloc(saisie)
  if (!v.ok) return { error: v.probleme }

  const existants = await blocsExistants(supabase)
  if (nomDejaPris(v.valeur.nom, existants)) {
    return { error: refusDoublon(v.valeur.nom, existants) }
  }

  const { data: dernier } = await supabase
    .from('blocs_journee')
    .select('ordre')
    .order('ordre', { ascending: false })
    .limit(1)
    .maybeSingle()

  const ordre = ((dernier as { ordre?: number } | null)?.ordre ?? 0) + 1

  // ⚠️ `cabinet_id` est OBLIGATOIRE à l'insertion : la colonne est NOT NULL
  //    sans valeur par défaut, et sans elle la ligne serait de toute façon
  //    invisible sous la policy RESTRICTIVE (`cabinet_id = auth_cabinet_actif()`).
  const { error } = await supabase
    .from('blocs_journee')
    .insert({ ...v.valeur, ordre, cabinet_id: cabinetId })

  if (error) return { error: messageLisible(error.message) }

  revalidatePath('/journee')
  return { success: true }
}

/** Modifie une tranche existante (nom, horaires, rattachement, rang). */
export async function modifierBloc(
  id: string,
  saisie: { nom: string; debut: string; fin: string; creneau: string; ordre?: number },
): Promise<Resultat> {
  const porte = await porteOuverte()
  if (!porte.ok) return { error: porte.probleme }
  const { supabase } = porte

  if (!id) return { error: 'Tranche horaire introuvable.' }

  const v = validerBloc(saisie)
  if (!v.ok) return { error: v.probleme }

  const existants = await blocsExistants(supabase)
  // `sauf: id` — sans quoi renommer un bloc en lui-même serait refusé comme
  // doublon de lui-même.
  if (nomDejaPris(v.valeur.nom, existants, id)) {
    return { error: refusDoublon(v.valeur.nom, existants.filter((b) => b.id !== id)) }
  }

  const champs: Record<string, unknown> = { ...v.valeur, mis_a_jour_le: new Date().toISOString() }
  if (typeof saisie.ordre === 'number' && Number.isFinite(saisie.ordre)) {
    champs.ordre = Math.max(0, Math.trunc(saisie.ordre))
  }

  // ⚠️ `.eq('id', …)` et RIEN d'autre : jamais de `.or()` sur un `.update()`
  //    Supabase (leçon `0e7d341`, ça cassait toute génération).
  const { error } = await supabase.from('blocs_journee').update(champs).eq('id', id)
  if (error) return { error: messageLisible(error.message) }

  revalidatePath('/journee')
  return { success: true }
}

/**
 * Retire une tranche de la liste des tranches proposées, ou la remet.
 *
 * ⚠️ ON NE SUPPRIME PAS — décision du KIT COMPLET, ligne 6. Au chantier 3, des
 *    présences seront posées sur ces blocs : une suppression dure effacerait
 *    du planning déjà vécu, ou casserait une trame en silence. Le bloc
 *    désactivé sort des choix futurs, le passé reste lisible.
 *
 *    C'est la même famille de décision que le cadenas des gardes (B-111) :
 *    ce qui a été posé survit à un changement de configuration.
 */
export async function basculerBloc(id: string, actif: boolean): Promise<Resultat> {
  const porte = await porteOuverte()
  if (!porte.ok) return { error: porte.probleme }
  const { supabase } = porte

  if (!id) return { error: 'Tranche horaire introuvable.' }

  const { error } = await supabase
    .from('blocs_journee')
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
 * constraint "blocs_journee_nom_unique_par_cabinet" » dans une modale. Un
 * message technique dans une interface métier se lit comme une panne, alors
 * que c'est une saisie à corriger.
 */
function messageLisible(brut: string): string {
  if (brut.includes('blocs_journee_nom_unique_par_cabinet')) {
    return 'Une tranche porte déjà ce nom dans votre cabinet.'
  }
  if (brut.includes('blocs_journee_horaires_ordonnes')) {
    return "L'heure de fin doit être après l'heure de début."
  }
  if (brut.includes('blocs_journee_creneau_connu')) {
    return 'Ce moment de la journée n’est pas reconnu.'
  }
  if (brut.includes('row-level security') || brut.includes('violates row-level')) {
    return "Vous n'avez pas le droit de modifier les tranches horaires de ce cabinet."
  }
  return 'Enregistrement refusé par la base. Rien n’a été modifié.'
}
