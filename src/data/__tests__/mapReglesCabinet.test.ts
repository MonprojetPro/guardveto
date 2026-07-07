// ============================================================
// GUARDVETO — Test d'équivalence du mapping regles_cabinet (P1A-004)
// ============================================================
// Gate du mapper (approche A) : prouve que lire les règles depuis
// `regles_cabinet` reproduit EXACTEMENT les contraintes moteur que le
// loader fournissait depuis `contraintes_veto` (snapshot pilote fidèle :
// fixtures-pilote.ts). C'est le filet de non-régression « cœur produit »
// au niveau de la couche data ; le golden test (golden-pilote.test.ts)
// vérifie ensuite que le PLANNING reste identique.
//
// Méthode : on rejoue la migration P1A-003 en sens AVANT (ContrainteEngine
// → ligne regles_cabinet) puis on remappe en ARRIÈRE (le code testé) et on
// compare au snapshot. Round-trip ⇒ équivalence.
// ============================================================

import { describe, it, expect } from 'vitest'
import { mapperReglesCabinet, type RegleCabinetRow } from '../mapReglesCabinet'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { isValid } from '@/engine/rules/hard-constraints'
import type { ContrainteEngine, VetEngine, SlotGarde, PlanningPartiel } from '@/engine/types'
import { VETS_PILOTE, VET } from '@/engine/__tests__/fixtures-pilote'

const CABINET_PILOTE = '00000000-0000-0000-0000-0000000000c1'

// Catalogue : les 10 briques seedées en P1A-001 (briques connues).
const BRIQUES_CONNUES = new Set<string>([
  'interdire_creneau', 'repos_conditionnel', 'duo_interdit', 'liaison_creneaux',
  'inversion_role', 'alternance_ancre', 'equilibrer', 'au_plus_n',
  'espacement_min', 'motif_grand_weekend',
])

// étage entier → force texte (sens de la migration P1A-003).
const ETAGE_VERS_FORCE_TEXTE: Record<number, string> = {
  0: 'invariant', 1: 'reglementaire', 2: 'jamais',
  3: 'sauf_crise', 4: 'evitee', 5: 'si_possible',
}

/**
 * Rejoue la migration EN AVANT : ContrainteEngine (forme loader V1) →
 * ligne `regles_cabinet`, à l'identique du SQL P1A-003.
 */
function versRegleRow(c: ContrainteEngine, proprietaireId: string): RegleCabinetRow {
  const cfg = c.config as {
    axes?: { quand?: unknown }
    force: number
    brique: string
    params: Record<string, unknown>
  }
  const estDuo = c.type === 'duo_interdit'
  const partenaire = cfg.params.avec_veterinaire_id as string | undefined
  const refs = estDuo && partenaire ? [proprietaireId, partenaire] : [proprietaireId]

  return {
    id: c.id,
    cabinet_id: CABINET_PILOTE,
    periode_id: null,
    brique_id: cfg.brique,
    params_json: {
      qui: { type: estDuo ? 'duo' : 'individu', refs },
      quand: cfg.axes?.quand ?? null,
      params: cfg.params,
      _source: { contrainte_id: c.id, type_v1: c.type },
    },
    force: ETAGE_VERS_FORCE_TEXTE[cfg.force],
    validite_json: { type: 'permanente', version: 1 },
    version: 1,
    actif: c.actif,
  }
}

/** Empreinte comparable d'une contrainte (axes {} ≡ {quand:null} : inerte). */
function empreinte(c: ContrainteEngine) {
  const cfg = c.config as { axes?: { quand?: unknown }; force: number; brique: string; params: unknown }
  return {
    id: c.id,
    type: c.type,
    brique: cfg.brique,
    force: cfg.force,
    quand: cfg.axes?.quand ?? null,
    params: cfg.params,
    actif: c.actif,
  }
}

describe('mapperReglesCabinet — équivalence avec le snapshot pilote', () => {
  // Toutes les règles du pilote, forme regles_cabinet.
  const reglesRows: RegleCabinetRow[] = VETS_PILOTE.flatMap((vet) =>
    vet.contraintes.map((c) => versRegleRow(c, vet.id)),
  )

  it('reproduit les contraintes de CHAQUE véto à l’identique (id, type, brique, force, params, actif, quand)', () => {
    const { contraintesParVet, rejets } = mapperReglesCabinet(reglesRows, BRIQUES_CONNUES)

    expect(rejets).toEqual([]) // aucune règle pilote écartée

    for (const vet of VETS_PILOTE) {
      const attendu = vet.contraintes.map(empreinte)
      const obtenu = (contraintesParVet.get(vet.id) ?? []).map(empreinte)
      expect(obtenu, `contraintes de ${vet.prenom}`).toEqual(attendu)
    }
  })

  it('couvre exactement les 10 contraintes du pilote, sans perte ni doublon', () => {
    const { contraintesParVet } = mapperReglesCabinet(reglesRows, BRIQUES_CONNUES)
    const total = [...contraintesParVet.values()].reduce((n, l) => n + l.length, 0)
    expect(total).toBe(10)
    expect(reglesRows).toHaveLength(10)
  })

  it('range le duo interdit chez son propriétaire (1re réf), partenaire préservé dans params', () => {
    const { contraintesParVet } = mapperReglesCabinet(reglesRows, BRIQUES_CONNUES)
    const duoAntoine = (contraintesParVet.get(VET.antoine) ?? []).find((c) => c.type === 'duo_interdit')
    expect(duoAntoine).toBeDefined()
    expect((duoAntoine!.config.params as Record<string, unknown>).avec_veterinaire_id).toBe(VET.manon)
  })

  it('trie chaque véto par (étage, brique, id) — tri stable E3', () => {
    const { contraintesParVet } = mapperReglesCabinet(reglesRows, BRIQUES_CONNUES)
    // Anne-Sophie a 2 contraintes au même étage (2, dur depuis P1-B) → départage
    // par brique_id : 'alternance_ancre' avant 'interdire_creneau'.
    const cs = contraintesParVet.get(VET.anneSophie) ?? []
    expect(cs.map((c) => c.config.brique)).toEqual(['alternance_ancre', 'interdire_creneau'])
    expect(cs.map((c) => c.config.force)).toEqual([2, 2])
  })
})

// ── Multi-propriétaires (backlog n°18) ──────────────────────
// Une règle « pour Manon ET Antoine » (qui.refs = [manon, antoine]) était
// TRONQUÉE en silence : seul refs[0] la recevait. Correction : DÉPLIAGE en une
// instance par réf — la règle s'applique à CHAQUE propriétaire (moteur ET
// validateur consomment le même mapping). Exception : duo_interdit, où refs[1]
// est le PARTENAIRE (pas un co-propriétaire) — refs[0] seul, comme avant.
describe('mapperReglesCabinet — multi-propriétaires (n°18, plus de troncature)', () => {
  const multiRow = (refs: string[], over: Partial<RegleCabinetRow> = {}): RegleCabinetRow => ({
    id: 'multi-1', cabinet_id: CABINET_PILOTE, periode_id: null,
    brique_id: 'interdire_creneau', force: 'jamais', actif: true,
    params_json: {
      qui: { type: 'individu', refs },
      quand: null, params: { jour: 'lundi' },
      _source: { contrainte_id: 'multi-1', type_v1: 'jour_repos_fixe' },
    },
    ...over,
  })

  it('refs = [Manon, Antoine] → la contrainte existe chez LES DEUX (empreintes identiques)', () => {
    const { contraintesParVet, rejets } = mapperReglesCabinet(
      [multiRow([VET.manon, VET.antoine])], BRIQUES_CONNUES,
    )
    expect(rejets).toEqual([])
    const chezManon = contraintesParVet.get(VET.manon) ?? []
    const chezAntoine = contraintesParVet.get(VET.antoine) ?? []
    expect(chezManon).toHaveLength(1)
    expect(chezAntoine).toHaveLength(1)
    expect(empreinte(chezManon[0])).toEqual(empreinte(chezAntoine[0]))
    // Instances distinctes (pas de partage de référence entre vétos).
    expect(chezManon[0]).not.toBe(chezAntoine[0])
  })

  it('réfs en double → dédupliquées (une seule instance par véto)', () => {
    const { contraintesParVet } = mapperReglesCabinet(
      [multiRow([VET.manon, VET.manon, VET.antoine])], BRIQUES_CONNUES,
    )
    expect(contraintesParVet.get(VET.manon)).toHaveLength(1)
    expect(contraintesParVet.get(VET.antoine)).toHaveLength(1)
  })

  it('duo_interdit : refs[1] reste le PARTENAIRE (pas de dépliage — comme avant)', () => {
    const duo = multiRow([VET.antoine, VET.manon], {
      id: 'duo-x', brique_id: 'duo_interdit',
      params_json: {
        qui: { type: 'duo', refs: [VET.antoine, VET.manon] },
        quand: null, params: { avec_veterinaire_id: VET.manon },
        _source: { contrainte_id: 'duo-x', type_v1: 'duo_interdit' },
      },
    })
    const { contraintesParVet } = mapperReglesCabinet([duo], BRIQUES_CONNUES)
    expect(contraintesParVet.get(VET.antoine)).toHaveLength(1)
    // Manon ne reçoit PAS l'instance (la symétrie vient de la ligne miroir).
    expect(contraintesParVet.get(VET.manon) ?? []).toHaveLength(0)
  })

  it('FAIT DIRECT moteur : la règle dépliée BLOQUE chacun des deux vétos', () => {
    const { contraintesParVet } = mapperReglesCabinet(
      [multiRow([VET.manon, VET.antoine])], BRIQUES_CONNUES,
    )
    const brut = (id: string, prenom: string): VetEngine => ({
      id, prenom, nom: 'X', statut: 'associe', dernier_recours: false,
      conges: [], contraintes: contraintesParVet.get(id) ?? [],
    } as VetEngine)
    const vets = normaliserContraintesVets([
      brut(VET.manon, 'Manon'), brut(VET.antoine, 'Antoine'),
    ])
    // 2026-01-05 est un LUNDI — la règle « jamais de garde le lundi » (dure).
    const slotLundi: SlotGarde = { date: '2026-01-05', type: 'semaine_soir', saison: 'hiver', besoinSecond: false }
    const vide: PlanningPartiel = { attributions: [] }
    for (const v of vets) {
      const r = isValid(slotLundi, v, 'premier', vets, vide)
      expect(r.valid, `le lundi doit être bloqué pour ${v.prenom}`).toBe(false)
    }
  })
})

describe('mapperReglesCabinet — validation déterministe (règles corrompues écartées)', () => {
  const base: RegleCabinetRow = {
    id: 'ok-1', cabinet_id: CABINET_PILOTE, periode_id: null,
    brique_id: 'duo_interdit', force: 'jamais', actif: true,
    params_json: {
      qui: { type: 'duo', refs: [VET.antoine, VET.manon] },
      quand: null, params: { avec_veterinaire_id: VET.manon },
      _source: { contrainte_id: 'ok-1', type_v1: 'duo_interdit' },
    },
  }

  it('écarte (sans crash) une règle à la brique inconnue', () => {
    const corrompue: RegleCabinetRow = { ...base, id: 'bad-brique', brique_id: 'brique_fantome' }
    const { contraintesParVet, rejets } = mapperReglesCabinet([base, corrompue], BRIQUES_CONNUES)
    expect(rejets.map((r) => r.regleId)).toEqual(['bad-brique'])
    expect([...contraintesParVet.values()].flat().map((c) => c.id)).toEqual(['ok-1'])
  })

  it('écarte une règle au params_json absent (non-objet)', () => {
    const corrompue: RegleCabinetRow = { ...base, id: 'bad-params', params_json: null }
    const { rejets } = mapperReglesCabinet([corrompue], BRIQUES_CONNUES)
    expect(rejets).toHaveLength(1)
    expect(rejets[0].regleId).toBe('bad-params')
  })

  it('écarte une règle sans propriétaire identifiable (qui.refs vide)', () => {
    const corrompue: RegleCabinetRow = {
      ...base, id: 'bad-qui',
      params_json: { qui: { type: 'individu', refs: [] }, params: {}, _source: { type_v1: 'duo_interdit' } },
    }
    const { rejets } = mapperReglesCabinet([corrompue], BRIQUES_CONNUES)
    expect(rejets[0]?.regleId).toBe('bad-qui')
  })

  it('écarte une règle à la force invalide', () => {
    const corrompue: RegleCabinetRow = { ...base, id: 'bad-force', force: 'tres_fort' }
    const { rejets } = mapperReglesCabinet([corrompue], BRIQUES_CONNUES)
    expect(rejets[0]?.regleId).toBe('bad-force')
  })

  it('écarte une règle multi-refs dont AUCUNE réf n’est une chaîne', () => {
    const corrompue: RegleCabinetRow = {
      ...base, id: 'bad-refs-types',
      params_json: { qui: { type: 'individu', refs: [42, null] }, params: {}, _source: { type_v1: 'jour_repos_fixe' } },
    }
    const { rejets } = mapperReglesCabinet([corrompue], BRIQUES_CONNUES)
    expect(rejets[0]?.regleId).toBe('bad-refs-types')
  })

  it('écarte une brique INTERNE même avec un type_v1 valide (anti-coquille-vide)', () => {
    const interne: RegleCabinetRow = {
      ...base,
      id: 'interne-1',
      brique_id: 'motif_grand_weekend',
      // tentative de contournement : un type_v1 valide qui la ferait passer.
      params_json: {
        qui: { type: 'individu', refs: [VET.manon] },
        params: { jour: 'jeudi' },
        _source: { type_v1: 'jour_repos_fixe' },
      },
    }
    const { contraintesParVet, rejets } = mapperReglesCabinet([interne], BRIQUES_CONNUES)
    expect(rejets[0]?.regleId).toBe('interne-1')
    expect([...contraintesParVet.values()].flat()).toHaveLength(0)
  })
})
