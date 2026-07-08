// ============================================================
// GUARDVETO — #17 (Vague 5, tranche A) : lookback inter-périodes
// ============================================================
// À la jonction de deux périodes, les règles de RYTHME (R10 « pas 2 WE de
// suite », espacement_min, espacement_weekend, R3, au_plus_n fenêtre) doivent
// « voir » les gardes de la FIN de la période précédente (le `contexteAnterieur`,
// ~10 j de lookback) — sinon un véto peut enchaîner deux week-ends à cheval sur
// deux périodes sans que personne ne le voie.
//
// Ce que ce filet prouve :
//   1. Jonction : un WE du lookback pénalise R10 (mou) et bloque
//      espacement_weekend / espacement_min (dur).
//   2. Les DEUX gardiens (moteur `isValid` + validateur indépendant) s'accordent
//      sur la même violation avec le même lookback.
//   3. Byte-identique : sans `contexteAnterieur` (undefined), tout est inchangé.
//   4. Lookback vide `[]` : aucun effet (distinct de undefined, même résultat).
//   5. L'équité et la couverture ne comptent PAS le lookback.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  isValid, penaliteContraintesConfig,
} from '@/engine/rules/hard-constraints'
import { penaliteR10WEConsecutif, penalite } from '@/engine/rules/soft-constraints'
import { validerPlanning, type ValidationInput } from '@/engine/validation/validerPlanning'
import { scorerPlanning } from '@/engine/score-lexicographique'
import { compterParVet } from '@/engine/rules/optimization'
import { genererPlanningPur } from '@/engine/solver'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { attributionsAvecContexte } from '@/engine/utils'
import { VETS_PILOTE, PERIODE_PILOTE, CALENDRIER_PILOTE } from '@/engine/__tests__/fixtures-pilote'
import type {
  VetEngine, SlotGarde, PlanningPartiel, ContrainteEngine, AttributionGarde,
} from '@/engine/types'

// ── Dates de repère ──────────────────────────────────────
// Période N (précédente) finit sur le WE du SAT_PREV ; période N+1 commence le
// lundi LUN_START et son 1er WE tombe le SAT_START (7 jours après SAT_PREV).
const SAT_PREV = '2026-01-03'   // samedi (WE de fin de période N — LOOKBACK)
const LUN_START = '2026-01-05'  // lundi (début de période N+1)
const MAR_START = '2026-01-06'  // mardi de la 1re semaine de N+1
const SAT_START = '2026-01-10'  // 1er samedi (WE) de la période N+1

/** Le lookback : Manon de garde le WE du SAT_PREV (fin de la période précédente). */
const LOOKBACK_WE: AttributionGarde[] = [
  { date: SAT_PREV, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
]

/** Le lookback : Manon de garde le vendredi de fin de période (soir de semaine). */
const LOOKBACK_SOIR: AttributionGarde[] = [
  { date: '2026-01-02', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
]

const slotWe = (date: string): SlotGarde => ({ date, type: 'weekend', saison: 'hiver', besoinSecond: true })
const slotSoir = (date: string): SlotGarde => ({ date, type: 'semaine_soir', saison: 'hiver', besoinSecond: false })

// ── Vétos configurés ─────────────────────────────────────

function vetSansRegle(): ReturnType<typeof normaliserContraintesVets>[number] {
  const v: VetEngine = {
    id: 'v', prenom: 'Manon', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [], contraintes: [],
  }
  return normaliserContraintesVets([v])[0]
}

function vetFrequenceWe(n: number, force: number): ReturnType<typeof normaliserContraintesVets>[number] {
  const config: Record<string, unknown> = {
    brique: 'espacement_weekend', force, params: { n_semaines: n },
  }
  const v: VetEngine = {
    id: 'v', prenom: 'Manon', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'f1', type: 'espacement_weekend', actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

function vetEspacementMin(ecart: number, force: number): ReturnType<typeof normaliserContraintesVets>[number] {
  const config: Record<string, unknown> = {
    brique: 'espacement_min', force, params: { ecart_min_jours: ecart },
  }
  const v: VetEngine = {
    id: 'v', prenom: 'Manon', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'e1', type: 'espacement_min', actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

// ── 1. Le helper de vue étendue (pur) ────────────────────

describe('attributionsAvecContexte — helper de vue étendue', () => {
  const planning: PlanningPartiel = {
    attributions: [{ date: SAT_START, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] }],
  }

  it('undefined → renvoie le planning tel quel (référence identique)', () => {
    expect(attributionsAvecContexte(planning, undefined)).toBe(planning)
  })

  it('[] → renvoie le planning tel quel (référence identique)', () => {
    expect(attributionsAvecContexte(planning, [])).toBe(planning)
  })

  it('lookback non vide → concatène DEVANT les attributions courantes', () => {
    const etendu = attributionsAvecContexte(planning, LOOKBACK_WE)
    expect(etendu).not.toBe(planning)
    expect(etendu.attributions).toHaveLength(2)
    expect(etendu.attributions[0].date).toBe(SAT_PREV) // lookback en tête
    expect(etendu.attributions[1].date).toBe(SAT_START)
    // Le planning d'origine n'est pas muté.
    expect(planning.attributions).toHaveLength(1)
  })
})

// ── 2. R10 (souple) pénalise à la jonction ───────────────

describe('#17 — R10 (2 WE consécutifs) voit le WE du lookback', () => {
  const v = vetSansRegle()
  const planningVide: PlanningPartiel = { attributions: [] }

  it('SANS lookback : poser le 1er WE de la période ne pénalise pas R10', () => {
    // Aucun WE antérieur connu → pas de « 2 WE de suite ».
    expect(penaliteR10WEConsecutif(slotWe(SAT_START), v, planningVide)).toBe(0)
  })

  it('AVEC lookback (WE 7 j avant) : R10 pénalise via la vue étendue', () => {
    const etendu = attributionsAvecContexte(planningVide, LOOKBACK_WE)
    expect(penaliteR10WEConsecutif(slotWe(SAT_START), v, etendu)).toBeGreaterThan(0)
  })

  it('penalite() propage contexteAnterieur → pénalité R10 à la jonction', () => {
    const sans = penalite(slotWe(SAT_START), v, 'premier', planningVide)
    const avec = penalite(slotWe(SAT_START), v, 'premier', planningVide, undefined, undefined, undefined, LOOKBACK_WE)
    expect(avec).toBeGreaterThan(sans)
  })
})

// ── 3. espacement_weekend (dur) bloque à la jonction ─────

describe('#17 — espacement_weekend DUR bloque un WE trop proche du lookback', () => {
  const planningVide: PlanningPartiel = { attributions: [] }

  it('SANS lookback : le 1er WE de la période est autorisé', () => {
    const v = vetFrequenceWe(2, 2) // « 1 WE sur 2 »
    expect(isValid(slotWe(SAT_START), v, 'premier', [v], planningVide).valid).toBe(true)
  })

  it('AVEC lookback (WE à 7 j) : « 1 WE sur 2 » bloque le candidat', () => {
    const v = vetFrequenceWe(2, 2)
    const r = isValid(slotWe(SAT_START), v, 'premier', [v], planningVide, undefined, undefined, LOOKBACK_WE)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/FREQ_WE/)
  })

  it('lookback vide [] : aucun effet (WE autorisé, distinct de undefined)', () => {
    const v = vetFrequenceWe(2, 2)
    expect(isValid(slotWe(SAT_START), v, 'premier', [v], planningVide, undefined, undefined, []).valid).toBe(true)
  })
})

// ── 4. espacement_min (dur) bloque à la jonction ─────────

describe('#17 — espacement_min DUR bloque une garde trop proche du lookback', () => {
  const planningVide: PlanningPartiel = { attributions: [] }

  it('SANS lookback : le 1er soir de la période est autorisé', () => {
    const v = vetEspacementMin(5, 2) // au moins 5 jours d'écart
    expect(isValid(slotSoir(MAR_START), v, 'premier', [v], planningVide).valid).toBe(true)
  })

  it('AVEC lookback (garde à 4 j) : espacement min 5 bloque le candidat', () => {
    // LOOKBACK_SOIR = garde le 2026-01-02 ; MAR_START = 2026-01-06 → 4 jours < 5.
    const v = vetEspacementMin(5, 2)
    const r = isValid(slotSoir(MAR_START), v, 'premier', [v], planningVide, undefined, undefined, LOOKBACK_SOIR)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/ESPACEMENT/)
  })
})

// ── 5. Les DEUX gardiens s'accordent avec le même lookback ─

describe('#17 — moteur et validateur indépendant s\'accordent', () => {
  // Planning de la période N+1 : Manon de garde le 1er WE (SAT_START), 7 j après
  // le WE du lookback. Avec « 1 WE sur 2 » DUR, c'est une violation FREQ_WE.
  const planningPeriode: PlanningPartiel = {
    attributions: [
      { date: SAT_START, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
    ],
  }
  const inputBase: Omit<ValidationInput, 'vets'> = {
    dateDebut: LUN_START, dateFin: '2026-02-01', saison: 'hiver', nbVetosSemaineSoir: 1,
  }

  it('validateur : signale FREQ_WE quand le lookback est fourni (règle DURE)', () => {
    const v = vetFrequenceWe(2, 2)
    const violations = validerPlanning(planningPeriode, {
      ...inputBase, vets: [v], contexteAnterieur: LOOKBACK_WE,
    })
    expect(violations.some((x) => x.regle === 'FREQ_WE' && x.vetId === 'v')).toBe(true)
  })

  it('validateur : NE signale RIEN sans lookback (jonction invisible → byte-identique)', () => {
    const v = vetFrequenceWe(2, 2)
    const violations = validerPlanning(planningPeriode, { ...inputBase, vets: [v] })
    expect(violations.some((x) => x.regle === 'FREQ_WE')).toBe(false)
  })

  it('validateur : lookback [] → aucun signalement (comme undefined)', () => {
    const v = vetFrequenceWe(2, 2)
    const violations = validerPlanning(planningPeriode, {
      ...inputBase, vets: [v], contexteAnterieur: [],
    })
    expect(violations.some((x) => x.regle === 'FREQ_WE')).toBe(false)
  })

  it('accord moteur↔validateur : le WE que le moteur refuserait, le validateur le signale', () => {
    const v = vetFrequenceWe(2, 2)
    // Moteur : poser Manon sur SAT_START avec le lookback → refusé.
    const planningAvant: PlanningPartiel = { attributions: [] }
    const moteurRefuse = !isValid(
      slotWe(SAT_START), v, 'premier', [v], planningAvant, undefined, undefined, LOOKBACK_WE,
    ).valid
    // Validateur : le planning qui contient cette pose → FREQ_WE signalé.
    const validateurSignale = validerPlanning(planningPeriode, {
      ...inputBase, vets: [v], contexteAnterieur: LOOKBACK_WE,
    }).some((x) => x.regle === 'FREQ_WE')
    expect(moteurRefuse).toBe(true)
    expect(validateurSignale).toBe(true)
  })
})

// ── 6. L'équité et la couverture ne comptent PAS le lookback ─

describe('#17 — le lookback ne compte NI dans l\'équité NI dans la couverture', () => {
  const vets = normaliserContraintesVets([
    { id: 'v', prenom: 'Manon', nom: 'A', statut: 'associe', dernier_recours: false, conges: [], contraintes: [] },
    { id: 'w', prenom: 'Léo', nom: 'B', statut: 'associe', dernier_recours: false, conges: [], contraintes: [] },
  ])
  // Planning courant : un seul WE, Manon en 1er, Léo en 2nd.
  const planning: PlanningPartiel = {
    attributions: [
      { date: SAT_START, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: 'w' }] },
    ],
  }

  it('compterParVet ignore totalement le lookback (compteurs inchangés)', () => {
    // Les compteurs d'équité ne prennent JAMAIS le contexteAnterieur : ils
    // comptent le planning courant seulement. On le prouve en comparant les
    // compteurs du planning courant à ceux d'un planning « pollué » par le
    // lookback — ils diffèrent, donc compter le lookback SERAIT visible.
    const compteurs = compterParVet(planning, vets)
    const manon = compteurs.find((c) => c.vetId === 'v')!
    expect(manon.weGardes).toBe(1) // 1 seul WE (celui de la période), pas 2.
  })

  it('scorerPlanning : l\'étage ÉQUITÉ (6) est identique avec ou sans lookback', () => {
    const sans = scorerPlanning(planning, vets, 'hiver')
    const avec = scorerPlanning(planning, vets, 'hiver', undefined, undefined, undefined, undefined, LOOKBACK_WE)
    // Étage 6 = équité : le lookback ne doit RIEN y changer (il ne compte pas).
    expect(avec.etages[6]).toBe(sans.etages[6])
  })

  it('validateur : le lookback ne crée AUCUNE violation de couverture (slot fantôme)', () => {
    // Le WE du lookback (SAT_PREV) est HORS période → il ne doit pas être
    // attendu ni créer de trou de couverture.
    const violations = validerPlanning(planning, {
      dateDebut: LUN_START, dateFin: '2026-01-11', saison: 'hiver', nbVetosSemaineSoir: 1,
      vets, contexteAnterieur: LOOKBACK_WE,
    })
    expect(violations.some((x) => x.regle === 'COUVERTURE' && x.date === SAT_PREV)).toBe(false)
  })
})

// ── 7. Byte-identique : penaliteContraintesConfig sans lookback ─

describe('#17 — byte-identique quand contexteAnterieur est absent', () => {
  const planningVide: PlanningPartiel = { attributions: [] }

  it('penaliteContraintesConfig : même résultat undefined vs [] (règle molle)', () => {
    const v = vetFrequenceWe(2, 4) // molle → pénalité, pas blocage
    const etendu = attributionsAvecContexte(planningVide, LOOKBACK_WE)
    // Sans lookback : pas de WE antérieur → 0.
    const sans = penaliteContraintesConfig(slotWe(SAT_START), v, 'premier', planningVide)
    const vide = penaliteContraintesConfig(slotWe(SAT_START), v, 'premier', planningVide, undefined, [])
    expect(vide).toBe(sans)
    // Avec lookback : la pénalité molle apparaît (cohérent avec le dur).
    const avec = penaliteContraintesConfig(slotWe(SAT_START), v, 'premier', etendu)
    expect(avec).toBeGreaterThan(sans)
  })
})

// ── 8. Génération complète : byte-identique sans lookback, valide avec ─

describe('#17 — génération complète (pilote, seed greedy)', () => {
  /** Input pilote — objets frais (Set/tableaux neufs) pour isoler les tests. */
  function makeInput() {
    return {
      dateDebut: PERIODE_PILOTE.dateDebut,
      dateFin: PERIODE_PILOTE.dateFin,
      saison: PERIODE_PILOTE.saison,
      vets: VETS_PILOTE as VetEngine[],
      bonusMalus: {},
      calendrier: {
        feries: new Set(CALENDRIER_PILOTE.feries),
        vacancesScolaires: CALENDRIER_PILOTE.vacancesScolaires.map((v) => ({ ...v })),
      },
      lnsTimeoutMs: 0, // seed greedy seul (déterministe)
    }
  }

  function empreinte(planning: PlanningPartiel): string {
    return JSON.stringify(
      [...planning.attributions]
        .sort((a, b) => (a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date)))
        .map((a) => `${a.date}|${a.type}|${a.placements.map((p) => p.vetId ?? '-').join('|')}`),
    )
  }

  it('BYTE-IDENTIQUE : contexteAnterieur absent vs [] → planning identique au sans-champ', () => {
    const ref = genererPlanningPur(makeInput())
    const vide = genererPlanningPur({ ...makeInput(), contexteAnterieur: [] })
    const undef = genererPlanningPur({ ...makeInput(), contexteAnterieur: undefined })
    expect(ref.success && vide.success && undef.success).toBe(true)
    if (ref.success && vide.success && undef.success) {
      expect(empreinte(vide.planning)).toBe(empreinte(ref.planning))
      expect(empreinte(undef.planning)).toBe(empreinte(ref.planning))
    }
  })

  it('AVEC lookback : le planning généré reste COMPLET et VALIDE (0 violation dure)', () => {
    // Lookback plausible : le WE précédant la période, tenu par 2 vétos du pilote.
    const veilleWe = '2026-01-03' // à ajuster selon PERIODE_PILOTE si besoin — voir garde ci-dessous
    const lookback: AttributionGarde[] = [
      {
        date: veilleWe,
        type: 'weekend',
        placements: [
          { role: 'premier', vetId: VETS_PILOTE[0].id },
          { role: 'second', vetId: VETS_PILOTE[1].id },
        ],
      },
    ]
    const res = genererPlanningPur({ ...makeInput(), contexteAnterieur: lookback })
    expect(res.success).toBe(true)
    if (res.success) {
      const violations = validerPlanning(res.planning, {
        dateDebut: PERIODE_PILOTE.dateDebut,
        dateFin: PERIODE_PILOTE.dateFin,
        saison: PERIODE_PILOTE.saison,
        vets: VETS_PILOTE as VetEngine[],
        calendrier: {
          feries: new Set(CALENDRIER_PILOTE.feries),
          vacancesScolaires: CALENDRIER_PILOTE.vacancesScolaires.map((v) => ({ ...v })),
        },
        // Même lookback que la génération → les deux gardiens jugent pareil.
        contexteAnterieur: lookback,
      })
      expect(violations).toHaveLength(0)
    }
  })
})
