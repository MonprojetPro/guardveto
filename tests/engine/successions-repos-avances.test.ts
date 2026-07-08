// ============================================================
// GUARDVETO — Vague 5 tranche B : successions / séries / repos avancés (#13)
// ============================================================
// Trois briques de RYTHME par-véto (famille `sequence`), réglables dur/mou :
//   • succession_interdite — « pas de B le lendemain de A » (jour civil ; le
//     lendemain d'un week-end est le lundi).
//   • serie_max — « jamais plus de N jours de garde d'affilée ».
//   • repos_apres_serie — « après N jours d'affilée, ≥ M jours sans garde ».
//
// Pour chaque brique : (1) DUR bloque isValid, (2) MOU pénalise sans bloquer,
// (3) le validateur indépendant est d'accord, (4) cas INERTES (jamais de crash,
// jamais de blocage). Plus un test de LOOKBACK inter-périodes (#17).
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid, penaliteContraintesConfig } from '@/engine/rules/hard-constraints'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type {
  VetEngine, SlotGarde, PlanningPartiel, ContrainteEngine, AttributionGarde,
} from '@/engine/types'

// ── Fabrique de véto porteur d'UNE contrainte de rythme ──
function vetAvec(
  type: ContrainteEngine['type'],
  params: Record<string, unknown>,
  force: number,
): ReturnType<typeof normaliserContraintesVets>[number] {
  const config: Record<string, unknown> = { brique: type, force, params }
  const v: VetEngine = {
    id: 'v', prenom: 'Manon', nom: 'X', statut: 'associe', dernier_recours: false,
    conges: [],
    contraintes: [{ id: 'c1', type, actif: true, config } as ContrainteEngine],
  }
  return normaliserContraintesVets([v])[0]
}

// ── Slots ──
const slotSoir = (date: string): SlotGarde => ({ date, type: 'semaine_soir', saison: 'hiver', besoinSecond: false })
const slotWe = (date: string): SlotGarde => ({ date, type: 'weekend', saison: 'hiver', besoinSecond: true })
const slotVen = (date: string): SlotGarde => ({ date, type: 'vendredi_soir', saison: 'hiver', besoinSecond: true })

// Attributions posées (le véto 'v' est 1er).
const attSoir = (date: string): AttributionGarde =>
  ({ date, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }] })
const attWe = (date: string): AttributionGarde =>
  ({ date, type: 'weekend', placements: [{ role: 'premier', vetId: 'v' }, { role: 'second', vetId: null }] })

// Calendrier de dates (janvier 2026) :
//   sam 2026-01-03 = WE ; lun 2026-01-05 ; mar 2026-01-06 ; mer 2026-01-07 …
const SAT = '2026-01-03', SUN = '2026-01-04', LUN = '2026-01-05'
const MAR = '2026-01-06', MER = '2026-01-07', JEU = '2026-01-08'

// ════════════════════════════════════════════════════════════
describe('succession_interdite — « pas de semaine_soir le lendemain d\'un week-end »', () => {
  const params = { type_avant: 'weekend', type_apres: 'semaine_soir' }
  // WE du samedi couvre sam+dim → lendemain = lundi.
  const planningWe: PlanningPartiel = { attributions: [attWe(SAT)] }

  it('DUR (étage 2) : refuse un soir de semaine le LUNDI (lendemain du WE)', () => {
    const v = vetAvec('succession_interdite', params, 2)
    const r = isValid(slotSoir(LUN), v, 'premier', [v], planningWe)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/SUCCESSION/)
  })

  it('DUR : autorise un soir de semaine le MARDI (2 jours après)', () => {
    const v = vetAvec('succession_interdite', params, 2)
    expect(isValid(slotSoir(MAR), v, 'premier', [v], planningWe).valid).toBe(true)
  })

  it('SYMÉTRIE : refuse aussi le WE quand le soir du lendemain est déjà posé', () => {
    // On planifie le WE (samedi) alors que le lundi (semaine_soir) est déjà posé.
    const v = vetAvec('succession_interdite', params, 2)
    const planningSoir: PlanningPartiel = { attributions: [attSoir(LUN)] }
    const r = isValid(slotWe(SAT), v, 'premier', [v], planningSoir)
    expect(r.valid).toBe(false)
  })

  it('MOU (étage 4) : n\'empêche pas mais pénalise', () => {
    const v = vetAvec('succession_interdite', params, 4)
    expect(isValid(slotSoir(LUN), v, 'premier', [v], planningWe).valid).toBe(true)
    expect(penaliteContraintesConfig(slotSoir(LUN), v, 'premier', planningWe)).toBeGreaterThan(0)
  })

  it('INERTE : type_avant/type_apres vide → aucun blocage', () => {
    const v = vetAvec('succession_interdite', { type_avant: '', type_apres: 'semaine_soir' }, 2)
    expect(isValid(slotSoir(LUN), v, 'premier', [v], planningWe).valid).toBe(true)
  })

  it('validateur indépendant : signale la succession en DUR, se tait en MOU', () => {
    const input = { dateDebut: SAT, dateFin: JEU, saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const planning: PlanningPartiel = { attributions: [attWe(SAT), attSoir(LUN)] }
    const vDur = vetAvec('succession_interdite', params, 2)
    const vDoux = vetAvec('succession_interdite', params, 4)
    expect(validerPlanning(planning, { ...input, vets: [vDur] }).some((x) => x.regle === 'SUCCESSION')).toBe(true)
    expect(validerPlanning(planning, { ...input, vets: [vDoux] }).some((x) => x.regle === 'SUCCESSION')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
describe('serie_max — « jamais plus de 2 jours de garde d\'affilée »', () => {
  const params = { n_jours: 2 }
  // Lundi + mardi déjà posés → poser mercredi ferait 3 d'affilée.
  const planning2: PlanningPartiel = { attributions: [attSoir(LUN), attSoir(MAR)] }

  it('DUR (étage 2) : refuse le 3e jour consécutif (mercredi)', () => {
    const v = vetAvec('serie_max', params, 2)
    const r = isValid(slotSoir(MER), v, 'premier', [v], planning2)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/SERIE_MAX/)
  })

  it('DUR : autorise un 2e jour consécutif (série de 2 = limite atteinte, OK)', () => {
    const v = vetAvec('serie_max', params, 2)
    const planning1: PlanningPartiel = { attributions: [attSoir(LUN)] }
    expect(isValid(slotSoir(MAR), v, 'premier', [v], planning1).valid).toBe(true)
  })

  it('WE compte 2 jours : refuse un soir de semaine le lundi après un WE (série 3 = sam+dim+lun)', () => {
    // n_jours = 2 : sam(WE)=2 jours déjà, + lundi = 3 d'affilée → refusé.
    const v = vetAvec('serie_max', params, 2)
    const planningWe: PlanningPartiel = { attributions: [attWe(SAT)] }
    expect(isValid(slotSoir(LUN), v, 'premier', [v], planningWe).valid).toBe(false)
  })

  it('MOU (étage 4) : n\'empêche pas mais pénalise', () => {
    const v = vetAvec('serie_max', params, 4)
    expect(isValid(slotSoir(MER), v, 'premier', [v], planning2).valid).toBe(true)
    expect(penaliteContraintesConfig(slotSoir(MER), v, 'premier', planning2)).toBeGreaterThan(0)
  })

  it('INERTE : n_jours = 0 → aucun blocage', () => {
    const v = vetAvec('serie_max', { n_jours: 0 }, 2)
    expect(isValid(slotSoir(MER), v, 'premier', [v], planning2).valid).toBe(true)
  })

  it('filtre creneaux : ne compte que les types listés', () => {
    // On ne compte QUE weekend → 2 soirs de semaine consécutifs ne violent rien.
    const v = vetAvec('serie_max', { n_jours: 1, creneaux: ['weekend'] }, 2)
    expect(isValid(slotSoir(MER), v, 'premier', [v], planning2).valid).toBe(true)
  })

  it('validateur indépendant : signale une série de 3 en DUR', () => {
    const input = { dateDebut: LUN, dateFin: JEU, saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    const planning3: PlanningPartiel = { attributions: [attSoir(LUN), attSoir(MAR), attSoir(MER)] }
    const v = vetAvec('serie_max', params, 2)
    expect(validerPlanning(planning3, { ...input, vets: [v] }).some((x) => x.regle === 'SERIE_MAX')).toBe(true)
    const vDoux = vetAvec('serie_max', params, 4)
    expect(validerPlanning(planning3, { ...input, vets: [vDoux] }).some((x) => x.regle === 'SERIE_MAX')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
describe('repos_apres_serie — « après 2 jours d\'affilée, au moins 2 jours de repos »', () => {
  const params = { n_jours: 2, repos_jours: 2 }
  // Série lun+mar (=2, se termine mar ; mer est un trou) → mer ET jeu (mar+1,
  // mar+2) doivent être libres. Poser une garde le JEUDI (dans la fenêtre de
  // repos, après le trou du mercredi) viole le repos.
  const planningSerie2: PlanningPartiel = { attributions: [attSoir(LUN), attSoir(MAR)] }

  it('DUR (étage 2) : refuse une garde le jeudi (fenêtre de repos après série de 2)', () => {
    const v = vetAvec('repos_apres_serie', params, 2)
    const r = isValid(slotSoir(JEU), v, 'premier', [v], planningSerie2)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/REPOS_SERIE/)
  })

  it('DUR : série de MOINS de N n\'impose rien (1 seul jour posé → jeudi permis)', () => {
    const v = vetAvec('repos_apres_serie', params, 2)
    const planning1: PlanningPartiel = { attributions: [attSoir(LUN)] }
    // Un seul jour (lun) = série de 1 < 2 → aucun repos imposé.
    expect(isValid(slotSoir(JEU), v, 'premier', [v], planning1).valid).toBe(true)
  })

  it('DUR : au-delà de la fenêtre de repos (vendredi = mar+3 > M) → permis', () => {
    const v = vetAvec('repos_apres_serie', params, 2)
    expect(isValid(slotSoir('2026-01-09'), v, 'premier', [v], planningSerie2).valid).toBe(true)
  })

  it('MOU (étage 4) : n\'empêche pas mais pénalise', () => {
    const v = vetAvec('repos_apres_serie', params, 4)
    expect(isValid(slotSoir(JEU), v, 'premier', [v], planningSerie2).valid).toBe(true)
    expect(penaliteContraintesConfig(slotSoir(JEU), v, 'premier', planningSerie2)).toBeGreaterThan(0)
  })

  it('INERTE : repos_jours = 0 → aucun blocage', () => {
    const v = vetAvec('repos_apres_serie', { n_jours: 2, repos_jours: 0 }, 2)
    expect(isValid(slotSoir(JEU), v, 'premier', [v], planningSerie2).valid).toBe(true)
  })

  it('validateur indépendant : signale une garde dans la fenêtre de repos en DUR', () => {
    const input = { dateDebut: LUN, dateFin: '2026-01-09', saison: 'hiver' as const, nbVetosSemaineSoir: 1 }
    // Série lun+mar (=2, fin mar), mer libre, JEU de garde (mar+2, dans M=2) → viole.
    const planning: PlanningPartiel = { attributions: [attSoir(LUN), attSoir(MAR), attSoir(JEU)] }
    const v = vetAvec('repos_apres_serie', params, 2)
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'REPOS_SERIE')).toBe(true)
    const vDoux = vetAvec('repos_apres_serie', params, 4)
    expect(validerPlanning(planning, { ...input, vets: [vDoux] }).some((x) => x.regle === 'REPOS_SERIE')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════
describe('lookback inter-périodes (#17) : une série entamée en fin de période précédente compte', () => {
  // Contexte antérieur : le véto a fait dimanche (2026-01-04, fin d'une garde WE
  // de la période précédente). Nouvelle période commence le lundi 2026-01-05.
  // serie_max = 1 : poser le lundi ferait 2 d'affilée avec le dimanche antérieur.
  const contexteAnterieur: AttributionGarde[] = [
    { date: SUN, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v' }] },
  ]

  it('moteur : refuse le lundi si le dimanche antérieur crée une série trop longue', () => {
    const v = vetAvec('serie_max', { n_jours: 1 }, 2)
    const planning: PlanningPartiel = { attributions: [] }
    // Sans lookback → OK (aucune série). Avec lookback → série de 2 → refusé.
    expect(isValid(slotSoir(LUN), v, 'premier', [v], planning).valid).toBe(true)
    const r = isValid(slotSoir(LUN), v, 'premier', [v], planning, undefined, undefined, contexteAnterieur)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/SERIE_MAX/)
  })

  it('validateur indépendant : voit aussi la jonction via contexteAnterieur', () => {
    const input = {
      dateDebut: LUN, dateFin: JEU, saison: 'hiver' as const, nbVetosSemaineSoir: 1,
      contexteAnterieur,
    }
    const planning: PlanningPartiel = { attributions: [attSoir(LUN)] }
    const v = vetAvec('serie_max', { n_jours: 1 }, 2)
    expect(validerPlanning(planning, { ...input, vets: [v] }).some((x) => x.regle === 'SERIE_MAX')).toBe(true)
  })

  it('succession_interdite consomme aussi le lookback (WE antérieur → soir interdit le lendemain)', () => {
    // WE antérieur daté du samedi précédent → dimanche couvert ; le "lendemain"
    // (lundi) est dans la nouvelle période.
    const lookbackWe: AttributionGarde[] = [attWe(SAT)]
    const v = vetAvec('succession_interdite', { type_avant: 'weekend', type_apres: 'semaine_soir' }, 2)
    const planning: PlanningPartiel = { attributions: [] }
    const r = isValid(slotSoir(LUN), v, 'premier', [v], planning, undefined, undefined, lookbackWe)
    expect(r.valid).toBe(false)
    expect(r.raison).toMatch(/SUCCESSION/)
  })
})

// ════════════════════════════════════════════════════════════
describe('byte-identique : sans règle de ces briques, aucun comportement ne change', () => {
  it('un véto sans contrainte de rythme passe tous les slots', () => {
    const v = normaliserContraintesVets([{
      id: 'v', prenom: 'Manon', nom: 'X', statut: 'associe', dernier_recours: false,
      conges: [], contraintes: [],
    }])[0]
    const planning: PlanningPartiel = { attributions: [attSoir(LUN), attSoir(MAR)] }
    expect(isValid(slotSoir(MER), v, 'premier', [v], planning).valid).toBe(true)
    expect(isValid(slotVen('2026-01-09'), v, 'premier', [v], planning).valid).toBe(true)
    expect(penaliteContraintesConfig(slotSoir(MER), v, 'premier', planning)).toBe(0)
  })
})
