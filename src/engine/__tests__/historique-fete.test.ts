// ============================================================
// GUARDVETO — Tests : équité inter-annuelle des fêtes (backlog n°14)
// ============================================================
// Couvre les 4 garanties de la feature :
//   1. DÉTECTION — mapping dates ↔ instances de fête (moteur ET gardes V1).
//   2. BYTE-IDENTIQUE — historique absent OU vide OU sans véto concerné
//      ⇒ planning STRICTEMENT inchangé (LA preuve exigée : la pénalité ne
//      peut pas exister sans donnée).
//   3. ÉVITEMENT — historique présent ⇒ le véto qui a fait Noël l'an dernier
//      ne le refait pas cette année (scénario synthétique de bout en bout),
//      et les DEUX scoreurs (penalite() du greedy/LNS + scorerPlanning)
//      consomment la MÊME donnée de la MÊME façon.
//   4. ALIMENTATION — calcul pur des entrées depuis les gardes V1
//      (couverture week-end→vendredi, dédoublonnage, déterminisme).
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur } from '../solver'
import type { SolverInput } from '../solver'
import type { PlanningPartiel, VetEngine } from '../types'
import { normaliserContraintesVets } from '../normaliserContraintes'
import { scorerPlanning, comparerScores } from '../score-lexicographique'
import { penalite } from '../rules/soft-constraints'
import { DEFAULT_STRUCTURE_CONFIG, type StructureConfig } from '../structure-config'
import {
  feteDeDate,
  fetesCouvertesParSlot,
  fetesCouvertesParGardeV1,
  anneesFetesCouvertes,
  cleHistoriqueFete,
  resoudreHistoriqueFetes,
  penaliteFeteHistorique,
  PENALITE_FETE_HISTORIQUE,
} from '../historique-fete'
import { calculerEntreesHistoriqueFete } from '@/data/historiqueFetes'

// ── Scénario synthétique : 5 vétos sans contrainte, période sur Noël ──

function vet(id: string, nom: string): VetEngine {
  return {
    id, nom, prenom: nom, statut: 'associe', dernier_recours: false,
    contraintes: [], conges: [],
  }
}

const VETS = [vet('v1', 'Alpha'), vet('v2', 'Bravo'), vet('v3', 'Charlie'), vet('v4', 'Delta'), vet('v5', 'Echo')]

/** 2 semaines couvrant Noël 2026 (24 jeu, 25 ven) et le Nouvel An (31 jeu, 01 ven). */
function makeInput(structureConfig?: StructureConfig): SolverInput {
  return {
    dateDebut: '2026-12-21', // lundi
    dateFin: '2027-01-03',   // dimanche
    saison: 'ete',           // 1 véto les soirs de semaine (scénario léger)
    vets: VETS.map((v) => ({ ...v })),
    bonusMalus: {},
    calendrier: {
      feries: new Set(['2026-12-25', '2027-01-01']),
      vacancesScolaires: [{ debut: '2026-12-19', fin: '2027-01-03' }],
    },
    ...(structureConfig ? { structureConfig } : {}),
  }
}

function empreinte(planning: PlanningPartiel): string {
  return JSON.stringify(
    [...planning.attributions]
      .sort((a, b) =>
        a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date),
      )
      .map((a) => `${a.date}|${a.type}|${a.placements.map((p) => `${p.role}:${p.vetId ?? '-'}`).join('|')}`),
  )
}

/** Vétos attribués sur les dates données (tous types de créneau). */
function vetsSurDates(planning: PlanningPartiel, dates: string[]): Set<string> {
  const out = new Set<string>()
  for (const a of planning.attributions) {
    if (!dates.includes(a.date)) continue
    for (const p of a.placements) if (p.vetId) out.add(p.vetId)
  }
  return out
}

const TEST_TIMEOUT = 60_000

// ═══ 1. Détection des fêtes ═══════════════════════════════════

describe('historique-fete — détection des instances de fête', () => {
  it('feteDeDate : 4 dates de fête, convention année de décembre', () => {
    expect(feteDeDate('2026-12-24')).toEqual({ fete: 'noel', annee: 2026 })
    expect(feteDeDate('2026-12-25')).toEqual({ fete: 'noel', annee: 2026 })
    expect(feteDeDate('2026-12-31')).toEqual({ fete: 'nouvel_an', annee: 2026 })
    // Le 01/01/2027 appartient au Nouvel An 2026 (même réveillon).
    expect(feteDeDate('2027-01-01')).toEqual({ fete: 'nouvel_an', annee: 2026 })
    expect(feteDeDate('2026-12-26')).toBeNull()
    expect(feteDeDate('2026-07-14')).toBeNull()
  })

  it('fetesCouvertesParSlot : weekend moteur = samedi + dimanche, dédoublonné', () => {
    // 2027 : le 25/12 tombe un samedi → le slot weekend couvre 25 + 26.
    expect(fetesCouvertesParSlot('2027-12-25', 'weekend')).toEqual([{ fete: 'noel', annee: 2027 }])
    // 2026 : samedi 26/12 → couvre 26 + 27, aucune fête.
    expect(fetesCouvertesParSlot('2026-12-26', 'weekend')).toEqual([])
    // Slots à date unique (semaine_soir, vendredi_soir, sur-mesure).
    expect(fetesCouvertesParSlot('2026-12-24', 'semaine_soir')).toEqual([{ fete: 'noel', annee: 2026 }])
    expect(fetesCouvertesParSlot('2027-01-01', 'vendredi_soir')).toEqual([{ fete: 'nouvel_an', annee: 2026 }])
  })

  it('fetesCouvertesParGardeV1 : le week-end V1 (samedi) emporte AUSSI le vendredi', () => {
    // 2027 : samedi 25/12 → couvre [24, 25, 26] → Noël 2027, UNE fois (24+25 dédoublonnés).
    expect(fetesCouvertesParGardeV1('2027-12-25', 'weekend')).toEqual([{ fete: 'noel', annee: 2027 }])
    // Samedi 02/01/2027 → couvre [01, 02, 03] → Nouvel An 2026 (via le vendredi 01/01).
    expect(fetesCouvertesParGardeV1('2027-01-02', 'weekend')).toEqual([{ fete: 'nouvel_an', annee: 2026 }])
    // Ligne V1 'ferie' du 25/12 (jour à date unique).
    expect(fetesCouvertesParGardeV1('2026-12-25', 'ferie')).toEqual([{ fete: 'noel', annee: 2026 }])
  })

  it('anneesFetesCouvertes : années de saison couvertes par une fenêtre', () => {
    expect(anneesFetesCouvertes('2026-12-21', '2027-01-03')).toEqual([2026])
    // Une période qui ne contient QUE le 01/01 couvre quand même le Nouvel An N-1.
    expect(anneesFetesCouvertes('2027-01-01', '2027-03-01')).toEqual([2026])
    // Aucune fête (période janvier→mars après le 01/01... hors 01/01).
    expect(anneesFetesCouvertes('2026-01-05', '2026-03-29')).toEqual([])
    // Fenêtre longue chevauchant deux saisons de fêtes.
    expect(anneesFetesCouvertes('2025-12-24', '2026-12-31')).toEqual([2025, 2026])
  })
})

// ═══ 2. Pénalité unitaire + cohérence greedy/LNS ═════════════

describe('historique-fete — pénalité souple', () => {
  const histoV1Noel2025 = resoudreHistoriqueFetes([
    { veterinaire_id: 'v1', fete: 'noel', annee: 2025 },
  ])

  it('penaliteFeteHistorique : pénalise UNIQUEMENT le véto de la fête N-1', () => {
    const slotNoel = { date: '2026-12-24', type: 'semaine_soir' }
    // v1 a fait Noël 2025 → Noël 2026 pénalisé.
    expect(penaliteFeteHistorique(slotNoel, 'v1', histoV1Noel2025)).toBe(PENALITE_FETE_HISTORIQUE.poids)
    // Un autre véto → rien.
    expect(penaliteFeteHistorique(slotNoel, 'v2', histoV1Noel2025)).toBe(0)
    // La MAUVAISE fête (Nouvel An) → rien pour v1.
    expect(penaliteFeteHistorique({ date: '2026-12-31', type: 'semaine_soir' }, 'v1', histoV1Noel2025)).toBe(0)
    // Il y a DEUX ans (pas l'an dernier) → rien : la promesse porte sur N-1.
    const histoV1Noel2024 = resoudreHistoriqueFetes([{ veterinaire_id: 'v1', fete: 'noel', annee: 2024 }])
    expect(penaliteFeteHistorique(slotNoel, 'v1', histoV1Noel2024)).toBe(0)
    // Historique absent ou vide → 0 (byte-identique par construction).
    expect(penaliteFeteHistorique(slotNoel, 'v1', undefined)).toBe(0)
    expect(penaliteFeteHistorique(slotNoel, 'v1', new Set())).toBe(0)
  })

  it('penalite() (greedy ET LNS passent ici) intègre la pénalité historique', () => {
    const slot = { date: '2026-12-24', type: 'semaine_soir', saison: 'ete' } as const
    const v1 = VETS[0]
    const planningVide: PlanningPartiel = { attributions: [] }
    const sans = penalite(slot, v1, 'premier', planningVide, undefined, undefined, undefined)
    const avec = penalite(slot, v1, 'premier', planningVide, undefined, undefined, histoV1Noel2025)
    // Même contexte, seule différence = l'historique → écart EXACT = le poids.
    expect(avec - sans).toBe(PENALITE_FETE_HISTORIQUE.poids)
  })
})

// ═══ 3. BYTE-IDENTIQUE (la preuve) + évitement de bout en bout ═══

describe('historique-fete — byte-identique et évitement (bout en bout)', () => {
  it('table vide OU absente OU véto non concerné ⇒ planning STRICTEMENT inchangé', () => {
    // Référence : aucun historique (comportement d'avant la feature).
    const ref = genererPlanningPur(makeInput())
    expect(ref.success).toBe(true)
    if (!ref.success) return

    // a) historique VIDE (= table migrée mais sans données) → byte-identique.
    const rVide = genererPlanningPur(
      makeInput({ ...DEFAULT_STRUCTURE_CONFIG, historiqueFetes: new Set() }),
    )
    expect(rVide.success).toBe(true)
    if (!rVide.success) return
    expect(empreinte(rVide.planning)).toBe(empreinte(ref.planning))

    // b) historique portant un véto INCONNU du cabinet → byte-identique aussi.
    const rEtranger = genererPlanningPur(
      makeInput({
        ...DEFAULT_STRUCTURE_CONFIG,
        historiqueFetes: new Set([cleHistoriqueFete('vet-inconnu', 'noel', 2025)]),
      }),
    )
    expect(rEtranger.success).toBe(true)
    if (!rEtranger.success) return
    expect(empreinte(rEtranger.planning)).toBe(empreinte(ref.planning))
  }, TEST_TIMEOUT)

  it('le véto de Noël dernier ÉVITE Noël cette année (et les 2 scoreurs sont d\'accord)', () => {
    const DATES_NOEL = ['2026-12-24', '2026-12-25']

    // 1. Sans historique : noter QUI tient Noël.
    const ref = genererPlanningPur(makeInput())
    expect(ref.success).toBe(true)
    if (!ref.success) return
    const tenantsRef = vetsSurDates(ref.planning, DATES_NOEL)
    expect(tenantsRef.size).toBeGreaterThan(0)
    const cible = [...tenantsRef].sort()[0]

    // 2. Le scoreur GLOBAL voit la pénalité : même planning, jugé avec
    //    l'historique du véto qui tient Noël → score strictement pire.
    const vetsN = normaliserContraintesVets(VETS)
    const histo = new Set([cleHistoriqueFete(cible, 'noel', 2025)])
    const calendrier = makeInput().calendrier
    const sSans = scorerPlanning(ref.planning, vetsN, 'ete', undefined, DEFAULT_STRUCTURE_CONFIG, undefined, calendrier)
    const sAvec = scorerPlanning(ref.planning, vetsN, 'ete', undefined, { ...DEFAULT_STRUCTURE_CONFIG, historiqueFetes: histo }, undefined, calendrier)
    // sSans est MEILLEUR (comparerScores < 0) et l'écart est à l'étage 4.
    expect(comparerScores(sSans, sAvec)).toBeLessThan(0)
    expect(sAvec.etages[PENALITE_FETE_HISTORIQUE.etage] - sSans.etages[PENALITE_FETE_HISTORIQUE.etage])
      .toBeGreaterThanOrEqual(PENALITE_FETE_HISTORIQUE.poids)

    // 3. De bout en bout : régénérer AVEC l'historique → la cible n'apparaît
    //    plus sur les dates de Noël (le moteur a des alternatives légales).
    const rAvec = genererPlanningPur(
      makeInput({ ...DEFAULT_STRUCTURE_CONFIG, historiqueFetes: histo }),
    )
    expect(rAvec.success).toBe(true)
    if (!rAvec.success) return
    const tenantsAvec = vetsSurDates(rAvec.planning, DATES_NOEL)
    expect(tenantsAvec.has(cible)).toBe(false)
  }, TEST_TIMEOUT)
})

// ═══ 4. Alimentation (calcul pur depuis les gardes V1) ═══════

describe('historique-fete — calcul des entrées à la publication', () => {
  it('couvre les fêtes, dérive le vendredi du week-end V1, dédoublonne', () => {
    const gardes = [
      // 24/12 (jeudi) : a=premier, b=second → Noël 2026 pour les deux.
      { date: '2026-12-24', type: 'semaine', premier_id: 'a', second_id: 'b' },
      // 25/12 (vendredi férié, ligne V1 'ferie') : a encore + c → a DÉDOUBLONNÉ.
      { date: '2026-12-25', type: 'ferie', premier_id: 'a', second_id: 'c' },
      // Week-end du samedi 02/01/2027 : couvre le vendredi 01/01 → Nouvel An 2026.
      { date: '2027-01-02', type: 'weekend', premier_id: 'd', second_id: null },
      // Garde ordinaire : aucune fête.
      { date: '2026-12-28', type: 'semaine', premier_id: 'e', second_id: 'a' },
    ]
    const entrees = calculerEntreesHistoriqueFete(gardes, 'cab-1', 'per-1')

    expect(entrees).toHaveLength(4)
    const parVet = new Map(entrees.map((e) => [`${e.veterinaire_id}|${e.fete}`, e]))
    // a : UNE entrée Noël (la première chronologiquement — 24/12, premier).
    const a = parVet.get('a|noel')
    expect(a).toMatchObject({ annee: 2026, role: 'premier', garde_date: '2026-12-24', cabinet_id: 'cab-1', periode_id: 'per-1' })
    expect(parVet.get('b|noel')).toMatchObject({ annee: 2026, role: 'second' })
    expect(parVet.get('c|noel')).toMatchObject({ annee: 2026, role: 'second' })
    expect(parVet.get('d|nouvel_an')).toMatchObject({ annee: 2026, role: 'premier', garde_date: '2027-01-02' })

    // IDEMPOTENCE du calcul : re-calcul → EXACTEMENT les mêmes entrées
    // (l'écriture DB fait delete ciblé + insert → re-publication = même état).
    const rejoue = calculerEntreesHistoriqueFete([...gardes].reverse(), 'cab-1', 'per-1')
    expect(rejoue).toEqual(entrees)
  })

  it('période sans fête → aucune entrée', () => {
    const gardes = [
      { date: '2026-02-03', type: 'semaine', premier_id: 'a', second_id: 'b' },
      { date: '2026-02-07', type: 'weekend', premier_id: 'c', second_id: 'd' },
    ]
    expect(calculerEntreesHistoriqueFete(gardes, 'cab-1', 'per-1')).toHaveLength(0)
  })
})
