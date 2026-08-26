// ============================================================
// GUARDVETO — Pénalités souples réglables (backlog n°16) — tests
// ============================================================
// R10 (2 WE consécutifs), R10c (WE avant vacances), R10b (soirs de réveillon)
// et R8b (inversion la veille d'un férié) : leurs poids historiques (50/45/30/20)
// ne sont plus câblés — chaque cabinet peut les DÉSACTIVER ou changer leur
// NIVEAU (étage lexicographique). On vérifie par des FAITS DIRECTS :
//   • la résolution (défaut historique, désactivation, clamp toujours-souple)
//   • le gardien SOLVER (penalite() greedy) honore la config
//   • le gardien SCOREUR (scorerPlanning) déplace l'étage / annule le poids
//   • l'extraction depuis regles_cabinet (mapping base → config)
//   • le DÉFAUT sans config = comportement historique (byte-identique)
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  PENALITE,
  penalite,
} from '@/engine/rules/soft-constraints'
import { scorerPlanning, Etage, POIDS_INTRA } from '@/engine/score-lexicographique'
import {
  DEFAULT_STRUCTURE_CONFIG,
  PENALITE_SOUPLE_DEFAUT,
  PENALITES_SOUPLES_IDS,
  resoudrePenaliteSouple,
  poidsPenaliteSouple,
  type PenalitesSouplesConfig,
  type StructureConfig,
} from '@/engine/structure-config'
import {
  extrairePenalitesSouples,
  extraireStructureConfig,
  type RegleCabinetRow,
} from '@/data/mapReglesCabinet'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { VetEngine, VetEngineNormalise, SlotGarde, PlanningPartiel } from '@/engine/types'

// ── Fixtures ─────────────────────────────────────────────

const vet = (id: string, conges: VetEngine['conges'] = []): VetEngineNormalise =>
  normaliserContraintesVets([{
    id, prenom: id, nom: 'X', statut: 'associe', dernier_recours: false,
    contraintes: [], conges,
  } as VetEngine])[0]

const A = vet('A')
const B = vet('B')

// Deux week-ends CONSÉCUTIFS (samedis à 7 jours d'écart, janvier sans férié).
const SAM1 = '2026-01-10'
const SAM2 = '2026-01-17'

/** Planning : A de garde le WE du 10 ET le WE du 17 (R10 violée au 2e WE). */
const planningWEConsecutifs: PlanningPartiel = {
  attributions: [
    { date: SAM1, type: 'weekend', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
    { date: SAM2, type: 'weekend', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
  ],
}
const slotWE2: SlotGarde = { date: SAM2, type: 'weekend', saison: 'hiver', besoinSecond: true }

const off = (id: (typeof PENALITES_SOUPLES_IDS)[number]): PenalitesSouplesConfig =>
  ({ [id]: { actif: false, etage: PENALITE_SOUPLE_DEFAUT[id].etage } })

// ── A. Résolution (structure-config) ─────────────────────
describe('resoudrePenaliteSouple — défauts, désactivation, clamp', () => {
  it('sans config → défaut HISTORIQUE (actif, étage + poids d’origine) pour les 4', () => {
    for (const id of PENALITES_SOUPLES_IDS) {
      expect(resoudrePenaliteSouple(id)).toEqual({
        actif: true,
        etage: PENALITE_SOUPLE_DEFAUT[id].etage,
        poids: PENALITE_SOUPLE_DEFAUT[id].poids,
      })
    }
  })

  it('les défauts SONT les constantes historiques 50/45/30/20 (byte-identique)', () => {
    expect(PENALITE_SOUPLE_DEFAUT.we_consecutif).toEqual({ etage: 3, poids: 50 })
    expect(PENALITE_SOUPLE_DEFAUT.we_avant_vacances).toEqual({ etage: 4, poids: 45 })
    expect(PENALITE_SOUPLE_DEFAUT.fete_fin_annee).toEqual({ etage: 4, poids: 30 })
    expect(PENALITE_SOUPLE_DEFAUT.inversion_ferie).toEqual({ etage: 5, poids: 20 })
    // Les constantes consommées par solver/scoreur pointent la même source.
    expect(PENALITE.WE_CONSECUTIF).toBe(50)
    expect(PENALITE.WE_AVANT_VACANCES).toBe(45)
    expect(PENALITE.FETE_FIN_ANNEE).toBe(30)
    expect(PENALITE.INVERSION_FERIE).toBe(20)
    expect(POIDS_INTRA.R10_WE_CONSECUTIF).toBe(50)
    expect(POIDS_INTRA.R10C_WE_AVANT_VACANCES).toBe(45)
    expect(POIDS_INTRA.R10B_FETE_FIN_ANNEE).toBe(30)
    expect(POIDS_INTRA.R8B_INVERSION_FERIE).toBe(20)
  })

  it('désactivée → poids 0 (la règle ne pèse plus nulle part)', () => {
    for (const id of PENALITES_SOUPLES_IDS) {
      expect(poidsPenaliteSouple(id, off(id))).toBe(0)
    }
  })

  it('étage < 3 (posé en dur en base) → CLAMPÉ à 3 : jamais dure (pas de gardien dur)', () => {
    const r = resoudrePenaliteSouple('we_consecutif', { we_consecutif: { actif: true, etage: 2 } })
    expect(r.etage).toBe(3)
    expect(r.poids).toBe(50) // le poids reste la constante historique
  })

  it('étage réglé (3→5) → étage suivi, poids intra-étage INCHANGÉ', () => {
    const r = resoudrePenaliteSouple('we_consecutif', { we_consecutif: { actif: true, etage: 5 } })
    expect(r).toEqual({ actif: true, etage: 5, poids: 50 })
  })
})

// ── B. Gardien SOLVER : penalite() honore la config ──────
describe('penalite() (greedy) — FAITS DIRECTS par règle', () => {
  it('R10 — 2e WE consécutif : 50 par défaut, 0 si désactivée', () => {
    const planningAvant: PlanningPartiel = { attributions: [planningWEConsecutifs.attributions[0]] }
    expect(penalite(slotWE2, A, 'premier', planningAvant)).toBe(50)
    expect(penalite(slotWE2, A, 'premier', planningAvant, undefined, off('we_consecutif'))).toBe(0)
  })

  it('R10b — soir du 24 décembre : 30 par défaut, 0 si désactivée', () => {
    const slotNoel: SlotGarde = { date: '2026-12-24', type: 'semaine_soir', saison: 'hiver', besoinSecond: false }
    const vide: PlanningPartiel = { attributions: [] }
    expect(penalite(slotNoel, A, 'premier', vide)).toBe(30)
    expect(penalite(slotNoel, A, 'premier', vide, undefined, off('fete_fin_annee'))).toBe(0)
  })

  it('R10c — WE avant ses vacances : 45 par défaut, 0 si désactivée', () => {
    // Vacances de A qui démarrent le lundi suivant le WE du 10.
    const enVacances = vet('A', [
      { type: 'vacances', date_debut: '2026-01-12', date_fin: '2026-01-18' } as VetEngine['conges'][number],
    ])
    const slotWE1: SlotGarde = { date: SAM1, type: 'weekend', saison: 'hiver', besoinSecond: true }
    const vide: PlanningPartiel = { attributions: [] }
    expect(penalite(slotWE1, enVacances, 'premier', vide)).toBe(45)
    expect(penalite(slotWE1, enVacances, 'premier', vide, undefined, off('we_avant_vacances'))).toBe(0)
  })

  // ── R10d (B-063) — « éviter les jours de garde la veille d'un repos » ──
  //
  // Demandé par MiKL le 26/08. Une garde de nuit déborde sur le lendemain
  // matin : elle mord sur le repos qui suit.

  it('R10d — la veille d’un congé posé : 40 par défaut, 0 si désactivée', () => {
    // Précision de MiKL : « c'est valable dès qu'une personne est en congé DANS
    // LE PLANNING, pas que dans les règles ». Et quel que soit le TYPE de congé
    // — une formation ou un arrêt se respectent autant que des vacances.
    const enFormation = vet('A', [
      { type: 'formation', date_debut: '2026-01-15', date_fin: '2026-01-15' } as VetEngine['conges'][number],
    ])
    const veille: SlotGarde = { date: '2026-01-14', type: 'semaine_soir', saison: 'hiver', besoinSecond: false }
    const vide: PlanningPartiel = { attributions: [] }

    expect(penalite(veille, enFormation, 'premier', vide)).toBe(40)
    expect(penalite(veille, enFormation, 'premier', vide, undefined, off('veille_repos'))).toBe(0)
  })

  it('R10d — un soir SANS absence le lendemain ne coûte rien', () => {
    const veille: SlotGarde = { date: '2026-01-14', type: 'semaine_soir', saison: 'hiver', besoinSecond: false }
    expect(penalite(veille, A, 'premier', { attributions: [] })).toBe(0)
  })

  it('R10d — pour un week-end, le lendemain est le LUNDI', () => {
    // La garde de week-end court jusqu'au dimanche : c'est le lundi qui doit
    // être libre, pas le samedi. Se tromper de jour rendrait la règle muette
    // sur le seul créneau où elle compte le plus.
    const congeLundi = vet('A', [
      { type: 'autre', date_debut: '2026-01-12', date_fin: '2026-01-12' } as VetEngine['conges'][number],
    ])
    const we: SlotGarde = { date: SAM1, type: 'weekend', saison: 'hiver', besoinSecond: true }
    expect(penalite(we, congeLundi, 'premier', { attributions: [] })).toBe(40)
  })

  it('R10d — PAS DE DOUBLE PEINE : elle cède là où R10c couvre déjà', () => {
    // Le week-end avant des vacances est déjà pénalisé par R10c, et son
    // lendemain tombe dans le congé. Sans cette précaution, la même situation
    // serait comptée deux fois (85 au lieu de 45).
    const enVacances = vet('A', [
      { type: 'vacances', date_debut: '2026-01-12', date_fin: '2026-01-18' } as VetEngine['conges'][number],
    ])
    const we: SlotGarde = { date: SAM1, type: 'weekend', saison: 'hiver', besoinSecond: true }
    expect(penalite(we, enVacances, 'premier', { attributions: [] })).toBe(45)
  })

  it('R10d — R10c désactivée ne la fait pas revenir par la bande', () => {
    // Un cabinet qui a dit « je me fiche du week-end avant les vacances » ne
    // doit pas voir la règle réapparaître sous un autre nom.
    const enVacances = vet('A', [
      { type: 'vacances', date_debut: '2026-01-12', date_fin: '2026-01-18' } as VetEngine['conges'][number],
    ])
    const we: SlotGarde = { date: SAM1, type: 'weekend', saison: 'hiver', besoinSecond: true }
    expect(penalite(we, enVacances, 'premier', { attributions: [] }, undefined, off('we_avant_vacances'))).toBe(0)
  })

  it('DÉFAUT byte-identique : config absente ≡ config vide ≡ historique', () => {
    const planningAvant: PlanningPartiel = { attributions: [planningWEConsecutifs.attributions[0]] }
    const sans = penalite(slotWE2, A, 'premier', planningAvant)
    const vide = penalite(slotWE2, A, 'premier', planningAvant, undefined, {})
    expect(vide).toBe(sans)
  })
})

// ── C. Gardien SCOREUR : scorerPlanning déplace/annule ───
describe('scorerPlanning — étage réglé, poids annulé, défaut identique', () => {
  const VETS = [A, B]
  const cfg = (penalitesSouples?: PenalitesSouplesConfig): StructureConfig => ({
    ...DEFAULT_STRUCTURE_CONFIG,
    // Pas de vendredis dans ce planning : on coupe R9/R8 pour isoler R10
    // (sinon les WE sans vendredi lié comptent en invariants selon la config).
    r9_liaison: { actif: false, etage: 2 },
    r8_inversion: { actif: false, etage: 2 },
    ...(penalitesSouples ? { penalitesSouples } : {}),
  })

  it('DÉFAUT → la violation R10 pèse à l’étage SAUF_CRISE (3), rien à SI_POSSIBLE', () => {
    const v = scorerPlanning(planningWEConsecutifs, VETS, 'hiver', undefined, cfg())
    expect(v.etages[Etage.SAUF_CRISE]).toBeGreaterThan(0)
    expect(v.etages[Etage.SI_POSSIBLE]).toBe(0)
  })

  it('étage 5 configuré → le MÊME fait pèse à SI_POSSIBLE, plus rien à SAUF_CRISE', () => {
    const v = scorerPlanning(planningWEConsecutifs, VETS, 'hiver', undefined,
      cfg({ we_consecutif: { actif: true, etage: 5 } }))
    expect(v.etages[Etage.SAUF_CRISE]).toBe(0)
    expect(v.etages[Etage.SI_POSSIBLE]).toBeGreaterThan(0)
  })

  it('désactivée → le fait ne pèse plus NULLE PART (étages 3/4/5 à 0)', () => {
    const v = scorerPlanning(planningWEConsecutifs, VETS, 'hiver', undefined,
      cfg({ we_consecutif: { actif: false, etage: 3 } }))
    expect(v.etages[Etage.SAUF_CRISE]).toBe(0)
    expect(v.etages[Etage.EVITEE_AU_MAX]).toBe(0)
    expect(v.etages[Etage.SI_POSSIBLE]).toBe(0)
  })

  it('DÉFAUT byte-identique : vecteur SANS clé penalitesSouples ≡ vecteur avec config vide', () => {
    const sans = scorerPlanning(planningWEConsecutifs, VETS, 'hiver', undefined, cfg())
    const avec = scorerPlanning(planningWEConsecutifs, VETS, 'hiver', undefined, cfg({}))
    expect(avec).toEqual(sans)
  })
})

// ── D. Extraction base → config (mapping) ────────────────
describe('extrairePenalitesSouples / extraireStructureConfig — lecture des lignes', () => {
  const row = (briqueId: string, actif: boolean, force: string): RegleCabinetRow => ({
    id: `r-${briqueId}`, cabinet_id: 'c', periode_id: null, brique_id: briqueId,
    actif, force, params_json: { params: {} },
  })

  it('aucune ligne → config VIDE, et extraireStructureConfig reste STRICTEMENT le défaut', () => {
    expect(extrairePenalitesSouples([])).toEqual({})
    // Byte-identique : pas même une clé penalitesSouples surnuméraire.
    expect(extraireStructureConfig([])).toEqual(DEFAULT_STRUCTURE_CONFIG)
    expect('penalitesSouples' in extraireStructureConfig([])).toBe(false)
  })

  it('lit {actif, force→étage} pour chacune des 4 briques', () => {
    const rows = [
      row('eviter_we_consecutifs', true, 'si_possible'),   // R10 descendue à l'étage 5
      row('eviter_we_avant_vacances', false, 'evitee'),    // R10c coupée
      row('eviter_fete_fin_annee', true, 'sauf_crise'),    // R10b montée à l'étage 3
      row('inversion_role_ferie', true, 'evitee'),         // R8b montée à l'étage 4
    ]
    expect(extrairePenalitesSouples(rows)).toEqual({
      we_consecutif: { actif: true, etage: 5 },
      we_avant_vacances: { actif: false, etage: 4 },
      fete_fin_annee: { actif: true, etage: 3 },
      inversion_ferie: { actif: true, etage: 4 },
    })
  })

  it('la config voyage dans extraireStructureConfig (threading solver + scoreur)', () => {
    const cfg = extraireStructureConfig([row('eviter_we_consecutifs', false, 'sauf_crise')])
    expect(cfg.penalitesSouples).toEqual({ we_consecutif: { actif: false, etage: 3 } })
    // R8/R9 gardent leur défaut ferme (indépendance des réglages).
    expect(cfg.r9_liaison).toEqual(DEFAULT_STRUCTURE_CONFIG.r9_liaison)
    expect(cfg.r8_inversion).toEqual(DEFAULT_STRUCTURE_CONFIG.r8_inversion)
  })

  it('force « jamais » posée en base → étage 2 extrait, mais résolu CLAMPÉ souple (3)', () => {
    const cfg = extrairePenalitesSouples([row('eviter_we_consecutifs', true, 'jamais')])
    expect(cfg.we_consecutif).toEqual({ actif: true, etage: 2 })
    expect(resoudrePenaliteSouple('we_consecutif', cfg).etage).toBe(3)
  })
})
