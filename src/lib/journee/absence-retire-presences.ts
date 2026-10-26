// ============================================================
// GUARDVETO — Une absence accordée retire les présences de journée
// ============================================================
// B-160. Trou MESURÉ le 11/10, après un retour de MiKL qui le croyait déjà
// tenu : *« quand l'admin accepte des absences ça s'applique automatiquement
// aux journées comme aux gardes »*.
//
// 🔴 CE N'ÉTAIT PAS LE CAS, ET LE DÉFAUT NE SE VOYAIT PAS.
//    `grep presences_journee` dans `conges/actions.ts` → 0. Dans
//    `api/absences/route.ts` → 0. L'application des trames écarte bien les
//    congés validés AU MOMENT DE LA POSE (B-149, vérifié) — mais rien ne
//    repassait derrière quand l'absence arrivait APRÈS. Le planning affichait
//    alors quelqu'un au cabinet un jour où il était en congé, et AUCUN écran
//    ne le signalait.
//
//    C'est la même famille que les huit juges de B-156 : un seul des deux sens
//    couvert, et c'est celui de « la donnée change après coup » qui manquait.
//
// ── POURQUOI UNE BRIQUE, ET PAS DEUX APPELS RECOPIÉS ────────────────────────
//
// Trois chemins rendent quelqu'un indisponible : la validation d'un congé, la
// déclaration d'une absence par l'admin, et la même par Filou. Recopier la
// règle à trois endroits, c'est la garantie qu'un quatrième chemin arrivera
// sans elle — « trois chemins d'écriture, deux gardiens », déjà payé sur ce
// produit. La règle vit donc ICI, une fois, et `tests/lib/absence-retire-
// presences.test.ts` refuse qu'un chemin l'oublie.
//
// ── CE QUE LA BRIQUE NE FAIT PAS, DÉLIBÉRÉMENT ──────────────────────────────
//
// ⚠️ ELLE NE REPOSE RIEN. Un congé refusé après coup, ou annulé, ne fait pas
//    revenir les présences retirées. C'est cohérent avec la règle du lot :
//    l'application des trames est ADDITIVE, et c'est elle qui repose — l'admin
//    relance « Remplir les journées » et retrouve son monde. L'inverse
//    demanderait de mémoriser ce qui a été retiré et pourquoi, soit la ligne
//    qui dit l'ABSENCE : « vider une place ≠ la mettre à null », piège déjà
//    payé deux fois le 02/09.
//
// ⚠️ ELLE NE TOUCHE PAS AUX GARDES. Une garde est un engagement envers le
//    cabinet : la retirer en silence laisserait un soir SANS PERSONNE. C'est
//    tout l'objet du parcours de réparation d'absence, qui réattribue — et qui
//    demande à un humain de trancher. Une présence de journée, elle, n'engage
//    personne d'autre : la retirer ne laisse aucun trou à combler.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreneauBlocJournee } from '@/types'
import { CRENEAUX_BLOC } from '@/lib/journee/blocs'
// B-163 — l'unique autorité sur ce qu'une absence retire.
import { blocsRetires, lirePerimetre, type PerimetreAbsence } from '@/lib/absences/perimetre'

/** Une présence posée, réduite à ce qu'il faut pour décider de son sort. */
export interface PresencePourRetrait {
  id: string
  veterinaire_id: string
  /** `AAAA-MM-JJ`. */
  date: string
  /**
   * LE CRÉNEAU DE LA TRANCHE SUR LAQUELLE ELLE EST POSÉE (B-163).
   *
   * ⚠️ SANS LUI, LE RETRAIT REDEVIENT UN RETRAIT PAR JOUR, et une absence du
   *    matin ferait disparaître l'après-midi. Optionnel au type (les appels
   *    anciens compilent) mais replié sur `journee` : la valeur la plus large,
   *    donc celle qui se fait retirer dès qu'une absence couvre le jour entier.
   *    Un oubli retire comme avant ce lot ; il ne conserve jamais à tort.
   */
  creneau?: CreneauBlocJournee
}

/** La fenêtre d'indisponibilité : bornes COMPRISES, comme partout ailleurs. */
export interface FenetreAbsence {
  veterinaire_id: string
  date_debut: string
  date_fin: string
  /**
   * CE QUE L'ABSENCE COUVRE (B-163). Absent ou inconnu ⇒ `journee-et-nuit`,
   * soit le comportement d'avant ce lot.
   */
  perimetre?: PerimetreAbsence
}

/**
 * Les présences à retirer — fonction PURE, donc vérifiable sans base.
 *
 * ⚠️ BORNES COMPRISES des deux côtés : c'est la convention de `conges` et
 *    d'`absences` (`date_debut <= d AND date_fin >= d`), et la même que
 *    `estAbsent` dans `presences.ts`. En changer ici retirerait un jour de
 *    trop ou de trop peu, sans que rien ne le dise.
 *
 * On compare des chaînes `AAAA-MM-JJ` : l'ordre lexicographique y est l'ordre
 * chronologique, et aucune conversion en `Date` ne vient décaler un jour selon
 * le fuseau — défaut classique sur ce projet, qui calle tout à midi UTC pour
 * cette raison.
 */
export function presencesARetirer(
  presences: readonly PresencePourRetrait[],
  fenetre: FenetreAbsence,
): string[] {
  // B-163 — CE QUE L'ABSENCE NOMME, ET RIEN DE PLUS.
  //
  // ⚠️ Un périmètre `ponctuel` rend une liste VIDE, et c'est la décision du
  //    13/10 (option A) : deux heures de réunion ne retirent pas une journée de
  //    présence. Un `nuit` aussi : il ne concerne que les gardes.
  //
  // ⚠️ Une absence « du matin » ne retire PAS un bloc « journée complète » : la
  //    personne est là l'après-midi. C'est `blocsRetires` qui le dit, et c'est
  //    la raison pour laquelle cette fonction a besoin du créneau de chaque
  //    présence — avant ce lot, elle ne regardait que la date.
  const creneauxRetires = blocsRetires(lirePerimetre(fenetre.perimetre))
  if (creneauxRetires.length === 0) return []

  return presences
    .filter(
      (p) =>
        p.veterinaire_id === fenetre.veterinaire_id &&
        p.date >= fenetre.date_debut &&
        p.date <= fenetre.date_fin &&
        creneauxRetires.includes(p.creneau ?? 'journee'),
    )
    .map((p) => p.id)
}

/**
 * Ce que l'écran dira du retrait.
 *
 * ⚠️ UN RETRAIT SILENCIEUX SUR UN PLANNING SE LIT TOUJOURS COMME UNE PANNE.
 *    C'est la leçon de B-149 : au lot précédent, le nombre de présences
 *    écartées devait être DIT, faute de quoi l'admin découvre un planning qui
 *    a changé tout seul. Ici c'est pire, puisqu'elle n'a pas demandé le
 *    retrait — elle a validé un congé.
 *
 * Rend `null` quand il n'y a rien à dire : une phrase « 0 présence retirée »
 * est du bruit, et un message qui s'affiche toujours cesse d'être lu.
 */
export function phraseRetrait(nb: number, prenom: string): string | null {
  if (nb <= 0) return null
  return nb === 1
    ? `1 présence de journée a été retirée du planning pour ${prenom}.`
    : `${nb} présences de journée ont été retirées du planning pour ${prenom}.`
}

// ── L'exécution, côté serveur ───────────────────────────────────────────────

/**
 * La forme que PostgREST rend pour la jointure.
 *
 * ⚠️ IL REND UN OBJET OU UN TABLEAU SELON LA CARDINALITÉ QU'IL DÉDUIT, et les
 *    deux formes se sont déjà présentées sur ce projet. On accepte donc les
 *    deux plutôt que de parier sur l'une — un mauvais pari ici rendrait
 *    `undefined`, donc le repli `journee`, donc un retrait trop large et
 *    silencieux.
 */
interface LignePresenceJointe {
  id: string
  veterinaire_id: string
  date: string
  cabinet_id?: string | null
  blocs_journee: { creneau?: string } | { creneau?: string }[] | null
}

function creneauDeLaJointure(
  joint: LignePresenceJointe['blocs_journee'],
): CreneauBlocJournee | undefined {
  const brut = Array.isArray(joint) ? joint[0]?.creneau : joint?.creneau
  return CRENEAUX_BLOC.includes(brut as CreneauBlocJournee)
    ? (brut as CreneauBlocJournee)
    : undefined
}

/**
 * Retire du planning des journées les présences couvertes par une absence.
 *
 * APPELÉE PAR TOUT CHEMIN QUI REND QUELQU'UN INDISPONIBLE — validation d'un
 * congé, déclaration d'une absence, et ce que Filou fera de même. Le test
 * `absence-retire-presences.test.ts` refuse qu'un chemin l'oublie.
 *
 * ⚠️ BEST-EFFORT ASSUMÉ ET TRACÉ, comme `chargerExceptionsDesGardes`. Si la
 *    lecture ou la suppression échoue, on ne bloque PAS la validation du congé
 *    — refuser un congé parce qu'une présence de journée résiste serait un
 *    remède pire que le mal. Mais le journal le dit, et l'appelant reçoit le
 *    compte réel : un silence ici se relirait « rien à retirer », soit
 *    exactement la bonne nouvelle par défaut qu'on refuse partout ailleurs.
 */
export async function retirerPresencesCouvertes(
  supabase: SupabaseClient,
  fenetre: FenetreAbsence,
): Promise<{ retirees: number; erreur: string | null; cabinetId?: string | null }> {
  // Sortie courte : un périmètre qui ne retire aucun créneau n'a aucune raison
  // de lire la base. Évite une requête par absence ponctuelle ou de nuit.
  if (blocsRetires(lirePerimetre(fenetre.perimetre)).length === 0) {
    return { retirees: 0, erreur: null }
  }

  // ⚠️ LE CRÉNEAU VIENT DE LA TRANCHE, PAS DE LA PRÉSENCE. `presences_journee`
  //    porte un `bloc_id` et aucune notion d'horaire : c'est la tranche qui sait
  //    si elle est du matin. D'où la jointure — sans elle, impossible de retirer
  //    « le matin » sans retirer l'après-midi.
  const { data, error } = await supabase
    .from('presences_journee')
    .select('id, veterinaire_id, date, cabinet_id, blocs_journee!inner(creneau)')
    .eq('veterinaire_id', fenetre.veterinaire_id)
    .gte('date', fenetre.date_debut)
    .lte('date', fenetre.date_fin)

  if (error) {
    console.error(
      '[absence-retire-presences] presences illisibles, aucune retiree :',
      error.message,
    )
    return { retirees: 0, erreur: error.message }
  }

  // On repasse par la fonction PURE plutôt que de se fier au filtre SQL : c'est
  // elle qui porte la convention des bornes, et c'est elle qui est testée. Deux
  // façons de décider « cette présence est couverte » finiraient par diverger.
  //
  // La jointure PostgREST rend `blocs_journee: { creneau }` — à plat ici, pour
  // que la fonction pure n'ait pas à connaître la forme d'une réponse réseau.
  const lignes: PresencePourRetrait[] = ((data ?? []) as LignePresenceJointe[]).map((l) => ({
    id: l.id,
    veterinaire_id: l.veterinaire_id,
    date: l.date,
    creneau: creneauDeLaJointure(l.blocs_journee),
  }))
  const ids = presencesARetirer(lignes, fenetre)
  if (ids.length === 0) return { retirees: 0, erreur: null }

  const { error: errSuppr } = await supabase
    .from('presences_journee')
    .delete()
    .in('id', ids)

  if (errSuppr) {
    console.error(
      '[absence-retire-presences] suppression refusee :',
      errSuppr.message,
    )
    return { retirees: 0, erreur: errSuppr.message }
  }
  // B-173 — les agendas perso suivent : c'est l'APPELANT qui le déclenche
  // (`cabinetId` rendu ci-dessous). Ce fichier est aussi chargé par un écran
  // côté navigateur (ValiderCongeDialog) : y importer le déclencheur ferait
  // entrer le client Google dans le bundle du navigateur — le build l'a refusé.
  return {
    retirees: ids.length,
    erreur: null,
    cabinetId: ((data ?? []) as LignePresenceJointe[])[0]?.cabinet_id ?? null,
  }
}
