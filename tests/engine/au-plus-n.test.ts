// ============================================================
// GUARDVETO — Brique `au_plus_n` : limite de charge réglable
// ============================================================
// « au plus N gardes par fenêtre » (semaine civile par défaut). Réglable :
// dure (étage ≤ 2 → bloque) ou molle (étage ≥ 3 → pénalise sans bloquer).
// Couvre le cas signalé (un véto enchaîne trop de gardes dans la semaine).
//
// NB : aucune règle de ce type n'est posée pour le cabinet pilote — on teste
// seulement que la CAPACITÉ fonctionne quand un cabinet la configurera.
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid, penaliteContraintesConfig } from '@/engine/rules/hard-constraints'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { estAttribue } from '@/engine/attribution'
import type { VetEngine, SlotGarde, PlanningPartiel, ContrainteEngine } from '@/engine/types'

import hiverStandard from './scenarios/hiver-standard.json'

// Semaine ISO : 2026-01-05 (lun) … 2026-01-11 (dim).
const LUN = '2026-01-05', MAR = '2026-01-06', MER = '2026-01-07'

function vetAvecLimite(n: number, force: number): ReturnType<typeof normaliserContraintesVets>[number] {
  const config: Record<string, unknown> = {
    brique: 'au_plus_n', force, params: { n, fenetre: 'semaine_civile' },
  }
  const v: VetEngine = {
    id: 'v', prenom: 'Victor', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'l1', type: 'au_plus_n', actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

const slot = (date: string): SlotGarde => ({ date, type: 'semaine_soir', saison: 'hiver', besoinSecond: false })

// Planning : Victor déjà de garde lundi + mardi (2 gardes dans la semaine).
const planning2: PlanningPartiel = {
  attributions: [
    { date: LUN, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
    { date: MAR, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
  ],
}

describe('au_plus_n — DUR (étage 2) : bloque le dépassement', () => {
  it('refuse une 3e garde dans la même semaine (max 2)', () => {
    const v = vetAvecLimite(2, 2)
    const r = isValid(slot(MER), v, 'premier', [v], planning2)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/AU_PLUS_N/)
  })

  it('autorise la 2e garde (sous la limite)', () => {
    const v = vetAvecLimite(2, 2)
    const planning1: PlanningPartiel = { attributions: [planning2.attributions[0]] }
    expect(isValid(slot(MAR), v, 'premier', [v], planning1).valid).toBe(true)
  })
})

describe('au_plus_n — MOU (étage 4) : ne bloque pas, mais pénalise', () => {
  it('autorise la 3e garde mais ajoute une pénalité', () => {
    const v = vetAvecLimite(2, 4)
    expect(isValid(slot(MER), v, 'premier', [v], planning2).valid).toBe(true)
    expect(penaliteContraintesConfig(slot(MER), v, 'premier', planning2)).toBeGreaterThan(0)
  })
})

describe('au_plus_n — validateur indépendant', () => {
  const planning3: PlanningPartiel = {
    attributions: [
      { date: LUN, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
      { date: MAR, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
      { date: MER, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
    ],
  }
  const input = { dateDebut: LUN, dateFin: '2026-01-11', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }

  it('signale le dépassement quand la règle est DURE', () => {
    const v = vetAvecLimite(2, 2)
    const violations = validerPlanning(planning3, { ...input, vets: [v] })
    expect(violations.some((x) => x.regle === 'AU_PLUS_N' && x.vetId === 'v')).toBe(true)
  })

  it('ne signale RIEN quand la règle est MOLLE (préférence)', () => {
    const v = vetAvecLimite(2, 4)
    const violations = validerPlanning(planning3, { ...input, vets: [v] })
    expect(violations.some((x) => x.regle === 'AU_PLUS_N')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
// Axe `creneaux` (backlog n°19) — « max N week-ends par mois »
// ═══════════════════════════════════════════════════════════════
// Le filtre optionnel `creneaux` ne compte QUE les types listés : les autres
// gardes ne consomment pas le quota ET ne sont pas bloquées par lui. FAITS
// DIRECTS sur les deux gardiens (isValid moteur + validateur indépendant),
// puis sur une GÉNÉRATION complète (pose la règle, génère, vérifie le fait).

function vetAvecLimiteCreneaux(
  n: number, force: number, creneaux: string[], fenetre = 'glissante_30_jours',
): ReturnType<typeof normaliserContraintesVets>[number] {
  const config: Record<string, unknown> = {
    brique: 'au_plus_n', force, params: { n, fenetre, creneaux },
  }
  const v: VetEngine = {
    id: 'v', prenom: 'Victor', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'lw1', type: 'au_plus_n', actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

describe('au_plus_n + creneaux — le filtre discrimine les types de garde (moteur)', () => {
  // Victor : au plus 1 WEEK-END par 30 jours glissants (dur).
  const v = vetAvecLimiteCreneaux(1, 2, ['weekend'])
  const SAM1 = '2026-01-10', SAM2 = '2026-01-17'
  const planningUnWE: PlanningPartiel = {
    attributions: [
      { date: SAM1, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] },
    ],
  }
  const slotWE = (date: string): SlotGarde => ({ date, type: 'weekend', saison: 'hiver', besoinSecond: false })

  it('BLOQUE un 2e week-end dans la fenêtre', () => {
    const r = isValid(slotWE(SAM2), v, 'premier', [v], planningUnWE)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/AU_PLUS_N/)
  })

  it('n’applique PAS le quota à un soir de semaine (le filtre exclut le slot)', () => {
    // Quota week-end déjà atteint, mais le mardi 13 n'est pas un « weekend ».
    expect(isValid(slot('2026-01-13'), v, 'premier', [v], planningUnWE).valid).toBe(true)
  })

  it('ne COMPTE pas les gardes hors filtre : 3 soirs de semaine ne consomment pas le quota WE', () => {
    const planning3Soirs: PlanningPartiel = {
      attributions: [LUN, MAR, MER].map((date) => ({
        date, type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }],
      })),
    }
    // 1er week-end : rien dans le compteur filtré → autorisé.
    expect(isValid(slotWE(SAM1), v, 'premier', [v], planning3Soirs).valid).toBe(true)
  })
})

describe('au_plus_n + creneaux — validateur indépendant (mêmes lunettes)', () => {
  const input = { dateDebut: '2026-01-05', dateFin: '2026-02-01', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
  const we = (date: string) => ({
    date, type: 'weekend',
    placements: [{ role: 'premier' as const, vetId: 'v' }, { role: 'second' as const, vetId: null }],
  })
  const soir = (date: string) => ({
    date, type: 'semaine_soir',
    placements: [{ role: 'premier' as const, vetId: 'v' }, { role: 'second' as const, vetId: null }],
  })

  it('signale 2 week-ends dans la fenêtre (règle dure, filtre weekend)', () => {
    const v = vetAvecLimiteCreneaux(1, 2, ['weekend'])
    const violations = validerPlanning(
      { attributions: [we('2026-01-10'), we('2026-01-17')] }, { ...input, vets: [v] },
    )
    expect(violations.some((x) => x.regle === 'AU_PLUS_N' && x.vetId === 'v')).toBe(true)
  })

  it('ne signale RIEN pour 3 soirs de semaine + 1 seul week-end (hors filtre = pas comptés)', () => {
    const v = vetAvecLimiteCreneaux(1, 2, ['weekend'])
    const violations = validerPlanning(
      { attributions: [soir(LUN), soir(MAR), soir(MER), we('2026-01-10')] },
      { ...input, vets: [v] },
    )
    expect(violations.some((x) => x.regle === 'AU_PLUS_N')).toBe(false)
  })
})

describe('au_plus_n + creneaux — FAIT DIRECT en génération complète', () => {
  // Scénario hiver-standard (4 semaines, 7 vétos) : h-v1 reçoit la règle DURE
  // « au plus 1 SOIR DE SEMAINE par 30 jours glissants ». Sans le filtre, cette
  // règle plafonnerait TOUTES ses gardes à 1 ; avec le filtre, seuls ses soirs
  // de semaine sont plafonnés — il reste disponible vendredis/week-ends.
  const regle: ContrainteEngine = {
    id: 'gen-n19', type: 'au_plus_n', actif: true,
    config: {
      brique: 'au_plus_n', force: 2,
      params: { n: 1, fenetre: 'glissante_30_jours', creneaux: ['semaine_soir'] },
    },
  } as ContrainteEngine

  const vets = (hiverStandard.vets as unknown as VetEngine[]).map((v) =>
    v.id === 'h-v1' ? { ...v, contraintes: [regle] } : v,
  )
  const input: SolverInput = {
    dateDebut: hiverStandard.periode.dateDebut,
    dateFin: hiverStandard.periode.dateFin,
    saison: hiverStandard.periode.saison as 'hiver',
    vets,
    bonusMalus: {},
  }
  const result = genererPlanningPur(input)

  it('la génération reste faisable (les autres absorbent les soirs de semaine)', () => {
    expect(result.success).toBe(true)
  })

  it('LE FAIT : h-v1 a au plus 1 soir de semaine, mais PLUS d’une garde au total', () => {
    if (!result.success) return
    const gardes = result.planning.attributions.filter((a) => estAttribue(a, 'h-v1'))
    const soirs = gardes.filter((a) => a.type === 'semaine_soir')
    expect(soirs.length).toBeLessThanOrEqual(1)
    // Discriminant du FILTRE : une règle « au plus 1 garde/30j » SANS filtre
    // aurait plafonné le total à 1. Ici l'équité lui redonne des gardes
    // vendredi/week-end — preuve que seuls les soirs de semaine sont comptés.
    expect(gardes.length).toBeGreaterThan(1)
  })

  it('le validateur indépendant ne signale AUCUN dépassement sur le planning généré', () => {
    if (!result.success) return
    const vetsNorm = normaliserContraintesVets(vets)
    const violations = validerPlanning(result.planning, {
      dateDebut: input.dateDebut, dateFin: input.dateFin, saison: 'hiver', vets: vetsNorm,
    })
    expect(violations.filter((x) => x.regle === 'AU_PLUS_N')).toEqual([])
  })
})
