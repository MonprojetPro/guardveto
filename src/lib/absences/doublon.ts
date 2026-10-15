// ============================================================
// GUARDVETO — La même absence deux fois, et le produit dit non
// ============================================================
// B-163a ④. MiKL, le 14/10, après avoir posé DEUX FOIS la même indisponibilité
// ponctuelle (Jean, 26/10, 14h→16h) pour voir si le produit réagissait :
// *« ça ne m'a pas signalé qu'il y avait déjà une absence de ce genre posée au
// même moment »*, puis *« on empêche de mettre 2 fois la même absence pour la
// même personne, ça n'a pas de sens »*.
//
// ── CE QUE ÇA CHANGE PAR RAPPORT À B-160a ③ ─────────────────────────────────
//
// `lib/absences/chevauchement.ts` SIGNALE un recouvrement, sur l'écran des
// absences. Ici on REFUSE l'écriture. Ce n'est pas la même doctrine, et MiKL l'a
// tranché en connaissance de cause : le signalement reste pour le croisement
// congé ↔ absence (où un doublon est souvent légitime — un congé posé de longue
// date, puis une maladie qui tombe dessus), le refus vaut pour absence ↔
// absence, où la seconde ligne n'apporte rien que la première ne dise déjà.
//
// ── POURQUOI UNE BRIQUE, ET PAS UN CONTRÔLE DANS LA ROUTE ───────────────────
//
// 🔴 PARCE QU'IL Y A DEUX CHEMINS D'ÉCRITURE, PAS UN. `POST /api/absences` est
//    celui qu'on a sous les yeux ; `lib/ia/outils/absences.ts` en est un second,
//    où Filou insère EN DIRECT dans la table. Un contrôle posé dans la seule
//    route aurait protégé un geste sur deux — et c'est très exactement le défaut
//    mesuré quatre fois sur ce produit (B-156, B-160, B-160a, B-163a ③), dont
//    la dernière occurrence concernait déjà `outils/absences.ts`.
//
// ⚠️ J'ALLAIS LE REPRODUIRE. Le premier jet de ce contrôle vivait dans la route,
//    avec un commentaire affirmant qu'« étant serveur, il tient pour tous les
//    appelants ». C'était faux, et seul un grep l'a montré. Écrit ici pour que
//    la prochaine personne n'ait pas à le redécouvrir : « c'est côté serveur »
//    ne veut PAS dire « c'est sur le chemin de tout le monde ».
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
// B-163d ④ — l'unique façon d'écrire une période à l'écran.
import { periodeFr } from '@/lib/dates-fr'
import {
  LIBELLE_PERIMETRE,
  lirePerimetre,
  perimetresSeRecouvrent,
  type HeuresPonctuel,
  type PerimetreAbsence,
} from '@/lib/absences/perimetre'

export interface AbsenceDoublon {
  id: string
  date_debut: string
  date_fin: string
  /** Déjà en français, affichable tel quel par qui refuse. */
  phrase: string
}

/**
 * Y a-t-il déjà une absence active qui dit la même chose du même moment ?
 *
 * Rend `null` quand la voie est libre. Rend un objet quand il faut refuser.
 *
 * ⚠️ LÈVE si la lecture échoue, et c'est délibéré. Un `catch` qui rendrait
 *    `null` ferait passer le doublon exactement le jour où la base a un
 *    problème — un contrôle qui s'efface en silence est un décor. L'appelant
 *    doit répondre 500, pas insérer.
 *
 * @param ignorerId  La ligne en cours de modification, qui ne doit pas se voir
 *                   elle-même comme son propre doublon.
 */
export async function trouverAbsenceEnDoublon(
  supabase: SupabaseClient,
  params: {
    cabinetId: string
    veterinaireId: string
    dateDebut: string
    dateFin: string
    perimetre: PerimetreAbsence
    heures: HeuresPonctuel | null
    ignorerId?: string
  },
): Promise<AbsenceDoublon | null> {
  const { data, error } = await supabase
    .from('absences')
    .select('id, date_debut, date_fin, perimetre, heure_debut, heure_fin')
    .eq('cabinet_id', params.cabinetId)
    .eq('veterinaire_id', params.veterinaireId)
    .eq('statut', 'active')
    // Le croisement des intervalles se fait EN BASE : deux dates se croisent si
    // chacune commence avant que l'autre ne finisse. Bornes comprises des deux
    // côtés, comme partout ailleurs sur ce produit.
    .lte('date_debut', params.dateFin)
    .gte('date_fin', params.dateDebut)

  if (error) {
    throw new Error(`Impossible de vérifier les absences déjà posées : ${error.message}`)
  }

  for (const a of data ?? []) {
    if (params.ignorerId && a.id === params.ignorerId) continue

    const sien = lirePerimetre(a.perimetre)
    const sesHeures =
      a.heure_debut && a.heure_fin
        ? { heure_debut: a.heure_debut as string, heure_fin: a.heure_fin as string }
        : null

    if (!perimetresSeRecouvrent(params.perimetre, sien, params.heures, sesHeures)) continue

    return { id: a.id as string, date_debut: a.date_debut as string, date_fin: a.date_fin as string, phrase: phraseDoublon(sien, a.date_debut as string, a.date_fin as string) }
  }

  return null
}

/**
 * Le message de refus.
 *
 * Il NOMME ce qui bloque et ses dates. « Doublon détecté » enverrait
 * l'administratrice chercher dans une liste sans lui dire quoi y regarder —
 * et un refus qu'on ne comprend pas se lit comme une panne.
 */
export function phraseDoublon(
  perimetre: PerimetreAbsence,
  dateDebut: string,
  dateFin: string,
): string {
  // 🔴 B-163d ④ — JAMAIS DE DATE ISO DANS UNE PHRASE. MiKL, 15/10 : « il faut
  //    que tu mettes les dates au format europeen, c'est pas la 1ere fois, y en
  //    a plein des comme ca ». Le message affichait « le 2026-10-26 ».
  //    `periodeFr` existait déjà et sait dire « le 26 octobre 2026 » ET
  //    « du … au … » — elle gère même le cas d'un seul jour, qui se lisait
  //    « du 26 octobre au 26 octobre » et faisait douter du reste du message.
  const quand = periodeFr(dateDebut, dateFin)
  return (
    `Cette personne a déjà une absence « ${LIBELLE_PERIMETRE[perimetre]} » ${quand}, `
    + 'qui couvre le même moment. Modifie ou supprime celle-ci plutôt que d’en ajouter une seconde.'
  )
}
