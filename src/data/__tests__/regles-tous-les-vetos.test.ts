// ============================================================
// GUARDVETO — Règle « tous les vétérinaires » (2026-08-20)
// ============================================================
// Une règle de rythme (fréquence des week-ends, espacement, limite de charge)
// concerne tout le cabinet. Plutôt que de la créer véto par véto — fastidieux,
// et surtout un véto oublié ou embauché plus tard repart SANS la règle, en
// silence — on écrit UNE ligne `qui.type = 'tous'`, dépliée au chargement sur
// l'effectif réel.
//
// Ce fichier fige les trois propriétés qui font la valeur de ce mode :
//   1. le dépliage couvre CHAQUE véto de l'effectif fourni ;
//   2. l'effectif est lu AU CHARGEMENT (un nouveau véto hérite de la règle) ;
//   3. un appelant qui oublie de fournir l'effectif est REJETÉ AVEC UNE RAISON,
//      jamais ignoré en silence — c'est le « ça marche à la génération mais pas
//      au contrôle de cohérence » qu'on refuse de repayer.
// ============================================================

import { describe, it, expect } from 'vitest'
import { mapperReglesCabinet, type RegleCabinetRow } from '../mapReglesCabinet'
import { BRIQUES_IDS } from '@/engine/briques/catalogue'
import { envelopper, OWNER_TOUS, lireOwner, estRegleTous } from '@/lib/regles/paramsRegle'
import { phraseRegle } from '@/lib/regles/libelle'

const BRIQUES_CONNUES = new Set<string>(BRIQUES_IDS)
const CAB = '00000000-0000-0000-0000-0000000000c1'
const ANNE_SO = '00000000-0000-0000-0000-000000000001'
const FANNY = '00000000-0000-0000-0000-000000000002'
const JEAN = '00000000-0000-0000-0000-000000000003'
/** Le véto embauché APRÈS la création de la règle — le cas qui justifie tout. */
const NOUVEAU = '00000000-0000-0000-0000-00000000000f'

/** Ligne telle que l'écrit upsertRegle via `envelopper` — pas une réplique à la main. */
function ligneTous(id: string, brique: string, params: Record<string, unknown>): RegleCabinetRow {
  return {
    id,
    cabinet_id: CAB,
    periode_id: null,
    brique_id: brique,
    params_json: envelopper(OWNER_TOUS, brique as never, null, params),
    force: 'si_possible',
    validite_json: { type: 'permanente', version: 1 },
    version: 1,
    actif: true,
  }
}

describe('règle « tous les vétérinaires »', () => {
  it('l’enveloppe écrite ne fige AUCUNE ref (sinon un nouveau véto serait oublié)', () => {
    const pj = envelopper(OWNER_TOUS, 'espacement_weekend', null, { n_semaines: 3 })
    expect(pj.qui).toEqual({ type: 'tous', refs: [] })
    expect(estRegleTous(pj)).toBe(true)
  })

  it('se déplie sur CHAQUE véto de l’effectif fourni', () => {
    const rows = [ligneTous('r1', 'espacement_weekend', { n_semaines: 3 })]
    const effectif = [ANNE_SO, FANNY, JEAN]

    const { contraintesParVet, rejets } = mapperReglesCabinet(rows, BRIQUES_CONNUES, effectif)

    expect(rejets).toEqual([])
    for (const id of effectif) {
      const c = contraintesParVet.get(id)
      expect(c, `le véto ${id} doit porter la règle`).toHaveLength(1)
      expect(c![0].config.brique).toBe('espacement_weekend')
      expect((c![0].config.params as Record<string, unknown>).n_semaines).toBe(3)
    }
  })

  it('un véto ARRIVÉ APRÈS la création de la règle en hérite sans rien changer', () => {
    // MÊME ligne, jouée deux fois : seul l'effectif a grandi entre-temps.
    // C'est toute la raison d'être du mode « tous » — si ce test casse, on est
    // retombé sur des refs figées à l'écriture et le trou est rouvert.
    const rows = [ligneTous('r1', 'espacement_weekend', { n_semaines: 3 })]

    const avant = mapperReglesCabinet(rows, BRIQUES_CONNUES, [ANNE_SO, FANNY])
    expect(avant.contraintesParVet.has(NOUVEAU)).toBe(false)

    const apres = mapperReglesCabinet(rows, BRIQUES_CONNUES, [ANNE_SO, FANNY, NOUVEAU])
    expect(apres.contraintesParVet.get(NOUVEAU)).toHaveLength(1)
  })

  it('un appelant qui n’a pas fourni l’effectif est rejeté AVEC une raison, pas ignoré', () => {
    const rows = [ligneTous('r1', 'espacement_weekend', { n_semaines: 3 })]

    const { contraintesParVet, rejets } = mapperReglesCabinet(rows, BRIQUES_CONNUES)

    expect(contraintesParVet.size).toBe(0)
    expect(rejets).toHaveLength(1)
    expect(rejets[0].regleId).toBe('r1')
    expect(rejets[0].raison).toContain('effectif')
  })

  it('« tous » est refusé sur un duo interdit (se contredirait sur son partenaire)', () => {
    const rows = [ligneTous('r1', 'duo_interdit', { avec_veterinaire_id: FANNY })]

    const { contraintesParVet, rejets } = mapperReglesCabinet(rows, BRIQUES_CONNUES, [ANNE_SO, FANNY])

    expect(contraintesParVet.size).toBe(0)
    expect(rejets).toHaveLength(1)
    expect(rejets[0].raison).toContain('duo')
  })

  it('les règles nominatives ne sont pas affectées (non-régression)', () => {
    const nominative: RegleCabinetRow = {
      id: 'r2',
      cabinet_id: CAB,
      periode_id: null,
      brique_id: 'espacement_weekend',
      params_json: envelopper(ANNE_SO, 'espacement_weekend', null, { n_semaines: 2 }),
      force: 'si_possible',
      validite_json: { type: 'permanente', version: 1 },
      version: 1,
      actif: true,
    }

    // Même sans effectif fourni : une règle nominative doit continuer à passer.
    const { contraintesParVet, rejets } = mapperReglesCabinet([nominative], BRIQUES_CONNUES)

    expect(rejets).toEqual([])
    expect(contraintesParVet.get(ANNE_SO)).toHaveLength(1)
    expect(contraintesParVet.has(FANNY)).toBe(false)
  })

  it('rouvrir la règle en édition la rend bien comme « tous », pas comme le 1er véto', () => {
    // Sans ce comportement, éditer une règle collective la transformerait
    // silencieusement en règle individuelle à l'enregistrement.
    const pj = envelopper(OWNER_TOUS, 'espacement_weekend', null, { n_semaines: 3 })
    expect(lireOwner(pj)).toBe(OWNER_TOUS)
  })

  it('la phrase affichée nomme le sujet — jamais un prédicat orphelin', () => {
    const regle = ligneTous('r1', 'espacement_weekend', { n_semaines: 3 })
    const phrase = phraseRegle(
      { brique_id: regle.brique_id, params_json: regle.params_json, force: regle.force },
      (id) => (id === ANNE_SO ? 'Anne-Sophie' : id),
    )
    expect(phrase).toContain('Tous les vétérinaires')
    // Le prédicat suit bien le sujet (la règle reste lisible d'un bloc).
    expect(phrase.indexOf('Tous les vétérinaires')).toBe(0)
  })
})
