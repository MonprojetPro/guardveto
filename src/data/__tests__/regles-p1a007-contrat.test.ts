// ============================================================
// GUARDVETO — Contrat P1A-007 : une règle créée par le formulaire EST appliquée
// ============================================================
// Le formulaire guidé (RegleFormDialog) envoie des champs simples ; le server
// action upsertRegle reconstruit un params_json d'enveloppe. Ce test fige cette
// ENVELOPPE et prouve que mapperReglesCabinet (donc le moteur) l'accepte sans
// rejet, pour les 4 briques évaluables. Garde anti-coquille-vide : si l'enveloppe
// dérive un jour, le moteur recommencerait à ignorer les règles → ce test casse.
// ============================================================

import { describe, it, expect } from 'vitest'
import { mapperReglesCabinet, type RegleCabinetRow } from '../mapReglesCabinet'
import { BRIQUES_IDS } from '@/engine/briques/catalogue'

const BRIQUES_CONNUES = new Set<string>(BRIQUES_IDS)
const CAB = '00000000-0000-0000-0000-0000000000c1'
const OWNER = '00000000-0000-0000-0000-000000000001'
const PARTNER = '00000000-0000-0000-0000-000000000002'

/** Réplique EXACTE de l'enveloppe produite par upsertRegle (frontière serveur). */
function enveloppe(
  id: string,
  brique_id: string,
  force: string,
  owner: string,
  quand: unknown,
  params: Record<string, unknown>,
  type_v1: string,
): RegleCabinetRow {
  return {
    id,
    cabinet_id: CAB,
    periode_id: null,
    brique_id,
    params_json: {
      qui: { type: 'veterinaire', refs: [owner] },
      quand: quand ?? null,
      params,
      _source: { type_v1 },
    },
    force,
    validite_json: { type: 'permanente', version: 1 },
    version: 1,
    actif: true,
  }
}

describe('P1A-007 — contrat formulaire → moteur', () => {
  it('les 4 briques évaluables sont mappées sans aucun rejet', () => {
    const rows: RegleCabinetRow[] = [
      enveloppe('r1', 'interdire_creneau', 'evitee', OWNER, 'mercredi',
        { jour: 'mercredi', exception_vacances_scolaires: true }, 'jour_repos_fixe'),
      enveloppe('r2', 'repos_conditionnel', 'sauf_crise', OWNER, null,
        { si_garde_we: 'jeudi', sinon: 'vendredi' }, 'jour_repos_conditionnel'),
      enveloppe('r3', 'alternance_ancre', 'sauf_crise', OWNER, 'weekend',
        { semaines: 'impaires', periodes: ['soir_semaine', 'weekend'] }, 'indisponibilite_cyclique'),
      // duo symétrique (les deux sens, comme l'écrit upsertRegle)
      enveloppe('r4a', 'duo_interdit', 'jamais', OWNER, null,
        { avec_veterinaire_id: PARTNER }, 'duo_interdit'),
      enveloppe('r4b', 'duo_interdit', 'jamais', PARTNER, null,
        { avec_veterinaire_id: OWNER }, 'duo_interdit'),
    ]

    const { contraintesParVet, rejets } = mapperReglesCabinet(rows, BRIQUES_CONNUES)

    expect(rejets).toEqual([])

    const duOwner = contraintesParVet.get(OWNER) ?? []
    const types = duOwner.map((c) => c.type).sort()
    expect(types).toEqual(
      ['duo_interdit', 'indisponibilite_cyclique', 'jour_repos_conditionnel', 'jour_repos_fixe'].sort(),
    )

    // Les params métier sont préservés intacts (le moteur les lit après normalisation).
    const repos = duOwner.find((c) => c.type === 'jour_repos_fixe')
    expect((repos?.config.params as Record<string, unknown>).jour).toBe('mercredi')

    const cyclique = duOwner.find((c) => c.type === 'indisponibilite_cyclique')
    expect((cyclique?.config.params as Record<string, unknown>).periodes).toEqual(['soir_semaine', 'weekend'])

    // Le miroir du duo existe bien côté partenaire (symétrie R6).
    const duPartner = contraintesParVet.get(PARTNER) ?? []
    expect(duPartner.some((c) => c.type === 'duo_interdit')).toBe(true)
  })

  it('les briques de charge (au_plus_n, espacement_min) sont mappées sans rejet', () => {
    const rows: RegleCabinetRow[] = [
      enveloppe('r5', 'au_plus_n', 'sauf_crise', OWNER, null,
        { n: 2, fenetre: 'semaine_civile' }, 'au_plus_n'),
      enveloppe('r6', 'espacement_min', 'sauf_crise', OWNER, null,
        { ecart_min_jours: 3 }, 'espacement_min'),
    ]

    const { contraintesParVet, rejets } = mapperReglesCabinet(rows, BRIQUES_CONNUES)

    expect(rejets).toEqual([])

    const duOwner = contraintesParVet.get(OWNER) ?? []
    expect(duOwner.map((c) => c.type).sort()).toEqual(['au_plus_n', 'espacement_min'])

    // Les params de charge sont préservés (le moteur les lit après normalisation).
    const charge = duOwner.find((c) => c.type === 'au_plus_n')
    expect((charge?.config.params as Record<string, unknown>).n).toBe(2)
    expect((charge?.config.params as Record<string, unknown>).fenetre).toBe('semaine_civile')

    const espacement = duOwner.find((c) => c.type === 'espacement_min')
    expect((espacement?.config.params as Record<string, unknown>).ecart_min_jours).toBe(3)
  })

  it('exclusion_dates (XOR « pas les deux ») est mappée sans rejet, les deux formes', () => {
    const rows: RegleCabinetRow[] = [
      enveloppe('r7', 'exclusion_dates', 'sauf_crise', OWNER, null,
        { fetes: ['noel', 'nouvel_an'] }, 'exclusion_dates'),
      enveloppe('r8', 'exclusion_dates', 'jamais', OWNER, null,
        { dates: ['2026-07-14', '2026-08-15'] }, 'exclusion_dates'),
    ]

    const { contraintesParVet, rejets } = mapperReglesCabinet(rows, BRIQUES_CONNUES)

    expect(rejets).toEqual([])

    const duOwner = contraintesParVet.get(OWNER) ?? []
    const exclusions = duOwner.filter((c) => c.type === 'exclusion_dates')
    expect(exclusions).toHaveLength(2)

    // Les params (fêtes / dates) sont préservés intacts.
    const formeFetes = exclusions.find((c) => (c.config.params as Record<string, unknown>).fetes)
    expect((formeFetes?.config.params as Record<string, unknown>).fetes).toEqual(['noel', 'nouvel_an'])
    const formeDates = exclusions.find((c) => (c.config.params as Record<string, unknown>).dates)
    expect((formeDates?.config.params as Record<string, unknown>).dates).toEqual(['2026-07-14', '2026-08-15'])
  })
})
