// ============================================================
// GUARDVETO — Libellés humains des types de garde (P3b)
// ============================================================
// Source UNIQUE du libellé d'un type de garde tel qu'il sort de la table
// `gardes` (V1). Avant P3b, chaque composant portait son propre ternaire
// weekend/ferie/« semaine » — un type sur-mesure y était étiqueté « Soir
// semaine » (faux) voire « Jour férié » (agenda — mensonger). Désormais :
//   • les 3 types V1 gardent leurs libellés historiques ;
//   • un type SUR-MESURE prend le NOM du catalogue si fourni (nomsTypes),
//     sinon son code humanisé (« sm_garde_jour » → « Garde jour »).
// ============================================================

/** « sm_garde_jour » → « Garde jour » (repli sans catalogue). */
export function humaniserCodeGarde(code: string): string {
  const sansPrefixe = code.startsWith('sm_') ? code.slice(3) : code
  const mots = sansPrefixe.replace(/[_-]+/g, ' ').trim()
  return mots.length === 0 ? code : mots.charAt(0).toUpperCase() + mots.slice(1)
}

/**
 * Libellé d'un type de la table `gardes`.
 * @param nomsTypes  map code → nom du catalogue (creneau_modele), si le
 *                   consommateur y a accès — c'est le libellé le plus juste.
 */
export function libelleTypeGardeDb(
  type: string,
  nomsTypes?: Record<string, string>,
): string {
  // Types V1 d'abord : libellés historiques STABLES pour les cabinets existants.
  if (type === 'weekend') return 'Week-end'
  if (type === 'ferie') return 'Jour férié'
  if (type === 'semaine') return 'Soir semaine'
  const nom = nomsTypes?.[type]
  if (nom) return nom
  return humaniserCodeGarde(type)
}
