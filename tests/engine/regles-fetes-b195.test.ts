// ============================================================
// B-195 (10/11) — les deux règles des fêtes, réglables par le cabinet
// ============================================================
// MiKL : « garde la possibilité pour un cabinet de paramétrer que Noël et jour
// de l'an ce ne doit pas être les mêmes vétos de garde, et pareil pour le fait
// que ce ne doit pas être les mêmes vétos une année sur l'autre, comme une
// règle paramétrable comme les autres règles de l'organisation des gardes ».
//
// Ce fichier vérifie le COMPORTEMENT (ce que le moteur refuse ou pénalise),
// pas seulement la présence des règles dans des listes.
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid } from '@/engine/rules/hard-constraints'
import { penalite, penaliteNoelNouvelAn } from '@/engine/rules/soft-constraints'
import { penaliteFeteHistorique, resoudreHistoriqueFetes } from '@/engine/historique-fete'
import {
  DEFAULT_STRUCTURE_CONFIG,
  resoudrePenaliteSouple,
  type PenaliteSoupleId,
  type StructureConfig,
} from '@/engine/structure-config'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { BRIQUES_AVEC_GARDIEN_DUR, extrairePenalitesSouples } from '@/data/mapReglesCabinet'
import type { PlanningPartiel, SlotGarde, VetEngine } from '@/engine/types'

const [JEAN, FANNY] = normaliserContraintesVets([
  { id: 'jean', prenom: 'Jean', contraintes: [], conges: [] } as unknown as VetEngine,
  { id: 'fanny', prenom: 'Fanny', contraintes: [], conges: [] } as unknown as VetEngine,
])

const slot = (date: string): SlotGarde => ({ date, type: 'semaine_soir', saison: 'hiver', besoinSecond: true })

/** Jean tient déjà le soir du 24 décembre 2026. */
const jeanANoel: PlanningPartiel = {
  attributions: [{ date: '2026-12-24', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'jean' }] }],
}

function reglage(id: PenaliteSoupleId, etage: number, actif = true): StructureConfig {
  return { ...DEFAULT_STRUCTURE_CONFIG, penalitesSouples: { [id]: { actif, etage } } }
}

const valide = (vetId: 'jean' | 'fanny', date: string, structure?: StructureConfig) =>
  isValid(slot(date), vetId === 'jean' ? JEAN : FANNY, 'premier', [JEAN, FANNY], jeanANoel, undefined, structure).valid

describe('① Noël et Nouvel An — pas la même personne', () => {
  it('ÉTEINTE par défaut : un cabinet qui n’a rien réglé ne voit aucune différence', () => {
    expect(resoudrePenaliteSouple('noel_nouvel_an')).toEqual({ actif: false, etage: 3, poids: 0 })
    expect(valide('jean', '2026-12-31')).toBe(true)
    expect(penaliteNoelNouvelAn(slot('2026-12-31'), JEAN, jeanANoel)).toBe(0)
  })

  it('« jamais » : Jean, déjà là à Noël, est refusé le 31 — Fanny ne l’est pas', () => {
    const jamais = reglage('noel_nouvel_an', 2)
    expect(valide('jean', '2026-12-31', jamais)).toBe(false)
    expect(valide('jean', '2027-01-01', jamais)).toBe(false)
    expect(valide('fanny', '2026-12-31', jamais)).toBe(true)
    // Un autre soir que les fêtes reste libre.
    expect(valide('jean', '2026-12-29', jamais)).toBe(true)
  })

  it('« jamais » ne mélange pas les saisons : Noël 2025 n’empêche pas le Nouvel An 2026', () => {
    const planningNoel2025: PlanningPartiel = {
      attributions: [{ date: '2025-12-24', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'jean' }] }],
    }
    const ok = isValid(slot('2026-12-31'), JEAN, 'premier', [JEAN, FANNY], planningNoel2025, undefined,
      reglage('noel_nouvel_an', 2)).valid
    expect(ok).toBe(true)
  })

  it('en préférence : rien n’est refusé, mais la pose est pénalisée', () => {
    const souple = reglage('noel_nouvel_an', 4)
    expect(valide('jean', '2026-12-31', souple)).toBe(true)
    expect(penaliteNoelNouvelAn(slot('2026-12-31'), JEAN, jeanANoel, souple.penalitesSouples)).toBe(50)
    expect(penaliteNoelNouvelAn(slot('2026-12-31'), FANNY, jeanANoel, souple.penalitesSouples)).toBe(0)
  })

  it('peut être réglée « jamais » depuis l’écran (gardien dur déclaré)', () => {
    expect(BRIQUES_AVEC_GARDIEN_DUR.has('pas_meme_veto_noel_nouvel_an')).toBe(true)
  })
})

describe('② La même fête deux ans de suite', () => {
  const histo = resoudreHistoriqueFetes([{ veterinaire_id: 'jean', fete: 'noel', annee: 2025 }])

  it('défaut INCHANGÉ : active, poids 40, comme quand elle était écrite en dur', () => {
    expect(resoudrePenaliteSouple('fete_historique')).toEqual({ actif: true, etage: 4, poids: 40 })
    expect(penaliteFeteHistorique(slot('2026-12-24'), 'jean', histo)).toBe(40)
    expect(penaliteFeteHistorique(slot('2026-12-24'), 'fanny', histo)).toBe(0)
  })

  it('désactivée par le cabinet : elle ne pèse plus nulle part', () => {
    const off = reglage('fete_historique', 4, false).penalitesSouples
    expect(penaliteFeteHistorique(slot('2026-12-24'), 'jean', histo, off)).toBe(0)
    expect(penalite(slot('2026-12-24'), JEAN, 'premier', { attributions: [] }, undefined, off, histo)).toBe(
      penalite(slot('2026-12-24'), FANNY, 'premier', { attributions: [] }, undefined, off, histo),
    )
  })

  it('ne peut pas devenir une interdiction : « jamais » est ramené à une préférence', () => {
    expect(resoudrePenaliteSouple('fete_historique', { fete_historique: { actif: true, etage: 2 } }).etage).toBe(3)
    expect(BRIQUES_AVEC_GARDIEN_DUR.has('eviter_meme_fete_annee_suivante')).toBe(false)
  })
})

describe('Lecture en base — les lignes du cabinet arrivent au moteur', () => {
  it('les deux briques sont lues avec leur niveau', () => {
    const cfg = extrairePenalitesSouples([
      { id: 'a', brique_id: 'pas_meme_veto_noel_nouvel_an', force: 'jamais', actif: true, params_json: {} },
      { id: 'b', brique_id: 'eviter_meme_fete_annee_suivante', force: 'si_possible', actif: false, params_json: {} },
    ] as never)
    expect(cfg.noel_nouvel_an).toEqual({ actif: true, etage: 2 })
    expect(cfg.fete_historique).toEqual({ actif: false, etage: 5 })
  })
})
