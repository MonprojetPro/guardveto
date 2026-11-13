// ============================================================
// GUARDVETO — Grand livre d'équité inter-périodes (B-196, lot 0)
// ============================================================
// Calcul PUR (aucun accès DB) du report d'équité d'une période sur
// l'autre, et application de ce report aux compteurs du moteur.
//
// ── CE QUE CE FICHIER RÉPARE ────────────────────────────────
//
// Avant lui, le rattrapage inter-périodes était une PROMESSE NON TENUE :
//
//   • `loader.ts` ne chargeait que `ecart_we`, et seulement celui de la
//     SEULE période précédente. Les écarts de semaine, de fériés et de
//     grands week-ends étaient écrits en base par quatre chemins
//     (`api/bilan`, cron `lock-gardes`, import, `appliquer-changement`)
//     et relus par PERSONNE.
//   • `scorerCandidatLNS` (phase d'amélioration) ignorait le report :
//     elle pouvait défaire le rattrapage posé au premier jet.
//   • `scorerPlanning` (score final, celui qui ACCEPTE ou REFUSE une
//     amélioration) l'ignorait aussi — il jugeait l'équité sur la seule
//     période en cours.
//
// Mesure réelle au Cabinet du Val d'Allier, 3 périodes closes (lue en
// base le 2026-11-13, cf. `__tests__/grand-livre-equite.test.ts`) :
//   • Victor : +3 week-ends en cumul — le moteur n'en voyait que +1.
//   • Antoine : +5 gardes de semaine en cumul — le moteur n'en voyait
//     AUCUNE, la dimension n'étant pas chargée du tout.
//
// ── LA CONVENTION DE SIGNE, UNE FOIS POUR TOUTES ────────────
//
// En base (`bonus_malus.ecart_*`, produit par `engine/bilan.ts`) :
//     écart > 0 = ce véto a fait PLUS que sa quote-part.
//
// Dans le report (ce fichier, et `SolverInput.reportEquite`) :
//     report > 0 = ce véto doit faire PLUS de gardes cette période.
//
// Les deux sont donc OPPOSÉS, et c'est volontaire : le moteur raisonne
// en « qui dois-je servir en premier », pas en « qui a trop donné ».
// `report = -cumul des écarts`, plafonné (voir PLAFOND_RATTRAPAGE).
//
// C'est la convention qu'avait déjà `loader.ts` (`bonusMalus[id] =
// -bm.ecart_we`) et qu'attendait `scorerCandidat` (`c.weGardes - bm`) :
// elle est conservée telle quelle pour que le comportement week-end du
// premier jet reste identique à poids égal.
// ============================================================

import type { CompteurVet } from './rules/optimization'

// ── Les dimensions reportées ─────────────────────────────

/**
 * Les dimensions d'équité qui se reportent d'une période sur l'autre.
 *
 * ⚠️ IL N'Y A PAS DE DIMENSION « GRANDS WEEK-ENDS » ICI, ET C'EST UN
 * CHOIX PROUVÉ, PAS UN OUBLI.
 *
 * `bonus_malus.ecart_grands_we` existe bien en base, mais c'est le
 * MIROIR EXACT de `ecart_we` pour les salariés :
 *   • `bilan.ts` calcule `grands_we_realise = totalWE - we_total`
 *     (les week-ends LIBRES), donc `ecart_grands_we ≈ -ecart_we` ;
 *   • `optimization.ts` compte `grandsWePerdus++` dans la MÊME branche
 *     que `weGardes++`, pour les salariés — les deux compteurs sont
 *     égaux par construction.
 * Vérifié sur les données réelles : Victor P1 a `ecart_we` +1 et
 * `ecart_grands_we` -1 ; Antoine P2 a -1 et +1.
 *
 * Reporter les deux aurait donc compté DEUX FOIS la même dette pour
 * chaque salarié. Le report `we` est appliqué aux deux compteurs par
 * `compteursEffectifs` — un seul phénomène, ses deux mesures.
 */
export const DIMENSIONS_REPORT = ['we', 'semaine', 'feries'] as const
export type DimensionReport = (typeof DIMENSIONS_REPORT)[number]

/** Report d'équité d'un vétérinaire. `> 0` = doit faire PLUS (voir en-tête). */
export type ReportEquite = Record<DimensionReport, number>

/** Report d'équité par vétérinaire. `{}` = aucun report (comportement d'avant). */
export interface ReportEquiteMap {
  [vetId: string]: ReportEquite
}

/** Report nul — un véto sans historique, ou hors périmètre d'équité. */
export function reportVide(): ReportEquite {
  return { we: 0, semaine: 0, feries: 0 }
}

// ── Le plafond de rattrapage ─────────────────────────────

/**
 * Combien de gardes, au PLUS, se rattrapent sur UNE période.
 *
 * Sans plafond, Victor rendrait ses 3 week-ends d'un coup : trois
 * week-ends de suite sans garde pour lui, et une période entière
 * déformée pour rembourser l'histoire. Le reliquat n'est pas perdu —
 * il reste dans le cumul et repassera à la période suivante, puisque
 * le cumul est recalculé à chaque génération depuis les bilans.
 *
 * Décision de MiKL le 2026-11-13 (zone d'ombre n°2 du lot 0) : au plus
 * 1 week-end et 2 gardes de semaine par personne et par période. Les
 * fériés suivent le week-end (1), étant aussi rares et aussi visibles.
 *
 * ⚠️ Constantes volontairement NON réglables dans ce lot : un réglage
 * de plus dans un onglet déjà jugé « imbuvable » (B-204) serait un
 * recul. À rendre réglable avec la refonte de l'onglet Organisation,
 * pas avant.
 */
export const PLAFOND_RATTRAPAGE: ReportEquite = { we: 1, semaine: 2, feries: 1 }

// ── Entrée : les bilans de périodes closes ───────────────

/**
 * Une ligne de `bonus_malus` telle que la base la rend.
 *
 * `ecart_grands_we` n'est VOLONTAIREMENT pas dans ce type : voir
 * DIMENSIONS_REPORT. Le charger laisserait croire qu'il est utilisé.
 */
export interface LigneBilan {
  veterinaire_id: string
  ecart_we: number
  ecart_semaine: number
  ecart_feries: number
}

/** Cumul BRUT des écarts, dans le sens de la base (`> 0` = a fait plus). */
export type CumulEcarts = Record<DimensionReport, number>

/**
 * cumulerEcarts — somme les écarts de TOUTES les périodes fournies.
 *
 * Aucun filtrage, aucun plafond, aucune inversion de signe : l'appelant
 * donne les lignes qu'il veut cumuler (à lui de ne passer que les
 * périodes de GARDES antérieures), et récupère la dette réelle, lisible
 * telle quelle à côté de l'écran Historique.
 *
 * Un vétérinaire sans aucune ligne est absent du résultat — c'est la
 * réponse à « un nouveau démarre à zéro » (zone d'ombre n°3) : pas de
 * ligne, pas de dette, pas de crédit.
 */
export function cumulerEcarts(lignes: LigneBilan[]): Record<string, CumulEcarts> {
  const cumul: Record<string, CumulEcarts> = {}

  for (const l of lignes) {
    const c = (cumul[l.veterinaire_id] ??= { we: 0, semaine: 0, feries: 0 })
    // `?? 0` : une colonne nulle en base (ligne écrite par un chemin plus
    // ancien) vaut « pas d'écart », jamais NaN — un NaN se propagerait
    // dans tout le scoring sans lever la moindre erreur.
    c.we += l.ecart_we ?? 0
    c.semaine += l.ecart_semaine ?? 0
    c.feries += l.ecart_feries ?? 0
  }

  return cumul
}

/**
 * construireReport — le grand livre : du cumul des bilans au report que
 * le moteur applique.
 *
 * Trois gestes, dans cet ordre :
 *   1. cumuler les écarts de toutes les périodes passées ;
 *   2. inverser le signe (dette → « doit faire plus », cf. en-tête) ;
 *   3. plafonner par PLAFOND_RATTRAPAGE.
 *
 * @param lignes   Bilans des périodes de GARDES antérieures (toutes).
 * @param vetIds   Les vétérinaires du périmètre d'équité — c'est-à-dire
 *   l'EFFECTIF de la génération, dernier recours exclu. Décisif : au
 *   Val d'Allier, Anne-Catherine (dernier recours) porte -12 gardes de
 *   semaine en cumul. Entrée dans le report, elle réclamerait un
 *   rattrapage massif pour quelqu'un qui n'est JAMAIS candidat — et
 *   tirerait à elle seule la variance du score final.
 * @param plafonds Repli PLAFOND_RATTRAPAGE (tests, mesures).
 */
export function construireReport(
  lignes: LigneBilan[],
  vetIds: string[],
  plafonds: ReportEquite = PLAFOND_RATTRAPAGE,
): ReportEquiteMap {
  const cumul = cumulerEcarts(lignes)
  const report: ReportEquiteMap = {}

  for (const vetId of vetIds) {
    const c = cumul[vetId]
    if (!c) continue // aucun historique → aucun report (objet absent, pas un zéro)

    const r: ReportEquite = {
      we: borner(-c.we, plafonds.we),
      semaine: borner(-c.semaine, plafonds.semaine),
      feries: borner(-c.feries, plafonds.feries),
    }

    // Un report entièrement nul n'est pas stocké : `{}` doit rester la
    // marque d'« aucun report », et un objet de zéros se comporte à
    // l'identique sans alourdir la lecture au débogage.
    if (r.we !== 0 || r.semaine !== 0 || r.feries !== 0) report[vetId] = r
  }

  return report
}

/** Borne une valeur dans [-plafond, +plafond]. Plafond <= 0 → dimension neutralisée. */
function borner(valeur: number, plafond: number): number {
  if (!Number.isFinite(plafond) || plafond <= 0) return 0
  return Math.max(-plafond, Math.min(plafond, valeur))
}

// ── Sortie : les compteurs que le moteur doit juger ──────

/**
 * compteursEffectifs — les compteurs de la période, report compris.
 *
 * C'EST LA SOURCE UNIQUE du rattrapage. Les trois endroits qui jugeaient
 * l'équité le faisaient sur trois vues différentes — premier jet avec le
 * report sur les week-ends seuls, phase d'amélioration sans report du
 * tout, score final sans report non plus. Un rattrapage posé pouvait
 * donc être défait deux étapes plus loin sans qu'aucune alarme ne sonne.
 * Tous passent maintenant par cette fonction.
 *
 * Le report est SOUSTRAIT : un véto qui doit faire plus (report > 0) voit
 * son compteur baisser, donc il passe devant au tri, et la variance le
 * voit sous-chargé. C'est la formule qu'avait déjà `scorerCandidat`
 * (`weEffectif = c.weGardes - bm`), étendue aux autres dimensions.
 *
 * Choix à connaître — LE REPORT DE SEMAINE VA SUR `semainePremier` :
 *   le bilan suit UN écart de semaine (`sem_total`, toutes places
 *   confondues) tandis que le moteur tient TROIS compteurs
 *   (`semainePremier`, `semaineSecond`, `semaineRenfort`). L'appliquer
 *   aux trois donnerait au véto en dette jusqu'à trois fois son
 *   rattrapage ; en créer un quatrième compteur « total semaine »
 *   ajouterait une dimension au score lexicographique, donc déplacerait
 *   des arbitrages que personne n'a demandé de déplacer. Il va donc sur
 *   la place principale, celle du 1er de garde. Conséquence assumée :
 *   une dette contractée en 2nd se rembourse en 1er.
 *
 * `weekendPremier`, `semaineSecond` et `semaineRenfort` ne reçoivent
 * aucun report : le bilan ne mesure pas ces rôles, il n'y a donc rien à
 * reporter — et inventer un report non mesuré serait exactement la
 * « fausse assurance » que ce lot combat.
 *
 * Report vide → les compteurs sont renvoyés TELS QUELS (même référence),
 * donc le comportement d'un cabinet sans historique est inchangé.
 */
export function compteursEffectifs(
  compteurs: CompteurVet[],
  report: ReportEquiteMap,
  vets: ReadonlyArray<{ id: string; statut?: string | null }>,
): CompteurVet[] {
  if (Object.keys(report).length === 0) return compteurs

  // `grandsWePerdus` n'existe QUE pour les salariés : `compterParVet` ne
  // l'incrémente que sous `if (vet.statut === 'salarie')`. Pour un associé,
  // il vaut 0 dans TOUS les plannings — lui soustraire un report le ferait
  // descendre à -1 sur un compteur qui n'a aucun sens pour lui.
  //
  // ⚠️ Ce n'est pas théorique. `desequilibreGrandsWeSalaries` filtre bien les
  // salariés, mais DEUX autres lecteurs ne filtrent rien : l'étage
  // EQUITE_CRITIQUE (`ecartMaxMin` sur tous les compteurs) et
  // `variancesCohortes` (variance sur les porteurs d'un tag, quel que soit
  // leur statut). Dès qu'un cabinet règle le seuil critique des grands
  // week-ends ou pose une cohorte mixte, le moteur paierait une pénalité de
  // « déséquilibre critique » pour un déséquilibre qui n'existe pas, et
  // choisirait un planning moins bon. Relevé par la revue du 2026-11-13.
  const salaries = new Set(
    vets.filter((v) => v.statut === 'salarie').map((v) => v.id),
  )

  return compteurs.map((c) => {
    const r = report[c.vetId]
    if (!r) return c

    return {
      ...c,
      weGardes: c.weGardes - r.we,
      // Deux mesures du MÊME phénomène (cf. DIMENSIONS_REPORT), donc un seul
      // report — mais seulement là où le compteur existe.
      grandsWePerdus: salaries.has(c.vetId) ? c.grandsWePerdus - r.we : c.grandsWePerdus,
      semainePremier: c.semainePremier - r.semaine,
      feriesGardes: c.feriesGardes - r.feries,
    }
  })
}

/** Le report d'un véto, ou un report nul s'il n'en a pas. */
export function reportDe(report: ReportEquiteMap, vetId: string): ReportEquite {
  return report[vetId] ?? reportVide()
}
