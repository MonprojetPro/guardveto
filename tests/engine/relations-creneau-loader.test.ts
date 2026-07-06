// ============================================================
// GUARDVETO — RG1 tranche 1 : chargerRelationsCreneau PROFIL-AWARE
// ============================================================
// Prouve, par FAITS DIRECTS, que le loader des relations entre créneaux
// (ex R8/R9 en donnée — verrou n°4 du doc 09) :
//
//   1. filtre par cabinet ET par PROFIL (même résolution que le catalogue :
//      profil demandé, sinon profil défaut) — sans ce filtre, un cabinet
//      multi-profils mélangerait les relations de tous ses profils ;
//   2. mappe fidèlement les rows SQL → RelationCreneau (camelCase) ;
//   3. reste best-effort : pas de cabinet / pas de profil défaut / erreur
//      DB → [] (jamais de throw), comme chargerCreneauModele.
//
// ⚠️ Tranche 1 : les relations sont CHARGÉES mais pas encore consommées par
// le moteur (branchement hard-constraints/scoring/solver/validateur = T2).
// ============================================================

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { chargerRelationsCreneau } from '@/data/chargerCreneauModele'

// ── Mock supabase : query-builder chaînable qui ENREGISTRE les .eq() ──

interface EqCall { col: string; val: unknown }

function makeSupabase(opts: {
  profilDefaut?: string | null
  relations?: Array<Record<string, unknown>>
  relationsError?: boolean
  onEq?: (table: string, calls: EqCall[]) => void
}): SupabaseClient {
  const from = (table: string) => {
    const eqCalls: EqCall[] = []
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (col: string, val: unknown) => {
      eqCalls.push({ col, val })
      opts.onEq?.(table, eqCalls)
      return b
    }
    b.order = () => b
    b.maybeSingle = () =>
      Promise.resolve({
        data: opts.profilDefaut ? { id: opts.profilDefaut } : null,
        error: null,
      })
    // Thenable : `await ...eq(...)` sans terminateur (requête relations).
    b.then = (r: (v: { data: unknown; error: unknown }) => unknown) =>
      r(
        opts.relationsError
          ? { data: null, error: { message: 'boom' } }
          : { data: opts.relations ?? [], error: null },
      )
    return b
  }
  return { from } as unknown as SupabaseClient
}

const ROW = {
  id: 'rel-1',
  source_id: 'cren-vendredi',
  cible_id: 'cren-weekend',
  genre: 'meme_binome',
  actif: true,
}

describe('chargerRelationsCreneau — profil-aware (RG1)', () => {
  it('filtre par cabinet ET par le profil DEMANDÉ (pas de résolution défaut)', async () => {
    const eqParTable: Record<string, EqCall[]> = {}
    const sb = makeSupabase({
      relations: [ROW],
      onEq: (t, calls) => { eqParTable[t] = [...calls] },
    })

    const rels = await chargerRelationsCreneau(sb, 'cab-1', 'profil-ete')

    expect(eqParTable['relation_creneau']).toEqual([
      { col: 'cabinet_id', val: 'cab-1' },
      { col: 'profil_id', val: 'profil-ete' },
    ])
    // Profil explicite → profils_planning jamais interrogée.
    expect(eqParTable['profils_planning']).toBeUndefined()
    expect(rels).toHaveLength(1)
  })

  it('sans profil demandé → résout le profil DÉFAUT (même source unique que le catalogue)', async () => {
    const eqParTable: Record<string, EqCall[]> = {}
    const sb = makeSupabase({
      profilDefaut: 'profil-defaut',
      relations: [ROW],
      onEq: (t, calls) => { eqParTable[t] = [...calls] },
    })

    const rels = await chargerRelationsCreneau(sb, 'cab-1')

    expect(eqParTable['relation_creneau']).toContainEqual({
      col: 'profil_id',
      val: 'profil-defaut',
    })
    expect(rels).toHaveLength(1)
  })

  it('mappe fidèlement les rows SQL → RelationCreneau (camelCase)', async () => {
    const sb = makeSupabase({ profilDefaut: 'p1', relations: [ROW] })
    const rels = await chargerRelationsCreneau(sb, 'cab-1')
    expect(rels[0]).toEqual({
      id: 'rel-1',
      sourceId: 'cren-vendredi',
      cibleId: 'cren-weekend',
      genre: 'meme_binome',
      actif: true,
    })
  })

  it('best-effort : sans cabinetId → []', async () => {
    const sb = makeSupabase({ profilDefaut: 'p1', relations: [ROW] })
    expect(await chargerRelationsCreneau(sb, undefined)).toEqual([])
  })

  it('best-effort : cabinet sans profil défaut → [] (cas théorique, repli legacy)', async () => {
    const sb = makeSupabase({ profilDefaut: null, relations: [ROW] })
    expect(await chargerRelationsCreneau(sb, 'cab-1')).toEqual([])
  })

  it('best-effort : erreur DB → [] (jamais de throw)', async () => {
    const sb = makeSupabase({ profilDefaut: 'p1', relationsError: true })
    expect(await chargerRelationsCreneau(sb, 'cab-1')).toEqual([])
  })
})
