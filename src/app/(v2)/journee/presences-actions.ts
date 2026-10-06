'use server'

// ============================================================
// GUARDVETO V2 — Les présences de la journée sur une période
// ============================================================
// B-120 chantier 3, lot 2. Les trois gardes viennent de `lib/journee/porte.ts`,
// partagée avec les tranches (chantier 2) et les trames (lot 1) — jamais
// recopiée. Toute la décision vit dans `lib/journee/presences.ts`, en fonctions
// pures : ce fichier-ci ne fait que porter, garder et écrire.
//
// 🔴 CE QUE CES ACTIONS DÉBLOQUENT. Le lot 1 écrivait la RÈGLE (« Anne-Sophie,
//    le mardi, sur Matin ») et le disait franchement : « elles n'écrivent pas la
//    présence ». Personne n'écrivait la présence. Mesuré le 06/10 : `grep` sur
//    `presences_journee|appliquerTrame|poserPresence` revenait à vide, et
//    l'écran l'affichait — « ces règles ne remplissent pas encore le planning ».
//    C'est ici que ça change.
//
// ── POURQUOI L'APPLICATION EST UN GESTE EXPLICITE, ET PAS UN EFFET DE BORD ──
//
// Décision ⑤ du cadrage V3 : « le remplissage case par case reste possible, les
// trames accélèrent, elles n'obligent pas ». Enregistrer une trame ne pose
// toujours RIEN — c'est `appliquerTrames` qui pose, sur une période nommée, et
// seulement quand l'administratrice le demande. Si modifier une trame réécrivait
// le planning, elle perdrait ses retouches en corrigeant une faute de frappe.
//
// ── CE QUI PROTÈGE LE TRAVAIL MANUEL ────────────────────────────────────────
//
// Pas un cadenas — MiKL, le 06/10 : « les cadenas pour les gardes seulement,
// pour le planning jour pas besoin ». C'est la règle d'application elle-même :
// additive et idempotente (voir `presences.ts`). Elle ajoute ce qui manque, elle
// ne retire ni ne modifie jamais rien. Réappliquer deux fois ne change rien la
// seconde fois.
// ============================================================

import { revalidatePath } from 'next/cache'
import { porteJournee } from '@/lib/journee/porte'
import {
  aPoser,
  presenceDejaPosee,
  presencesVoulues,
  resumeApplication,
  validerPresence,
  type PeriodePourPresences,
  type PresenceVoulue,
  type SaisiePresence,
  type TramePourProjection,
} from '@/lib/journee/presences'
import type { BlocJournee } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'

type Client = SupabaseClient<any, any, any>

type Resultat = { success: true; message: string } | { error: string }

/** Ce que l'aperçu rend à l'écran, sans rien écrire. */
export type Apercu =
  | { ok: true; aPoser: number; inchangees: number; personnes: number; phrase: string }
  | { ok: false; probleme: string }

/**
 * La période visée : elle existe, elle est à nous, et elle se modifie encore.
 *
 * ⚠️ LE REFUS SUR UNE PÉRIODE VERROUILLÉE N'EST GARDÉ PAR PERSONNE D'AUTRE.
 *    La RLS borne au cabinet, pas au statut. Sans ce contrôle, on pourrait poser
 *    des présences sur un planning d'archive — que l'écran affiche en lecture
 *    seule, donc sans aucun moyen de les retirer ensuite. C'est le même
 *    raisonnement que `api/generate`, qui refuse de régénérer une période
 *    verrouillée côté serveur et pas seulement en masquant le bouton.
 */
async function periodeModifiable(
  supabase: Client,
  periodeId: string,
): Promise<{ ok: true; periode: PeriodePourPresences } | { ok: false; probleme: string }> {
  if (!periodeId) return { ok: false, probleme: 'Planning introuvable. Rechargez l’écran.' }

  const { data, error } = await supabase
    .from('periodes')
    .select('id, date_debut, date_fin, statut, libelle')
    .eq('id', periodeId)
    .maybeSingle()

  // L'erreur est LUE : une lecture échouée rendrait `data` à null, et on
  // afficherait « ce planning n'existe pas » pour une panne de réseau.
  if (error) return { ok: false, probleme: 'Le planning n’a pas pu être lu. Rien n’a été modifié.' }

  const p = data as
    | { id: string; date_debut: string; date_fin: string; statut: string; libelle: string | null }
    | null

  if (!p) return { ok: false, probleme: 'Ce planning n’existe pas dans votre cabinet.' }

  if (p.statut === 'verrouille') {
    return {
      ok: false,
      probleme: `« ${p.libelle ?? 'Ce planning'} » est verrouillé : il ne se modifie plus.`,
    }
  }

  return { ok: true, periode: { id: p.id, date_debut: p.date_debut, date_fin: p.date_fin } }
}

/** Les tranches du cabinet — toutes, actives ou non : les filtres vivent dans la logique pure. */
async function blocsDuCabinet(supabase: Client): Promise<BlocJournee[]> {
  const { data } = await supabase.from('blocs_journee').select('id, nom, actif')
  return (data ?? []) as BlocJournee[]
}

/** Les trames du cabinet, telles qu'il faut les connaître pour les projeter. */
async function tramesDuCabinet(supabase: Client): Promise<TramePourProjection[]> {
  const { data } = await supabase
    .from('trames_journee')
    .select('id, veterinaire_id, bloc_id, jour, semaine, actif')
  return (data ?? []) as TramePourProjection[]
}

/**
 * Les présences déjà posées sur cette période.
 *
 * ⚠️ BORNÉ À LA PÉRIODE, et c'est volontaire malgré la clé d'unicité qui ne la
 *    porte pas. Deux périodes qui se chevauchent sont refusées à la création :
 *    lire au-delà n'ajouterait rien et ferait grossir la requête d'un planning
 *    entier à chaque aperçu.
 */
async function presencesDeLaPeriode(supabase: Client, periodeId: string) {
  const { data, error } = await supabase
    .from('presences_journee')
    .select('id, veterinaire_id, bloc_id, date, trame_id')
    .eq('periode_id', periodeId)

  if (error) return { erreur: error.message, lignes: [] as PresenceLue[] }
  return { erreur: null, lignes: (data ?? []) as PresenceLue[] }
}

interface PresenceLue {
  id: string
  veterinaire_id: string
  bloc_id: string
  date: string
  trame_id: string | null
}

/**
 * Ce que l'application VA faire, sans rien écrire.
 *
 * Le même calcul que l'écriture, appelé par la même fonction (`aPoser`) : le
 * nombre annoncé est donc exactement celui qui sera écrit. Deux calculs séparés
 * finissent toujours par diverger — c'est ce qui a coûté B-130b, « 23 cases
 * annoncées pour 19 écrites ».
 */
export async function apercuApplicationTrames(periodeId: string): Promise<Apercu> {
  const porte = await porteJournee()
  if (!porte.ok) return { ok: false, probleme: porte.probleme }
  const { supabase } = porte

  const per = await periodeModifiable(supabase, periodeId)
  if (!per.ok) return { ok: false, probleme: per.probleme }

  const [blocs, trames, deja] = await Promise.all([
    blocsDuCabinet(supabase),
    tramesDuCabinet(supabase),
    presencesDeLaPeriode(supabase, periodeId),
  ])
  if (deja.erreur) {
    return { ok: false, probleme: 'Les présences déjà posées n’ont pas pu être lues.' }
  }

  const voulues = presencesVoulues(trames, blocs, per.periode)
  const r = resumeApplication(voulues, aPoser(voulues, deja.lignes))
  return { ok: true, ...r }
}

/**
 * Applique les trames de présence sur une période.
 *
 * ⚠️ ÉCRITURE PAR LOTS DE 500. Une période de 12 semaines avec 35 trames produit
 *    plus de 400 lignes, et un `insert` unique de plusieurs milliers de lignes
 *    dépasse les limites de la passerelle sur un produit déjà jugé lent (B-116).
 *    Le découpage est aussi ce qui rend le compte final honnête : on additionne
 *    ce que la base a RÉELLEMENT accepté, lot par lot.
 */
export async function appliquerTrames(periodeId: string): Promise<Resultat> {
  const porte = await porteJournee()
  if (!porte.ok) return { error: porte.probleme }
  const { supabase, cabinetId } = porte

  const per = await periodeModifiable(supabase, periodeId)
  if (!per.ok) return { error: per.probleme }

  const [blocs, trames, deja] = await Promise.all([
    blocsDuCabinet(supabase),
    tramesDuCabinet(supabase),
    presencesDeLaPeriode(supabase, periodeId),
  ])
  if (deja.erreur) {
    return { error: 'Les présences déjà posées n’ont pas pu être lues. Rien n’a été modifié.' }
  }

  const voulues = presencesVoulues(trames, blocs, per.periode)
  const aEcrire = aPoser(voulues, deja.lignes)
  const resume = resumeApplication(voulues, aEcrire)

  // Rien à faire n'est pas une erreur : c'est le cas normal d'une seconde
  // application. On rend la phrase qui le dit, plutôt qu'un succès muet qui
  // laisserait croire à un bouton cassé.
  if (aEcrire.length === 0) return { success: true, message: resume.phrase }

  const lignes = aEcrire.map((p: PresenceVoulue) => ({
    cabinet_id: cabinetId,
    periode_id: per.periode.id,
    veterinaire_id: p.veterinaire_id,
    bloc_id: p.bloc_id,
    date: p.date,
    trame_id: p.trame_id,
  }))

  let posees = 0
  for (let i = 0; i < lignes.length; i += 500) {
    const lot = lignes.slice(i, i + 500)
    const { error, count } = await supabase
      .from('presences_journee')
      .insert(lot, { count: 'exact' })

    if (error) {
      // On dit ce qui a été écrit AVANT l'échec. Annoncer « rien n'a été
      // modifié » serait faux dès le second lot, et un chiffre faux sur un
      // planning coûte plus cher qu'un échec avoué.
      return {
        error:
          posees > 0
            ? `${posees} présence${posees > 1 ? 's' : ''} posée${posees > 1 ? 's' : ''}, puis l’enregistrement a été refusé : ${messageLisible(error.message)}`
            : messageLisible(error.message),
      }
    }
    // `count` peut être null selon la passerelle : on retombe sur la taille du
    // lot, qui est exacte puisque l'insert n'a pas échoué.
    posees += count ?? lot.length
  }

  revalidatePath('/planning')
  revalidatePath('/journee')

  const n = posees
  return {
    success: true,
    message:
      `${n} présence${n > 1 ? 's' : ''} posée${n > 1 ? 's' : ''} sur ce planning` +
      (resume.inchangees > 0 ? `, ${resume.inchangees} étaient déjà en place.` : '.'),
  }
}

/**
 * Pose une présence à la main, sur un jour précis.
 *
 * C'est le « remplissage case par case » du cadrage, et le geste que MiKL a
 * demandé le 06/10 : « prévoir les fonctions de remplissage des journées pour y
 * inclure les vétos ».
 */
export async function poserPresence(saisie: SaisiePresence): Promise<Resultat> {
  const porte = await porteJournee()
  if (!porte.ok) return { error: porte.probleme }
  const { supabase, cabinetId } = porte

  const per = await periodeModifiable(supabase, saisie?.periode_id ?? '')
  if (!per.ok) return { error: per.probleme }

  // ③ LA SAISIE.
  const blocs = await blocsDuCabinet(supabase)
  const v = validerPresence(saisie, blocs, per.periode)
  if (!v.ok) return { error: v.probleme }

  const veto = await vetoUtilisable(supabase, v.valeur.veterinaire_id)
  if (!veto.ok) return { error: veto.probleme }

  const deja = await presencesDeLaPeriode(supabase, per.periode.id)
  if (deja.erreur) {
    return { error: 'Les présences déjà posées n’ont pas pu être lues. Rien n’a été modifié.' }
  }
  const doublon = presenceDejaPosee(v.valeur, deja.lignes)
  if (doublon.presente) {
    return {
      error: doublon.deLaTrame
        ? 'Cette personne est déjà présente sur cette tranche ce jour-là — elle y est par sa trame.'
        : 'Cette personne est déjà présente sur cette tranche ce jour-là.',
    }
  }

  const { error } = await supabase
    .from('presences_journee')
    .insert({ ...v.valeur, cabinet_id: cabinetId })

  if (error) return { error: messageLisible(error.message) }

  revalidatePath('/planning')
  return { success: true, message: 'Présence ajoutée.' }
}

/**
 * Retire une présence d'un jour.
 *
 * ⚠️ ICI ON SUPPRIME VRAIMENT, contrairement aux tranches et aux trames qui se
 *    désactivent. Ce n'est pas une incohérence : une tranche et une trame sont
 *    de la CONFIGURATION, dont l'historique explique le planning. Une présence
 *    est le planning lui-même — une présence « retirée mais conservée » devrait
 *    être filtrée par chaque lecteur, et le lecteur qui oublie le filtre
 *    afficherait quelqu'un qui n'est pas là. C'est pire que l'oubli inverse.
 *
 * ⚠️ LIMITE ASSUMÉE, À DIRE À L'ÉCRAN : si la présence venait d'une trame,
 *    réappliquer la trame la remettra. Il n'existe pas de retrait définitif dans
 *    ce lot — mémoriser l'exception demandait une ligne qui dit l'ABSENCE, et
 *    « vider une place ≠ la mettre à null » est un piège déjà payé deux fois le
 *    02/09. L'écran doit donc le dire, pas le taire.
 */
export async function retirerPresence(id: string): Promise<Resultat> {
  const porte = await porteJournee()
  if (!porte.ok) return { error: porte.probleme }
  const { supabase } = porte

  if (!id) return { error: 'Présence introuvable.' }

  // On relit la ligne pour connaître SA période, et vérifier qu'elle se modifie
  // encore. Sans ça, une présence d'un planning verrouillé serait supprimable
  // par son identifiant — la porte du statut ne garderait que l'ajout.
  const { data } = await supabase
    .from('presences_journee')
    .select('id, periode_id, trame_id')
    .eq('id', id)
    .maybeSingle()

  const ligne = data as { id: string; periode_id: string; trame_id: string | null } | null
  if (!ligne) return { error: 'Cette présence n’existe pas dans votre cabinet.' }

  const per = await periodeModifiable(supabase, ligne.periode_id)
  if (!per.ok) return { error: per.probleme }

  // ⚠️ `.eq('id', …)` et RIEN d'autre : jamais de `.or()` sur un `.update()` ni
  //    un `.delete()` Supabase (leçon `0e7d341`, ça cassait toute génération).
  const { error } = await supabase.from('presences_journee').delete().eq('id', id)
  if (error) return { error: messageLisible(error.message) }

  revalidatePath('/planning')
  return {
    success: true,
    message: ligne.trame_id
      ? 'Présence retirée. Elle reviendra si vous réappliquez les trames.'
      : 'Présence retirée.',
  }
}

/**
 * Le vétérinaire existe-t-il, est-il actif, et dans CE cabinet ?
 *
 * Même contrôle qu'au lot 1, même raison : la RLS borne au cabinet mais `actif`
 * n'est gardé par personne en base. Poser une présence sur quelqu'un qui a
 * quitté le cabinet s'enregistrerait sans un mot, et le compterait dans
 * l'effectif du jour.
 */
async function vetoUtilisable(
  supabase: Client,
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
 * Traduit un refus de Postgres en phrase lisible.
 *
 * Sans ce passage, l'admin lirait « duplicate key value violates unique
 * constraint "presences_journee_sans_doublon" » dans une modale. Un message
 * technique dans une interface métier se lit comme une panne, alors que c'est
 * une saisie à corriger.
 */
function messageLisible(brut: string): string {
  if (brut.includes('presences_journee_sans_doublon')) {
    return 'Cette personne est déjà présente sur cette tranche ce jour-là.'
  }
  if (brut.includes('presences_journee_bloc_id_fkey')) {
    return 'Cette tranche horaire n’existe plus. Rechargez l’écran.'
  }
  if (brut.includes('presences_journee_periode_id_fkey')) {
    return 'Ce planning n’existe plus. Rechargez l’écran.'
  }
  if (brut.includes('presences_journee_trame_id_fkey')) {
    return 'La trame de cette présence a changé. Rechargez l’écran.'
  }
  if (brut.includes('row-level security') || brut.includes('violates row-level')) {
    return 'Vous n’avez pas le droit de modifier le planning de ce cabinet.'
  }
  return 'Enregistrement refusé par la base. Rien n’a été modifié.'
}
