// ============================================================
// GUARDVETO — Le gabarit du titre d'un événement Google Agenda
// ============================================================
// Décidé par MiKL, séparateur tiret : base - nom - rôle [- horaires].
// Exemples : « garde-ACB-1er » · « garde-ACB-1er-18h/08h ».
//
// Le rôle DOIT toujours apparaître : sans lui, les deux événements du même
// jour (1er et 2nd de garde) sont indiscernables dans l'agenda.
//
// ⚠️ Cette fonction est PURE : elle reçoit tout en paramètre (base, nom,
// rôle, horaires, option) et ne recalcule ni ne décale jamais les horaires
// qu'on lui donne. Un bug distinct de production affiche 20h/10h au lieu de
// 18h/08h — c'est le calcul EN AMONT qui est fautif, pas ce gabarit ; le
// reproduire ici referait la même erreur une deuxième fois.
// ============================================================

export interface HorairesGarde {
  debut: string
  fin: string
}

// ── Le rôle, en court (B-080) ────────────────────────────────
//
// MiKL, en recette du 27/08 : l'agenda affichait `Garde-JD-premier` et
// `Garde-VC-second`. Il veut « 1er » et « 2nd », « et pareil s'il y a un 3ème ».
//
// L'ORIGINE N'EST PAS UN BUG DE CODE : `creneau_modele.roles` vaut littéralement
// `['premier','second']` en base, et c'est correct — ce sont les libellés que
// l'écran Créneaux propose d'office (`ROLES_AUTO`), et le moteur comme d'autres
// affichages s'en servent. ⛔ Les renommer en base changerait le vocabulaire de
// TOUTE l'application pour un besoin propre au bandeau d'agenda. La correction
// est donc ici, dans la couche d'affichage, et nulle part ailleurs.
//
// ⚠️ ET UN CABINET QUI A NOMMÉ SES RÔLES GARDE SES MOTS. « titulaire » et
// « renfort » passent intacts : il les a choisis exprès, les abréger effacerait
// sa décision. Seuls les noms canoniques du projet s'abrègent.

/**
 * Les noms canoniques et leur forme courte — SOURCE UNIQUE (B-081).
 *
 * `roleClair` (`src/data/v2/reglesStructure.ts`) lit cette table-ci ; elle a
 * cessé de porter la sienne le 2026-08-27. Le sens de la dépendance est
 * imposé : ce module est une FEUILLE (l'aperçu du titre s'affiche côté client,
 * dans l'écran Réglages), tandis que `reglesStructure` tire
 * `@/data/chargerCreneauModele`. C'est donc le module serveur qui importe la
 * feuille, jamais l'inverse.
 *
 * ⚠️ LA TABLE EST PARTAGÉE, PAS LA FONCTION — et c'est délibéré. Les deux
 * lecteurs ont des politiques de recherche DIFFÉRENTES, chacune juste chez
 * elle :
 *   • `roleCourt` normalise (casse, accents, espaces) et se replie sur la
 *     place, parce qu'un titre d'agenda doit TOUJOURS porter un rôle — sans
 *     lui, les deux événements du même jour sont indiscernables ;
 *   • `roleClair` cherche à l'identique et ne se replie pas, parce qu'une
 *     phrase de règles doit rendre le libellé du cabinet tel qu'il l'a écrit.
 * Les aligner ferait basculer l'écran « Règles & structure » (« Premier »
 * deviendrait « 1er ») sans que personne ne l'ait demandé.
 * Filet : `tests/lib/regles-structure-role-clair.test.ts`.
 */
export const ROLES_COURTS: Record<string, string> = {
  premier: '1er',
  second: '2nd',
  troisieme: '3e',
  quatrieme: '4e',
  cinquieme: '5e',
}

/** Sans accents, sans casse : « Troisième » et « troisieme » sont le même mot. */
function normaliser(v: string): string {
  // ̀-ͯ : les diacritiques que `NFD` détache des lettres. Écrire ces
  // caractères combinants littéralement dans la regex les rendrait invisibles
  // à la relecture, et un seul mal recopié casserait la correspondance.
  return v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * La forme courte d'un rôle de place, pour un titre d'agenda.
 *
 * `premier` → « 1er », `second` → « 2nd », `troisieme` → « 3e »… Tout autre
 * libellé est rendu TEL QUEL : c'est le mot du cabinet.
 *
 * `placeIndex` sert uniquement de repli quand le rôle est vide — le rôle DOIT
 * toujours apparaître dans le titre, sinon les deux événements du même jour
 * (1er et 2nd de garde) deviennent indiscernables dans la grille.
 */
export function roleCourt(role: string | null | undefined, placeIndex: number): string {
  const brut = (role ?? '').trim()
  if (!brut) return placeIndex === 0 ? '1er' : placeIndex === 1 ? '2nd' : `${placeIndex + 1}e`
  return ROLES_COURTS[normaliser(brut)] ?? brut
}

export interface OptionsLibelleGarde {
  base: string
  nom: string
  role: string
  /** Horaires réels, ou absents. Ignorés si `afficherHoraires` est faux. */
  horaires?: HorairesGarde | null
  /** Coché par le cabinet dans sa config — voir `couverture-produit.ts`. */
  afficherHoraires: boolean
}

/**
 * Compose le titre. Chaque segment vide est simplement omis — jamais de
 * tiret orphelin en fin de chaîne, jamais de double tiret pour un segment
 * manquant au milieu (nom vide entre base et rôle, par exemple).
 */
export function libelleGarde({
  base,
  nom,
  role,
  horaires,
  afficherHoraires,
}: OptionsLibelleGarde): string {
  const segments: string[] = []

  const baseTrim = base.trim()
  if (baseTrim) segments.push(baseTrim)

  const nomTrim = nom.trim()
  if (nomTrim) segments.push(nomTrim)

  const roleTrim = role.trim()
  if (roleTrim) segments.push(roleTrim)

  // L'option est cochée mais les horaires manquent (garde non encore
  // chiffrée, période sans créneau standard) : on omet le segment plutôt
  // que d'afficher un trou ou une valeur inventée.
  if (afficherHoraires && horaires) {
    const debut = horaires.debut.trim()
    const fin = horaires.fin.trim()
    if (debut && fin) segments.push(`${debut}/${fin}`)
  }

  return segments.join('-')
}
