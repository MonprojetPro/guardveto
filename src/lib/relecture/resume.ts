// ============================================================
// GUARDVETO — Résumer un rapport de relecture (B-107)
// ============================================================
// MiKL, le 2026-09-02, trois captures à l'appui : « c'est imbuvable, c'est
// super long, personne ne va prendre le temps de lire tout ça ».
//
// Il avait raison, et le fond n'était pas en cause : l'écran affichait NEUF
// constats de même taille, dont sept parlaient d'Antoine, plus la liste
// intégrale de chaque mouvement, ligne par ligne. Trois écrans de défilement
// pour une information qui tient en dix lignes.
//
// ── CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS ─────────────────────────
//
// Il CALCULE des résumés à partir de ce qui est déjà affiché : qui perd des
// gardes, qui en prend, quel prénom revient dans quels constats.
//
// Il ne REFORMULE jamais. Le motif de Filou reste affiché tel quel — le
// réécrire ferait dire au produit ce que Filou n'a pas dit, et c'est la règle
// de maison depuis B-062. Un résumé qui compte n'est pas un résumé qui
// interprète.
//
// ── LE REPLI EST HONNÊTE, PAS SILENCIEUX ───────────────────────────────────
//
// Si la lecture d'un mouvement échoue (format inattendu), on n'affirme rien :
// on retombe sur « N changements », qui est vrai. Une phrase inventée serait
// pire que pas de phrase — c'est exactement ce que ce projet combat.
// ============================================================

/**
 * Ce qu'un mouvement change, compté par personne.
 *
 * Les gestes s'écrivent tous « … : ENTRANT à la place de SORTANT ». On lit donc
 * qui prend la place et qui la quitte, sans jamais deviner.
 */
export interface EffetSurLesPersonnes {
  /** Prénom → nombre de places perdues. */
  allege: Map<string, number>
  /** Prénom → nombre de places prises. */
  charge: Map<string, number>
  /** Vrai si TOUS les gestes ont pu être lus. Sinon, on n'affirme rien. */
  complet: boolean
}

const FORME_GESTE = / : (.+?) à la place de (.+?)\s*$/

export function effetSurLesPersonnes(gestes: string[]): EffetSurLesPersonnes {
  const allege = new Map<string, number>()
  const charge = new Map<string, number>()
  let complet = gestes.length > 0

  for (const geste of gestes) {
    const m = FORME_GESTE.exec(geste)
    if (!m) { complet = false; continue }
    const [, entrant, sortant] = m
    charge.set(entrant, (charge.get(entrant) ?? 0) + 1)
    allege.set(sortant, (allege.get(sortant) ?? 0) + 1)
  }

  // Une personne qui sort d'une place et en reprend une autre dans le MÊME
  // mouvement n'est ni allégée ni chargée : elle est déplacée. L'annoncer
  // « -1 » serait faux, et c'est précisément l'erreur que B-098 a coûtée.
  for (const [qui, perdues] of [...allege]) {
    const prises = charge.get(qui) ?? 0
    const net = perdues - prises
    if (net > 0) { allege.set(qui, net); charge.delete(qui) }
    else if (net < 0) { charge.set(qui, -net); allege.delete(qui) }
    else { allege.delete(qui); charge.delete(qui) }
  }

  return { allege, charge, complet }
}

/**
 * TOUTES les personnes qu'un mouvement a touchées — B-118, 07/09.
 *
 * ⚠️ À NE PAS CONFONDRE AVEC `effetSurLesPersonnes`, et c'est tout l'intérêt.
 * Celle-là compte le NET : quelqu'un qui quitte une place et en reprend une
 * autre dans le même mouvement en disparaît, puisqu'il n'est ni allégé ni
 * chargé. C'est juste pour un bilan (« Antoine −1 · Fanny +1 »), et faux pour
 * répondre à « ce mouvement le concerne-t-il ? » : sur le rapport du 07/09,
 * Jean échangeait deux soirs de semaine sans rien gagner ni perdre — invisible
 * au bilan, bel et bien déplacé dans les faits.
 *
 * On lit donc les gestes BRUTS, entrants et sortants confondus.
 */
export function personnesTouchees(gestes: string[]): Set<string> {
  const qui = new Set<string>()
  for (const geste of gestes) {
    const m = FORME_GESTE.exec(geste)
    if (!m) continue
    qui.add(m[1])
    qui.add(m[2])
  }
  return qui
}

/**
 * Le résumé d'un mouvement en une ligne : « Antoine −1 · Fanny +1 ».
 *
 * Rend `null` si un seul geste n'a pas pu être lu : mieux vaut le compte brut
 * (« 6 changements ») qu'un résumé partiel présenté comme complet.
 */
export function resumerEffet(gestes: string[]): string | null {
  const { allege, charge, complet } = effetSurLesPersonnes(gestes)
  if (!complet || (allege.size === 0 && charge.size === 0)) return null

  const parts = [
    ...[...allege].map(([qui, n]) => `${qui} −${n}`),
    ...[...charge].map(([qui, n]) => `${qui} +${n}`),
  ]
  return parts.join(' · ')
}

/**
 * Le premier prénom de l'équipe cité dans un texte, ou `null`.
 *
 * Sert à regrouper les constats PAR PERSONNE plutôt que par critère : sur le
 * rapport du 02/09, sept constats sur neuf parlaient d'Antoine. Groupés, ils
 * deviennent une ligne dépliable au lieu de sept cartes identiques.
 *
 * Les prénoms sont triés du plus long au plus court : sans ça, « Anne » serait
 * trouvé dans « Anne-Sophie » et deux personnes distinctes se confondraient.
 */
export function prenomCite(texte: string, prenoms: string[]): string | null {
  const candidats = [...prenoms].sort((a, b) => b.length - a.length)
  let meilleur: { prenom: string; index: number } | null = null

  for (const prenom of candidats) {
    const i = texte.indexOf(prenom)
    if (i === -1) continue
    // Le premier CITÉ dans la phrase, pas le premier de la liste : le sujet
    // d'un constat est presque toujours nommé en tête.
    if (!meilleur || i < meilleur.index) meilleur = { prenom, index: i }
  }
  return meilleur?.prenom ?? null
}

// ── HUMANISER LES OBJECTIONS DU MOTEUR (B-107, 03/09) ──────────────────────
//
// Les objections viennent de `Violation.detail` (engine/validation/validerPlanning.ts) :
// des phrases écrites pour un log, pas pour un écran — « (min 2) » entre
// parenthèses, « jour(s) » toujours au singulier-pluriel. Ce fichier ne
// touche PAS `Violation.detail` : cette valeur est lue ailleurs dans le
// produit (CartesViolations, GardienFilou) et la réécrire déplacerait le
// problème au lieu de le résoudre — INSPECTION CONSUMERS oblige. On humanise
// seulement AU MOMENT DE L'AFFICHAGE, dans ce seul écran.
//
// Repli honnête : si la phrase ne correspond à aucun motif connu, elle
// s'affiche TELLE QUELLE. Un motif mal reconnu et mal reformulé serait pire
// qu'une phrase technique mais juste.

const RE_ESPACEMENT = /^(.+?) — seulement (\d+) jour\(s\) entre le (.+?) et (.+?) \(min (\d+)\)$/
const RE_ESPACEMENT_WEEKEND =
  /^(.+?) — deux week-ends à (\d+) jour\(s\) d'écart \((.+?)\), min 1 toutes les (\d+) semaines$/
const RE_REPOS_SERIE =
  /^(.+?) est de garde le (.+?) alors qu'une série d'au moins (\d+) jours \(fin le (.+?)\) impose (\d+) jour\(s\) de repos$/

function accordSuffixe(n: string): string {
  return n === '1' ? '' : 's'
}

export function humaniserObjection(brut: string): string {
  let m = RE_ESPACEMENT.exec(brut)
  if (m) {
    const [, qui, j, d1, d2, min] = m
    return `${qui} n’aurait que ${j} jour${accordSuffixe(j)} de repos entre le ${d1} et le ${d2} — il en faut ${min}.`
  }

  m = RE_ESPACEMENT_WEEKEND.exec(brut)
  if (m) {
    const [, qui, j, plage, n] = m
    return `${qui} enchaînerait deux week-ends à ${j} jour${accordSuffixe(j)} d’écart (${plage}) — il en faut au moins ${n} semaine${accordSuffixe(n)}.`
  }

  m = RE_REPOS_SERIE.exec(brut)
  if (m) {
    const [, qui, jour, n, fin, repos] = m
    return `${qui} serait de garde le ${jour}, juste après une série de ${n} jours (jusqu’au ${fin}) qui impose ${repos} jour${accordSuffixe(repos)} de repos.`
  }

  return brut
}

// ── LA LISTE DES MOUVEMENTS EN TABLEAU (B-107, 03/09) ──────────────────────
//
// Un geste s'écrit « DATE · CRÉNEAU[ · ORDRE] : ENTRANT à la place de SORTANT ».
// Affichée en puces, cette syntaxe reste illisible au-delà de deux lignes.
// En tableau, chaque colonne se scanne verticalement.

export interface GesteAnalyse {
  date: string
  creneau: string
  entrant: string
  sortant: string
}

const FORME_GESTE_DETAIL = / : (.+?) à la place de (.+?)\s*$/

/** Découpe un geste en colonnes. Rend `null` si la forme est inattendue. */
export function parserGeste(geste: string): GesteAnalyse | null {
  const m = FORME_GESTE_DETAIL.exec(geste)
  if (!m) return null
  const avant = geste.slice(0, m.index)
  const segments = avant.split(' · ').map((s) => s.trim()).filter(Boolean)
  if (segments.length < 2) return null
  const [date, ...reste] = segments
  return { date, creneau: reste.join(' · '), entrant: m[1], sortant: m[2] }
}

/**
 * Analyse TOUS les gestes, ou aucun : un tableau à moitié vide serait plus
 * trompeur que la liste à puces d'origine, qui reste le repli.
 */
export function parserGestes(gestes: string[]): GesteAnalyse[] | null {
  const analyses = gestes.map(parserGeste)
  return analyses.every((a): a is GesteAnalyse => a !== null) ? analyses : null
}

/** Un groupe de constats qui parlent de la même personne. */
export interface GroupeConstats<T> {
  /** Le prénom, ou `null` pour ce qui ne vise personne en particulier. */
  qui: string | null
  points: T[]
}

/**
 * Regroupe des constats par personne citée, en gardant l'ordre d'origine.
 *
 * L'ordre compte : Filou classe ses constats par importance, et un regroupement
 * qui les réordonnerait ferait remonter un point mineur au-dessus d'un point
 * grave. On regroupe, on ne rejuge pas.
 */
export function grouperParPersonne<T extends { constat: string }>(
  points: T[],
  prenoms: string[],
): GroupeConstats<T>[] {
  if (prenoms.length === 0) return points.length > 0 ? [{ qui: null, points }] : []

  const groupes: GroupeConstats<T>[] = []
  const index = new Map<string, GroupeConstats<T>>()

  for (const p of points) {
    const qui = prenomCite(p.constat, prenoms)
    const cle = qui ?? ' sans-personne'
    let g = index.get(cle)
    if (!g) {
      g = { qui, points: [] }
      index.set(cle, g)
      groupes.push(g)
    }
    g.points.push(p)
  }
  return groupes
}
