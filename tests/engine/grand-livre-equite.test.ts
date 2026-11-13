// ============================================================
// GUARDVETO — Grand livre d'équité : banc d'essai sur les VRAIES données
// ============================================================
// B-196 lot 0. Ce banc ne construit pas un cas d'école : il rejoue les
// bilans RÉELS des trois périodes closes du Cabinet du Val d'Allier,
// lus en base le 2026-11-13 (table `bonus_malus`, périodes « Historique
// été 2026 », « Hiver P1 », « Hiver P2 »).
//
// Pourquoi de vraies données : un cas construit prouve que la fonction
// calcule ce qu'on a écrit dans le cas. Les deux écarts qui ont motivé
// tout ce lot — Victor et Antoine — ne se voient QUE sur les vrais
// chiffres, et c'est sur eux que porte la mesure avant/après.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  construireReport,
  cumulerEcarts,
  compteursEffectifs,
  reportDe,
  PLAFOND_RATTRAPAGE,
  type LigneBilan,
  type ReportEquiteMap,
} from '@/engine/grand-livre-equite'
import type { CompteurVet } from '@/engine/rules/optimization'

// ── Les vétérinaires du pilote ───────────────────────────
const VET = {
  anneSophie: 'anne-sophie',
  fanny: 'fanny',
  jean: 'jean',
  anneCat: 'anne-catherine', // DERNIER RECOURS — hors effectif de génération
  manon: 'manon',
  antoine: 'antoine',
  victor: 'victor',
} as const

/** L'effectif réel d'une génération : tout le monde SAUF le dernier recours. */
const EFFECTIF = [
  VET.anneSophie, VET.fanny, VET.jean, VET.manon, VET.antoine, VET.victor,
]

// ── Les bilans réels, tels qu'ils sont en base ───────────
// Relevé du 2026-11-13 :
//   select v.prenom, p.libelle, b.ecart_we, b.ecart_semaine, b.ecart_feries
//   from bonus_malus b join periodes p … join veterinaires v …
//   where c.nom like 'Cabinet%Val%' order by v.prenom, p.date_debut;
//
// (`ecart_grands_we` est relevé mais NON reporté — c'est le miroir de
//  `ecart_we`, cf. DIMENSIONS_REPORT dans grand-livre-equite.ts.)
function bilan(
  veterinaire_id: string, ecart_we: number, ecart_semaine: number, ecart_feries: number,
): LigneBilan {
  return { veterinaire_id, ecart_we, ecart_semaine, ecart_feries }
}

/** Historique été 2026 (importé, 2026-09-07 → 09-20). */
const ETE_2026: LigneBilan[] = [
  bilan(VET.anneCat, -1, 0, 0),
  bilan(VET.anneSophie, 1, 0, 0),
  bilan(VET.antoine, 0, 0, 0),
  bilan(VET.fanny, -1, 0, 0),
  bilan(VET.jean, 1, 0, 0),
  bilan(VET.manon, 1, 0, 0),
  bilan(VET.victor, 1, 0, 0),
]

/** Hiver P1 (2026-09-21 → 10-18). */
const HIVER_P1: LigneBilan[] = [
  bilan(VET.anneCat, -1, -6, 0),
  bilan(VET.anneSophie, 0, 1, 0),
  bilan(VET.antoine, 0, 2, 0),
  bilan(VET.fanny, 0, 2, 0),
  bilan(VET.jean, 1, 2, 0),
  bilan(VET.manon, 0, -2, 0),
  bilan(VET.victor, 1, -1, 0),
]

/** Hiver P2 (2026-10-19 → 11-29) — la dernière période close. */
const HIVER_P2: LigneBilan[] = [
  bilan(VET.anneCat, -2, -6, 0),
  bilan(VET.anneSophie, 0, 1, 0),
  bilan(VET.antoine, -1, 3, 0),
  bilan(VET.fanny, 0, -1, 0),
  bilan(VET.jean, -1, 0, 0),
  bilan(VET.manon, 0, 1, 1),
  bilan(VET.victor, 1, 3, 1),
]

const TOUTES_LES_PERIODES = [...ETE_2026, ...HIVER_P1, ...HIVER_P2]

// ============================================================
// 1. Le cumul dit la vérité que le moteur ne voyait pas
// ============================================================

describe('Grand livre — cumul des trois périodes réelles du Val d’Allier', () => {
  const cumul = cumulerEcarts(TOUTES_LES_PERIODES)

  it('Victor a bien +3 week-ends en cumul, pas +1', () => {
    // +1 (été) +1 (P1) +1 (P2). Le moteur ne lisait QUE la dernière
    // période close : il n'en voyait qu'un seul sur trois.
    expect(cumul[VET.victor].we).toBe(3)
    expect(HIVER_P2.find((b) => b.veterinaire_id === VET.victor)!.ecart_we).toBe(1)
  })

  it('Antoine a +5 gardes de semaine en cumul, que le moteur ne voyait pas du tout', () => {
    // 0 (été) +2 (P1) +3 (P2). La dimension « semaine » n'était pas
    // chargée : `loader.ts` ne sélectionnait que `ecart_we`.
    expect(cumul[VET.antoine].semaine).toBe(5)
  })

  it('les écarts de fériés, eux aussi ignorés jusqu’ici, se cumulent', () => {
    expect(cumul[VET.victor].feries).toBe(1)
    expect(cumul[VET.manon].feries).toBe(1)
    expect(cumul[VET.jean].feries).toBe(0)
  })

  it('le cumul de toute l’équipe se compense à peu près — personne n’est oublié', () => {
    const total = Object.values(cumul).reduce((s, c) => s + c.we, 0)
    // Les écarts sont des arrondis autour d'une moyenne : leur somme
    // reste proche de 0. Un total qui s'envolerait signalerait un bilan
    // écrit sur un effectif différent de celui qu'on cumule.
    expect(Math.abs(total)).toBeLessThanOrEqual(2)
    expect(Object.keys(cumul).sort()).toEqual([...EFFECTIF, VET.anneCat].sort())
  })
})

// ============================================================
// 2. Le report : signe, plafond, périmètre
// ============================================================

describe('Grand livre — le report appliqué au moteur', () => {
  const report = construireReport(TOUTES_LES_PERIODES, EFFECTIF)

  it('Victor, qui a trop donné, doit faire MOINS (signe inversé)', () => {
    // +3 week-ends faits → report négatif = « doit en faire moins ».
    expect(reportDe(report, VET.victor).we).toBeLessThan(0)
  })

  it('le rattrapage est plafonné : Victor rend 1 week-end, pas 3 d’un coup', () => {
    expect(reportDe(report, VET.victor).we).toBe(-PLAFOND_RATTRAPAGE.we)
    // Le reliquat n'est pas perdu : le cumul est recalculé à chaque
    // génération depuis les bilans, il repassera à la période suivante.
    expect(cumulerEcarts(TOUTES_LES_PERIODES)[VET.victor].we).toBe(3)
  })

  it('Antoine rend 2 gardes de semaine sur ses 5, le plafond de la dimension', () => {
    expect(reportDe(report, VET.antoine).semaine).toBe(-PLAFOND_RATTRAPAGE.semaine)
  })

  it('le dernier recours est HORS du report, malgré ses -12 gardes de semaine', () => {
    // Anne-Catherine n'est jamais candidate (effectifPourGeneration la
    // retire). La laisser entrer réclamerait un rattrapage massif pour
    // quelqu'un qui ne peut pas le recevoir, et fausserait la variance.
    expect(cumulerEcarts(TOUTES_LES_PERIODES)[VET.anneCat].semaine).toBe(-12)
    expect(report[VET.anneCat]).toBeUndefined()
  })

  it('un nouveau vétérinaire démarre à zéro — aucune dette, aucun crédit', () => {
    const avecNouveau = construireReport(TOUTES_LES_PERIODES, [...EFFECTIF, 'recrue'])
    expect(avecNouveau['recrue']).toBeUndefined()
    expect(reportDe(avecNouveau, 'recrue')).toEqual({ we: 0, semaine: 0, feries: 0 })
  })

  it('aucun historique du tout → report vide, donc comportement d’avant', () => {
    expect(construireReport([], EFFECTIF)).toEqual({})
  })

  it('un plafond à 0 neutralise la dimension sans toucher aux autres', () => {
    const sansWE = construireReport(TOUTES_LES_PERIODES, EFFECTIF, {
      we: 0, semaine: 2, feries: 1,
    })
    expect(reportDe(sansWE, VET.victor).we).toBe(0)
    expect(reportDe(sansWE, VET.antoine).semaine).toBe(-2)
  })

  it('une colonne nulle en base vaut « pas d’écart », jamais NaN', () => {
    const abime = [{ veterinaire_id: VET.jean, ecart_we: 2 } as unknown as LigneBilan]
    const c = cumulerEcarts(abime)[VET.jean]
    expect(c.semaine).toBe(0)
    expect(Number.isNaN(c.semaine)).toBe(false)
  })
})

// ============================================================
// 3. Les compteurs effectifs — ce que les trois scoreurs jugent
// ============================================================

function compteur(vetId: string, p: Partial<CompteurVet> = {}): CompteurVet {
  return {
    vetId,
    weGardes: 0, weekendPremier: 0, feriesGardes: 0,
    semainePremier: 0, semaineSecond: 0, semaineRenfort: 0, grandsWePerdus: 0,
    ...p,
  }
}

/**
 * L'equipe reelle du pilote, avec les STATUTS : `grandsWePerdus` n'existe
 * que pour les salaries, donc `compteursEffectifs` doit les connaitre.
 */
const EQUIPE = [
  { id: VET.anneSophie, statut: 'associe' },
  { id: VET.fanny, statut: 'associe' },
  { id: VET.jean, statut: 'associe' },
  { id: VET.manon, statut: 'salarie' },
  { id: VET.antoine, statut: 'salarie' },
  { id: VET.victor, statut: 'salarie' },
]

describe('Grand livre — compteurs effectifs', () => {
  const report: ReportEquiteMap = {
    [VET.victor]: { we: -1, semaine: -2, feries: -1 },
    [VET.jean]: { we: 1, semaine: 0, feries: 0 },
  }

  it('celui qui a trop donné paraît PLUS chargé qu’il ne l’est sur la période', () => {
    const [v] = compteursEffectifs([compteur(VET.victor, { weGardes: 3 })], report, EQUIPE)
    // 3 week-ends posés - (-1) = 4 : il passe après les autres au tri,
    // et la variance du score final le voit sur-chargé.
    expect(v.weGardes).toBe(4)
  })

  it('celui qui a donné moins paraît MOINS chargé, donc il est servi en premier', () => {
    const [j] = compteursEffectifs([compteur(VET.jean, { weGardes: 3 })], report, EQUIPE)
    expect(j.weGardes).toBe(2)
  })

  it('chez un SALARIE, le report week-end sert les deux compteurs du même fait', () => {
    const [v] = compteursEffectifs(
      [compteur(VET.victor, { weGardes: 3, grandsWePerdus: 3 })], report, EQUIPE,
    )
    // `grandsWePerdus` est incrémenté dans la même branche que `weGardes`
    // pour les salariés : deux mesures d'un seul phénomène, un seul report.
    expect(v.weGardes).toBe(4)
    expect(v.grandsWePerdus).toBe(4)
  })

  it('chez un ASSOCIE, « grands week-ends » ne bouge pas — il n’existe pas pour lui', () => {
    // `compterParVet` n'incrémente `grandsWePerdus` que pour les salariés :
    // il vaut 0 pour un associé dans TOUS les plannings. Lui soustraire un
    // report le descendrait à -1 et gonflerait l'écart max−min de l'étage
    // critique — une pénalité pour un déséquilibre qui n'existe pas.
    const [j] = compteursEffectifs(
      [compteur(VET.jean, { weGardes: 2, grandsWePerdus: 0 })], report, EQUIPE,
    )
    expect(j.weGardes).toBe(1) // report +1 : il doit faire plus
    expect(j.grandsWePerdus).toBe(0)
  })

  it('un véto absent de l’équipe est traité comme non-salarié (défaut sûr)', () => {
    const [v] = compteursEffectifs(
      [compteur(VET.victor, { grandsWePerdus: 3 })], report, [],
    )
    expect(v.grandsWePerdus).toBe(3)
  })

  it('le report de semaine va sur la place de 1er, et sur elle seule', () => {
    const [v] = compteursEffectifs(
      [compteur(VET.victor, { semainePremier: 5, semaineSecond: 5, semaineRenfort: 5 })],
      report, EQUIPE,
    )
    expect(v.semainePremier).toBe(7)
    // Le bilan ne mesure pas ces rôles : rien à reporter dessus.
    expect(v.semaineSecond).toBe(5)
    expect(v.semaineRenfort).toBe(5)
  })

  it('les rôles non mesurés par le bilan ne reçoivent aucun report', () => {
    const [v] = compteursEffectifs([compteur(VET.victor, { weekendPremier: 4 })], report, EQUIPE)
    expect(v.weekendPremier).toBe(4)
  })

  it('un report vide rend les compteurs À L’IDENTIQUE (même référence)', () => {
    const avant = [compteur(VET.victor, { weGardes: 3 })]
    expect(compteursEffectifs(avant, {}, EQUIPE)).toBe(avant)
  })

  it('un véto sans report traverse sans être recopié', () => {
    const c = compteur(VET.manon, { weGardes: 2 })
    const [apres] = compteursEffectifs([c], report, EQUIPE)
    expect(apres).toBe(c)
  })
})

// ============================================================
// 4. La mesure AVANT / APRÈS, sur les chiffres réels
// ============================================================

describe('Grand livre — ce que le moteur voyait, ce qu’il voit maintenant', () => {
  /** Ce que faisait `loader.ts` : `ecart_we` de la SEULE période précédente. */
  function ancienReport(dernierePeriode: LigneBilan[]): Record<string, number> {
    const out: Record<string, number> = {}
    for (const b of dernierePeriode) out[b.veterinaire_id] = -b.ecart_we
    return out
  }

  const avant = ancienReport(HIVER_P2)
  const apres = construireReport(TOUTES_LES_PERIODES, EFFECTIF)

  it('Victor : le moteur ne voyait qu’un tiers de sa dette de week-ends', () => {
    expect(avant[VET.victor]).toBe(-1)
    expect(cumulerEcarts(TOUTES_LES_PERIODES)[VET.victor].we).toBe(3)
    expect(reportDe(apres, VET.victor).we).toBe(-1) // plafonné, mais sur la VRAIE dette
  })

  it('Antoine : le moteur voyait un CRÉDIT de week-end et ignorait sa dette de semaine', () => {
    // Sur la seule dernière période, Antoine a `ecart_we` -1 → l'ancien
    // report lui promettait un week-end de PLUS. Son cumul réel est -1
    // aussi (0, 0, -1), donc ce point-là ne change pas ; ce qui change,
    // c'est que ses +5 gardes de semaine existent enfin pour le moteur.
    expect(avant[VET.antoine]).toBe(1)
    expect(reportDe(apres, VET.antoine).semaine).toBe(-2)
  })

  it('Anne-Catherine sortait un report que personne ne pouvait honorer', () => {
    // L'ancien chemin la servait (+2 week-ends réclamés) alors qu'elle
    // est retirée de l'effectif avant même d'être candidate.
    expect(avant[VET.anneCat]).toBe(2)
    expect(apres[VET.anneCat]).toBeUndefined()
  })

  it('le report ne concerne que ceux qui ont vraiment un écart', () => {
    // Anne-Sophie : +1 we, +2 semaine cumulés → elle a un report.
    expect(apres[VET.anneSophie]).toBeDefined()
    // Fanny : -1 we, +1 semaine → elle aussi.
    expect(apres[VET.fanny]).toBeDefined()
    // Personne de l'effectif n'est oublié faute d'historique.
    expect(Object.keys(apres).sort()).toEqual(EFFECTIF.sort())
  })
})
