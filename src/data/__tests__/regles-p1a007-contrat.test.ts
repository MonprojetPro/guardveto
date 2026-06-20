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
})
