// ============================================================
// GUARDVETO — QUI TIENT RÉELLEMENT UNE GARDE, UN JOUR DONNÉ (B-156)
// ============================================================
// Source UNIQUE de la question « qui est de garde ce jour-là ». Module PUR,
// sauf `chargerExceptionsDesGardes` qui ne fait qu'une lecture.
//
// POURQUOI CE FICHIER EXISTE
//
// La table `gardes` porte les TITULAIRES. Depuis B-061, un remplacement d'un
// seul jour s'écrit dans `gardes_exceptions` et la table `gardes` NE BOUGE PAS.
// Un lecteur qui interroge `gardes` sans les exceptions ne voit donc pas le
// planning tel qu'il sera vécu — il voit celui qui était prévu.
//
// 🔴 CE DÉFAUT A ÉTÉ PAYÉ TROIS FOIS EN UNE JOURNÉE, le 08/10 :
//      · B-155  — `casesAPourvoir` refusait la publication pour une garde pleine,
//                 devant le client ;
//      · B-155a — `monterValidationPeriode` annonçait « personne le 14 », une
//                 heure après le premier correctif ;
//      · B-156  — l'audit demandé par MiKL a trouvé SIX autres lecteurs.
//
// 🔑 LA LEÇON N'EST PAS « il restait des bugs », c'est que chaque correctif
//    RÉÉCRIVAIT la règle à son endroit. Trois copies de « applique les
//    remplacements » divergent ; une seule ne peut pas. C'est la leçon du 22/08
//    (trois chemins d'écriture, deux gardiens), appliquée à la LECTURE.
//
// ⚠️ UNE EXCEPTION À `null` VIDE LA PLACE, elle ne la rend pas au titulaire :
//    c'est le sens métier d'un remplacement non pourvu, et c'est déjà ce que la
//    vue `planning_semaine` montre à l'écran.
//
// ⚠️ LA VUE RESTE LA RÉFÉRENCE QUAND ON PEUT L'INTERROGER. `planning_semaine`
//    applique déjà ces mêmes exceptions, en SQL, et matérialise un week-end sur
//    ses trois jours. Un lecteur qui a besoin du planning JOUR PAR JOUR doit
//    préférer la vue (cf. `casesAPourvoir`, `recenserCreneauxImpactes`). Ce
//    module sert les lecteurs qui raisonnent sur la LIGNE `gardes` — ceux qui
//    ont besoin du rôle natif, du type, ou qui écrivent dessus.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/** Un remplacement d'UN SEUL jour, posé par-dessus un titulaire (B-061). */
export interface ExceptionJour {
  garde_id: string
  date: string
  role: string
  veterinaire_id: string | null
}

/** La forme minimale d'une garde dont on veut connaître les occupants réels. */
export interface GardeTitulaires {
  id?: string
  date: string
  premier_id: string | null
  second_id: string | null
}

/** Clé canonique d'une place d'un jour. UN seul constructeur, jamais inline. */
export function cleOccupant(gardeId: string, date: string, role: string): string {
  return `${gardeId}|${date}|${role}`
}

/**
 * Index des remplacements. `Map.has` dit « il y a un remplacement », la valeur
 * dit qui — `null` compris, qui veut dire « place vidée ». Les deux
 * informations sont distinctes et aucun appelant ne doit les confondre.
 */
export function indexerExceptions(
  exceptions: readonly ExceptionJour[],
): Map<string, string | null> {
  const index = new Map<string, string | null>()
  for (const e of exceptions) {
    index.set(cleOccupant(e.garde_id, e.date, e.role), e.veterinaire_id)
  }
  return index
}

/**
 * Qui tient réellement (garde, date, rôle) : le remplaçant s'il y en a un, le
 * titulaire sinon. `null` = personne.
 *
 * ⚠️ `date` est le JOUR DEMANDÉ, pas la date de la ligne. Un week-end occupe
 *    trois jours et peut porter un remplaçant différent sur chacun.
 */
export function occupantReel(
  garde: GardeTitulaires,
  index: Map<string, string | null>,
  date: string,
  role: string,
): string | null {
  if (garde.id) {
    const cle = cleOccupant(garde.id, date, role)
    if (index.has(cle)) return index.get(cle) ?? null
  }
  if (role === 'premier') return garde.premier_id
  if (role === 'second') return garde.second_id
  return null
}

/**
 * Les rôles qu'un vétérinaire tient réellement sur une garde, un jour donné.
 * Vide = il n'y est pas ce jour-là, même s'il en est le titulaire (il a été
 * remplacé) ; non vide alors qu'il n'est pas titulaire = il est le remplaçant.
 *
 * ⚠️ Les rôles sur-mesure (3e place et au-delà) ne sont pas couverts : ils
 *    vivent dans `garde_placements`, pas dans les deux colonnes de `gardes`.
 *    Limite écrite plutôt que découverte — aucun créneau sur-mesure n'accepte
 *    de remplacement ponctuel à ce jour.
 */
export function rolesTenusParVeto(
  garde: GardeTitulaires,
  index: Map<string, string | null>,
  date: string,
  vetId: string,
): string[] {
  const out: string[] = []
  for (const role of ['premier', 'second']) {
    if (occupantReel(garde, index, date, role) === vetId) out.push(role)
  }
  return out
}

/**
 * Pose les remplacements du jour par-dessus les titulaires, avant tout jugement.
 *
 * 🔴 DÉMÉNAGÉE DEPUIS `data/monterValidationPeriode.ts` (B-156), où elle avait
 *    été écrite pour B-155a. Elle y servait UN juge ; elle en sert désormais
 *    plusieurs, et c'était la seule façon de ne pas la recopier.
 *
 * ⚠️ SEULES LES EXCEPTIONS DU JOUR DE LA LIGNE SONT APPLIQUÉES. Un week-end
 *    occupe trois jours ; le vendredi est SYNTHÉTISÉ depuis le samedi par
 *    `gardesVersPlanningPartiel`, et hérite donc du remplaçant du samedi.
 *    Conséquence à connaître : une substitution qui ne vaudrait QUE pour le
 *    vendredi n'est pas vue par le validateur. ➜ B-155b. Ce n'est pas un oubli,
 *    c'est une limite assumée : la lever demande que la synthèse du vendredi
 *    connaisse les exceptions par date, donc de toucher le cœur de la
 *    reconstruction — un chantier, pas un `if`.
 *
 * ⚠️ Pour raisonner JOUR PAR JOUR, ne pas utiliser cette fonction : prendre
 *    `occupantReel` ou `rolesTenusParVeto`, qui demandent la date explicitement.
 */
export function appliquerExceptionsAuxGardes<T extends GardeTitulaires>(
  gardes: readonly T[],
  exceptions: readonly ExceptionJour[],
): T[] {
  if (exceptions.length === 0) return [...gardes]

  const index = indexerExceptions(exceptions)

  return gardes.map((g) => {
    if (!g.id) return g
    const clePremier = cleOccupant(g.id, g.date, 'premier')
    const cleSecond = cleOccupant(g.id, g.date, 'second')
    if (!index.has(clePremier) && !index.has(cleSecond)) return g
    return {
      ...g,
      premier_id: index.has(clePremier) ? index.get(clePremier) ?? null : g.premier_id,
      second_id: index.has(cleSecond) ? index.get(cleSecond) ?? null : g.second_id,
    }
  })
}

/**
 * Les jours où ce rôle est tenu par quelqu'un d'autre que son titulaire.
 *
 * Sert aux chemins qui ÉCRIVENT sur la place native (réparation d'absence,
 * dépannage par un volontaire) : ils doivent savoir qu'un remplacement ponctuel
 * est déjà posé par-dessus, sinon le nouvel arrivant croit couvrir tout le
 * créneau alors qu'un ou deux jours lui échappent.
 */
export function joursRemplacesSurRole(
  garde: GardeTitulaires,
  exceptions: readonly ExceptionJour[],
  role: string,
): string[] {
  if (!garde.id) return []
  return exceptions
    .filter((e) => e.garde_id === garde.id && e.role === role)
    .map((e) => e.date)
    .sort()
}

/**
 * La phrase à montrer quand un remplacement ponctuel couvre déjà ce rôle.
 * `null` = rien à dire.
 *
 * 🔑 UNE SEULE FORMULATION, ICI. Deux chemins de réparation la montrent (l'écran
 *    de crise et le dépannage par un volontaire) ; deux phrases écrites
 *    séparément auraient fini par dire deux choses différentes du même fait.
 *
 * ⚠️ C'EST UN AVERTISSEMENT, PAS UN REFUS — le système informe, il n'interdit
 *    pas (règle du 19/08). Laisser le créneau vide serait pire que laisser
 *    cohabiter un remplacement et un dépannage.
 */
export function avertissementRemplacementPonctuel(
  garde: GardeTitulaires,
  exceptions: readonly ExceptionJour[],
  role: string,
): string | null {
  const jours = joursRemplacesSurRole(garde, exceptions, role)
  if (jours.length === 0) return null
  const enFrancais = jours.map((j) => `${j.slice(8, 10)}/${j.slice(5, 7)}`).join(', ')
  return jours.length === 1
    ? `Attention : ce rôle fait déjà l'objet d'un remplacement ponctuel le ${enFrancais} — ` +
        `ce jour-là restera tenu par le remplaçant, pas par la personne que tu places ici.`
    : `Attention : ce rôle fait déjà l'objet de remplacements ponctuels (${enFrancais}) — ` +
        `ces jours-là resteront tenus par les remplaçants, pas par la personne que tu places ici.`
}

/**
 * Les remplacements posés sur un lot de gardes.
 *
 * ⚠️ BEST-EFFORT ASSUMÉ, ET TRACÉ. Une lecture en échec rend `[]` — donc « pas
 *    de remplacement », donc le comportement d'avant B-156. On ne bloque jamais
 *    un appelant pour autant, mais le journal le dit : un silence ici se
 *    relirait comme « aucun remplacement », la bonne nouvelle par défaut qu'on
 *    refuse partout ailleurs sur ce projet.
 */
export async function chargerExceptionsDesGardes(
  supabase: SupabaseClient,
  gardeIds: readonly (string | undefined)[],
): Promise<ExceptionJour[]> {
  const ids = [...new Set(gardeIds.filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from('gardes_exceptions')
    .select('garde_id, date, role, veterinaire_id')
    .in('garde_id', ids)

  if (error) {
    console.error(
      '[exceptions-jour] remplacements illisibles — les titulaires font foi pour ce tour :',
      error.message,
    )
    return []
  }
  return (data ?? []) as ExceptionJour[]
}
