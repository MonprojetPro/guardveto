import { describe, it, expect } from 'vitest'
import {
  penalite,
  penaliteWEAvantVacances,
  penaliteFeteFinAnnee,
  penaliteInversionFerie,
  PENALITE,
} from '@/engine/rules/soft-constraints'
import { PENALITES_SOUPLES_IDS } from '@/engine/structure-config'
import type { SlotGarde, PlanningPartiel, VetEngine } from '@/engine/types'
import { JEAN, FANNY, VICTOR, MANON } from './scenarios/vets'

const planningVide: PlanningPartiel = { attributions: [] }

function slot(date: string, type: SlotGarde['type'], saison: SlotGarde['saison'] = 'hiver'): SlotGarde {
  return { date, type, saison }
}

// ── R10 : Pas 2 WE consécutifs ───────────────────────────

// ── B-135 (26/09) : R10 « pas 2 week-ends de suite » A ÉTÉ RETIRÉE ───────────
// Six tests vivaient ici, et ils passaient tous. Ils ne sont pas supprimés à la
// légère : la règle elle-même a disparu du produit, sur demande de MiKL, parce
// que `espacement_weekend` et `cadencement_weekend` couvrent le même besoin en
// mieux — réglables, ciblables, et dotés d'un vrai gardien dur.
//
// Ce qui les remplace ci-dessous prouve LE RETRAIT plutôt que l'absence : un
// test supprimé ne dit rien, et si quelqu'un réintroduisait un jour une pénalité
// sur les week-ends consécutifs sans le décider, rien ne le signalerait.

describe('B-135 — deux week-ends de suite ne coûtent plus rien en eux-mêmes', () => {
  it('ne pénalise plus un week-end qui suit immédiatement un autre', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    // Jean était de garde le WE du 2 mai ; celui du 9 mai ne coûte plus rien.
    // C'est désormais à `espacement_weekend` / `cadencement_weekend` de le
    // refuser, si le cabinet le demande — et elles peuvent, elles, refuser.
    expect(penalite(slot('2026-05-09', 'weekend'), JEAN, 'premier', planning)).toBe(0)
  })

  it('ne pénalise pas davantage le vendredi soir du bloc suivant', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    expect(penalite(slot('2026-05-08', 'vendredi_soir'), JEAN, 'premier', planning)).toBe(0)
  })

  it('la famille des pénalités souples n’en compte plus que quatre', () => {
    // Garde-fou de liste : réintroduire `we_consecutif` ici casserait ce test,
    // et obligerait à redécider au lieu de le refaire par inadvertance.
    expect(PENALITES_SOUPLES_IDS).toEqual([
      'we_avant_vacances', 'fete_fin_annee', 'inversion_ferie', 'veille_repos',
    ])
  })
})

// ── R10c : Pas de garde le WE avant des vacances ─────────

describe('R10c — Pas de garde le week-end qui précède des vacances', () => {
  // WE du samedi 9 mai 2026 → semaine suivante = lundi 11 → vendredi 15 mai.
  function vetAvecConge(debut: string, type: VetEngine['conges'][number]['type']): VetEngine {
    return { ...JEAN, conges: [{ date_debut: debut, date_fin: '2026-05-22', type }] }
  }

  it('pénalise si des vacances démarrent le lundi suivant le WE', () => {
    const score = penaliteWEAvantVacances(
      slot('2026-05-09', 'weekend'),
      vetAvecConge('2026-05-11', 'vacances'),
      planningVide
    )
    expect(score).toBe(PENALITE.WE_AVANT_VACANCES)
  })

  it('pénalise aussi le vendredi soir du même bloc week-end', () => {
    const score = penaliteWEAvantVacances(
      slot('2026-05-08', 'vendredi_soir'),
      vetAvecConge('2026-05-11', 'vacances'),
      planningVide
    )
    expect(score).toBe(PENALITE.WE_AVANT_VACANCES)
  })

  it('ne pénalise pas si les vacances sont bien plus tard (semaine non adjacente)', () => {
    const score = penaliteWEAvantVacances(
      slot('2026-05-09', 'weekend'),
      vetAvecConge('2026-05-25', 'vacances'),
      planningVide
    )
    expect(score).toBe(0)
  })

  it('ne pénalise pas si le congé adjacent n\'est pas de type vacances (formation)', () => {
    const score = penaliteWEAvantVacances(
      slot('2026-05-09', 'weekend'),
      vetAvecConge('2026-05-11', 'formation'),
      planningVide
    )
    expect(score).toBe(0)
  })

  it('ne s\'applique pas à un créneau de semaine', () => {
    const score = penaliteWEAvantVacances(
      slot('2026-05-05', 'semaine_soir'),
      vetAvecConge('2026-05-11', 'vacances'),
      planningVide
    )
    expect(score).toBe(0)
  })

  it('ne pénalise pas un véto sans congé', () => {
    const score = penaliteWEAvantVacances(
      slot('2026-05-09', 'weekend'),
      JEAN,
      planningVide
    )
    expect(score).toBe(0)
  })
})

// ── R10b : Fêtes de fin d'année ──────────────────────────

describe('R10b — Pénalité soirs de réveillon (24 déc, 31 déc)', () => {
  it('pénalise le 24 décembre (réveillon Noël)', () => {
    expect(penaliteFeteFinAnnee(slot('2026-12-24', 'semaine_soir'))).toBe(PENALITE.FETE_FIN_ANNEE)
  })

  it('pénalise le 31 décembre (réveillon Jour de l\'An)', () => {
    expect(penaliteFeteFinAnnee(slot('2026-12-31', 'semaine_soir'))).toBe(PENALITE.FETE_FIN_ANNEE)
  })

  it('ne pénalise pas le 25 décembre (férié géré par équité)', () => {
    expect(penaliteFeteFinAnnee(slot('2026-12-25', 'semaine_soir'))).toBe(0)
  })

  it('ne pénalise pas le 1er janvier (férié géré par équité)', () => {
    expect(penaliteFeteFinAnnee(slot('2027-01-01', 'semaine_soir'))).toBe(0)
  })

  it('ne pénalise pas un jour ordinaire de décembre', () => {
    expect(penaliteFeteFinAnnee(slot('2026-12-23', 'semaine_soir'))).toBe(0)
  })

  it('ne s\'applique pas aux créneaux WE', () => {
    expect(penaliteFeteFinAnnee(slot('2026-12-24', 'weekend'))).toBe(0)
    expect(penaliteFeteFinAnnee(slot('2026-12-24', 'vendredi_soir'))).toBe(0)
  })
})

// ── R8b : Inversion 1er/2nd sur fériés ──────────────────

describe('R8b — Inversion rôle sur jours fériés (§7, si possible)', () => {
  // Ascension 2026 = jeudi 14 mai. La garde de veille = mercredi 13 mai.

  it('pénalise si Jean était 1er la veille et est candidat 1er sur férié', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-13', type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    const score = penaliteInversionFerie(
      slot('2026-05-14', 'semaine_soir'), // Ascension
      JEAN, 'premier', planning
    )
    expect(score).toBe(PENALITE.INVERSION_FERIE)
  })

  it('ne pénalise pas si Jean était 1er la veille et est candidat 2nd sur férié', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-13', type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    const score = penaliteInversionFerie(
      slot('2026-05-14', 'semaine_soir'),
      JEAN, 'second', planning
    )
    expect(score).toBe(0)
  })

  it('pénalise si Fanny était 2nd la veille et est candidate 2nd sur férié', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-13', type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: FANNY.id }],
      }],
    }
    const score = penaliteInversionFerie(
      slot('2026-05-14', 'semaine_soir'),
      FANNY, 'second', planning
    )
    expect(score).toBe(PENALITE.INVERSION_FERIE)
  })

  it('retourne 0 si pas de garde la veille', () => {
    const score = penaliteInversionFerie(
      slot('2026-05-14', 'semaine_soir'),
      JEAN, 'premier', planningVide
    )
    expect(score).toBe(0)
  })

  it('ne s\'applique pas sur un jour non férié', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-11', type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    // 12 mai 2026 = mardi ordinaire
    const score = penaliteInversionFerie(
      slot('2026-05-12', 'semaine_soir'),
      JEAN, 'premier', planning
    )
    expect(score).toBe(0)
  })

  it('ne s\'applique pas aux créneaux WE', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-13', type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    const score = penaliteInversionFerie(
      slot('2026-05-14', 'weekend'),
      JEAN, 'premier', planning
    )
    expect(score).toBe(0)
  })

  it('fonctionne aussi sur Lundi de Pâques 2026 (6 avril)', () => {
    // Veille = dimanche 5 avril — mais le dimanche n'a pas de garde (couvert par WE)
    // Donc attrVeille = undefined → pénalité = 0
    const score = penaliteInversionFerie(
      slot('2026-04-06', 'semaine_soir'),
      JEAN, 'premier', planningVide
    )
    expect(score).toBe(0) // pas de garde le dimanche → pas de pénalité
  })
})

// ── penalite() — point d'entrée ──────────────────────────

describe('penalite() — agrégation', () => {
  it('retourne 0 sur planning vide', () => {
    expect(penalite(slot('2026-05-09', 'weekend'), JEAN, 'premier', planningVide)).toBe(0)
  })

  // B-135 — ce test attendait `PENALITE.WE_CONSECUTIF`. La règle a été retirée :
  // deux week-ends de suite ne coûtent plus rien au niveau du cumul non plus.
  it('ne facture plus rien pour deux week-ends de suite', () => {
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-05-02', type: 'weekend',
        placements: [{ role: 'premier', vetId: MANON.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    expect(penalite(slot('2026-05-09', 'weekend'), MANON, 'premier', planning)).toBe(0)
  })

  it('retourne 0 pour un créneau semaine ordinaire', () => {
    expect(penalite(slot('2026-05-04', 'semaine_soir'), JEAN, 'premier', planningVide)).toBe(0)
  })

  it('cumule R10b + R8b si applicable le même soir', () => {
    // 24 déc 2026 = jeudi — et Jean était 1er la veille (23 déc)
    // → pénalité R10b (réveillon) + R8b (inversion) si c'est un férié
    // Note: 24 déc n'est PAS un férié officiel → R8b ne s'applique pas
    // → seulement R10b
    const planning: PlanningPartiel = {
      attributions: [{
        date: '2026-12-23', type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: JEAN.id }, { role: 'second', vetId: VICTOR.id }],
      }],
    }
    const score = penalite(slot('2026-12-24', 'semaine_soir'), JEAN, 'premier', planning)
    // R10b = 30, R8b = 0 (24 déc n'est pas férié), R10 WE = 0
    expect(score).toBe(PENALITE.FETE_FIN_ANNEE)
  })
})
