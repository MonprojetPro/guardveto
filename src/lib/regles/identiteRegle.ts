// ============================================================
// GUARDVETO — Deux règles font-elles la MÊME CHOSE ?
// ============================================================
// L'INCIDENT QUI A RENDU CE FICHIER NÉCESSAIRE — 2026-08-02
//
// MiKL a créé « Anne-Catherine ne fait pas de garde le mercredi ». Le cabinet
// en avait déjà une, venue des données d'origine. L'anti-doublon n'a rien vu :
//
//   déjà en base : { jour: 'mercredi', periode: 'apres_midi',
//                    description: 'Mercredi apres-midi fixe + …',
//                    repos_supplementaire_variable: true }
//   la nouvelle  : { jour: 'mercredi', exception_vacances_scolaires: false }
//
// Deux JSON différents… et STRICTEMENT le même effet, parce que le moteur
// (`violeReposFixe`, hard-constraints.ts) ne lit que `jour` et l'exception
// vacances. `periode`, `description` et le reste sont décoratifs : aucun code
// ne les évalue. Le cabinet s'est donc retrouvé avec deux règles jumelles, dont
// une parfaitement inerte.
//
// LE PRINCIPE : comparer ce que le MOTEUR LIT, pas le texte stocké.
//
// On ne réécrit pas la liste des champs lus brique par brique — elle
// divergerait du moteur au premier ajout. On retire les champs dont on a
// VÉRIFIÉ qu'aucun évaluateur ne les consulte, et on normalise le reste
// (ordre des listes, casse, booléens absents). Ce qui reste, c'est l'empreinte.
//
// ⚠️ En cas de doute sur un champ, NE PAS l'ajouter à la liste des décoratifs.
//    Un champ oublié dans la liste = un doublon non détecté (l'ancien
//    comportement, désagréable). Un champ ajouté à tort = deux règles
//    DIFFÉRENTES prises pour des jumelles, et un refus injustifié. La seconde
//    erreur est bien pire que la première.
// ============================================================

/**
 * Champs présents dans `params` qu'AUCUN évaluateur du moteur ne consulte.
 * Vérifié le 2026-08-02 par lecture de `engine/rules/`, `engine/validation/`
 * et `engine/solver.ts`.
 */
const DECORATIFS = new Set([
  // Texte libre hérité de la V1 (« Mercredi apres-midi fixe + … »).
  'description',
  // ⚠️ `periode` au SINGULIER seulement. Le moteur lit bien `periodes` au
  //    pluriel (indisponibilite_cyclique) — ne jamais confondre les deux.
  'periode',
  // Annotation V1 jamais évaluée : un repos « variable » n'est pas modélisé.
  'repos_supplementaire_variable',
  'note',
  'commentaire',
])

/**
 * Normalise une valeur pour la comparaison :
 *  · les listes sont TRIÉES (l'ordre de saisie des créneaux ne fait pas une
 *    règle différente) ;
 *  · les chaînes sont rognées et mises en minuscules (« Senior » = « senior »
 *    pour le moteur, cf. la comparaison des étiquettes) ;
 *  · les objets sont normalisés récursivement, clés triées à la sérialisation.
 */
function normaliser(valeur: unknown): unknown {
  if (Array.isArray(valeur)) {
    return valeur
      .map(normaliser)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  if (valeur && typeof valeur === 'object') {
    return empreinteParams(valeur as Record<string, unknown>)
  }
  if (typeof valeur === 'string') return valeur.trim().toLowerCase()
  return valeur
}

/**
 * Les params réduits à ce qui compte, sous forme d'objet trié.
 *
 * `false`, `null`, `undefined` et `''` sont traités comme ABSENTS : côté
 * moteur, `exception_vacances_scolaires: false` et l'absence du champ donnent
 * exactement le même comportement (`Boolean(undefined)` vaut `false`). Les
 * distinguer, c'était laisser passer le doublon d'Anne-Catherine.
 */
function empreinteParams(params: Record<string, unknown>): Record<string, unknown> {
  const sortie: Record<string, unknown> = {}
  for (const cle of Object.keys(params).sort()) {
    if (DECORATIFS.has(cle)) continue
    const brute = params[cle]
    if (brute === false || brute === null || brute === undefined || brute === '') continue
    if (Array.isArray(brute) && brute.length === 0) continue
    sortie[cle] = normaliser(brute)
  }
  return sortie
}

/**
 * L'empreinte d'une règle : deux règles de même brique et de même empreinte
 * produisent le MÊME comportement du moteur, quels que soient leurs textes.
 *
 * Ne tient PAS compte de la force : « mercredi interdit » et « mercredi évité »
 * sont bien la même règle, à deux niveaux de fermeté — c'est un doublon, et
 * c'est justement ce qu'on veut signaler (il faut régler l'existante, pas en
 * ajouter une seconde qui la contredira).
 */
export function empreinteRegle(briqueId: string, params: unknown): string {
  const objet =
    params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {}
  return `${briqueId}::${JSON.stringify(empreinteParams(objet))}`
}

/** Les params d'une ligne `regles_cabinet` (`params_json.params`). */
export function paramsDeRow(paramsJson: unknown): Record<string, unknown> {
  const p = (paramsJson as { params?: unknown })?.params
  return p && typeof p === 'object' && !Array.isArray(p)
    ? (p as Record<string, unknown>)
    : {}
}
