// ============================================================
// GUARDVETO — Pénalités souples réglables (backlog n°16) — tests
// ============================================================
// ⚠️ B-135 (26/09) — R10 « 2 WE consécutifs » A ÉTÉ RETIRÉE DU PRODUIT. Elle
// était le véhicule de la plupart des tests de MÉCANISME ci-dessous (clamp,
// étage réglé, extraction base → config) : ce n'est pas elle qu'ils vérifiaient,
// c'est le dispositif générique. Ils ont donc été basculés sur R10b « soirs de
// réveillon », qui est son exact analogue — souple, clampée, sans gardien dur —
// plutôt que supprimés. Supprimer aurait fait perdre la couverture du mécanisme
// en même temps que la règle.
//
// R10c (WE avant vacances), R10b (soirs de réveillon), R8b (inversion la veille
// d'un férié) et R10d (veille de repos) : leurs poids historiques (45/30/20/40)
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

// B-135 — le véhicule des tests de mécanisme, depuis le retrait de R10 : une
// garde le soir du 24 décembre déclenche R10b (`fete_fin_annee`), souple et
// clampée comme R10 l'était. 2026-12-24 est un jeudi, donc un soir de semaine.
const REVEILLON = '2026-12-24'
const planningReveillon: PlanningPartiel = {
  attributions: [
    { date: REVEILLON, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'A' }] },
  ],
}

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

  it('les défauts SONT les constantes historiques 45/30/20 (byte-identique)', () => {
    expect(PENALITE_SOUPLE_DEFAUT.we_avant_vacances).toEqual({ etage: 4, poids: 45 })
    expect(PENALITE_SOUPLE_DEFAUT.fete_fin_annee).toEqual({ etage: 4, poids: 30 })
    expect(PENALITE_SOUPLE_DEFAUT.inversion_ferie).toEqual({ etage: 5, poids: 20 })
    // Les constantes consommées par solver/scoreur pointent la même source.
    expect(PENALITE.WE_AVANT_VACANCES).toBe(45)
    expect(PENALITE.FETE_FIN_ANNEE).toBe(30)
    expect(PENALITE.INVERSION_FERIE).toBe(20)
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
    const r = resoudrePenaliteSouple('fete_fin_annee', { fete_fin_annee: { actif: true, etage: 2 } })
    expect(r.etage).toBe(3)
    expect(r.poids).toBe(30) // le poids reste la constante historique
  })

  // ⚠️ `veille_repos` est la SEULE exception, et elle doit le rester : B-127 lui
  // a donné un vrai gardien dur, donc son plancher descend à 2. Le vérifier ici
  // empêche qu'on « harmonise » un jour le clamp et qu'on lui reprenne sa
  // capacité à interdire sans que personne ne le voie.
  it('veille_repos, elle, PEUT descendre à 2 — elle a un gardien dur (B-127)', () => {
    const r = resoudrePenaliteSouple('veille_repos', { veille_repos: { actif: true, etage: 2 } })
    expect(r.etage).toBe(2)
  })

  it('étage réglé (4→5) → étage suivi, poids intra-étage INCHANGÉ', () => {
    const r = resoudrePenaliteSouple('fete_fin_annee', { fete_fin_annee: { actif: true, etage: 5 } })
    expect(r).toEqual({ actif: true, etage: 5, poids: 30 })
  })
})

// ── B. Gardien SOLVER : penalite() honore la config ──────
describe('penalite() (greedy) — FAITS DIRECTS par règle', () => {
  // B-135 — ce test attendait 50 points sur le 2e week-end consécutif. La règle
  // a été retirée : le fait ne coûte plus rien. On garde l'assertion À L'ENVERS
  // plutôt que de supprimer le test, pour qu'une réintroduction accidentelle de
  // la pénalité se voie immédiatement.
  it('B-135 — 2e WE consécutif : plus aucune pénalité', () => {
    const planningAvant: PlanningPartiel = { attributions: [planningWEConsecutifs.attributions[0]] }
    expect(penalite(slotWE2, A, 'premier', planningAvant)).toBe(0)
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

  // B-135 — ces quatre tests mesuraient le MÉCANISME (l'étage réglé déplace le
  // poids, la désactivation l'annule) en se servant de R10 comme fait
  // déclencheur. R10 n'existe plus : ils passent sur R10b « soir de réveillon »,
  // qui joue exactement le même rôle — souple, clampée, sans gardien dur.
  it('DÉFAUT → la violation R10b pèse à l’étage EVITEE_AU_MAX (4), rien à SI_POSSIBLE', () => {
    const v = scorerPlanning(planningReveillon, VETS, 'hiver', undefined, cfg())
    expect(v.etages[Etage.EVITEE_AU_MAX]).toBeGreaterThan(0)
    expect(v.etages[Etage.SI_POSSIBLE]).toBe(0)
  })

  it('étage 5 configuré → le MÊME fait pèse à SI_POSSIBLE, plus rien à EVITEE_AU_MAX', () => {
    const v = scorerPlanning(planningReveillon, VETS, 'hiver', undefined,
      cfg({ fete_fin_annee: { actif: true, etage: 5 } }))
    expect(v.etages[Etage.EVITEE_AU_MAX]).toBe(0)
    expect(v.etages[Etage.SI_POSSIBLE]).toBeGreaterThan(0)
  })

  it('désactivée → le fait ne pèse plus NULLE PART (étages 3/4/5 à 0)', () => {
    const v = scorerPlanning(planningReveillon, VETS, 'hiver', undefined,
      cfg({ fete_fin_annee: { actif: false, etage: 4 } }))
    expect(v.etages[Etage.SAUF_CRISE]).toBe(0)
    expect(v.etages[Etage.EVITEE_AU_MAX]).toBe(0)
    expect(v.etages[Etage.SI_POSSIBLE]).toBe(0)
  })

  it('DÉFAUT byte-identique : vecteur SANS clé penalitesSouples ≡ vecteur avec config vide', () => {
    const sans = scorerPlanning(planningReveillon, VETS, 'hiver', undefined, cfg())
    const avec = scorerPlanning(planningReveillon, VETS, 'hiver', undefined, cfg({}))
    expect(avec).toEqual(sans)
  })

  // La preuve que le retrait porte jusqu'au SCOREUR, et pas seulement au solver :
  // deux week-ends consécutifs ne pèsent plus à aucun étage souple.
  it('B-135 — deux WE consécutifs ne pèsent plus à aucun étage souple', () => {
    const v = scorerPlanning(planningWEConsecutifs, VETS, 'hiver', undefined, cfg())
    expect(v.etages[Etage.SAUF_CRISE]).toBe(0)
    expect(v.etages[Etage.SI_POSSIBLE]).toBe(0)
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

  it('lit {actif, force→étage} pour chacune des briques', () => {
    const rows = [
      row('eviter_we_avant_vacances', false, 'evitee'),    // R10c coupée
      row('eviter_fete_fin_annee', true, 'sauf_crise'),    // R10b montée à l'étage 3
      row('inversion_role_ferie', true, 'evitee'),         // R8b montée à l'étage 4
    ]
    expect(extrairePenalitesSouples(rows)).toEqual({
      we_avant_vacances: { actif: false, etage: 4 },
      fete_fin_annee: { actif: true, etage: 3 },
      inversion_ferie: { actif: true, etage: 4 },
    })
  })

  // B-135 — une ligne `eviter_we_consecutifs` retrouvée en base (restaurée d'une
  // sauvegarde, rejouée par un import) doit être IGNORÉE, pas crasher ni
  // ressusciter la règle. La migration supprime les lignes connues ; ce test
  // couvre celles qui reviendraient par une autre porte.
  it('B-135 — une ligne « eviter_we_consecutifs » survivante est ignorée', () => {
    expect(extrairePenalitesSouples([row('eviter_we_consecutifs', true, 'jamais')])).toEqual({})
  })

  it('la config voyage dans extraireStructureConfig (threading solver + scoreur)', () => {
    const cfg = extraireStructureConfig([row('eviter_fete_fin_annee', false, 'sauf_crise')])
    expect(cfg.penalitesSouples).toEqual({ fete_fin_annee: { actif: false, etage: 3 } })
    // R8/R9 gardent leur défaut ferme (indépendance des réglages).
    expect(cfg.r9_liaison).toEqual(DEFAULT_STRUCTURE_CONFIG.r9_liaison)
    expect(cfg.r8_inversion).toEqual(DEFAULT_STRUCTURE_CONFIG.r8_inversion)
  })

  it('force « jamais » posée en base → étage 2 extrait, mais résolu CLAMPÉ souple (3)', () => {
    const cfg = extrairePenalitesSouples([row('eviter_fete_fin_annee', true, 'jamais')])
    expect(cfg.fete_fin_annee).toEqual({ actif: true, etage: 2 })
    expect(resoudrePenaliteSouple('fete_fin_annee', cfg).etage).toBe(3)
  })
})
