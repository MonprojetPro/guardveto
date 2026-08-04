// ============================================================
// GUARDVETO — chargerRelationsCreneau : les liaisons vivent sur le SOCLE
// ============================================================
// ⚠️ CE TEST A CHANGÉ DE CONTRAT LE 2026-08-04.
//
// Il prouvait que les liaisons entre créneaux étaient filtrées PAR PÉRIODE
// TYPE : chacune avait sa copie, comme elle avait sa copie des créneaux. Depuis
// que la structure est un socle unique du cabinet affiné par période type
// (MiKL : « la structure donne l'ensemble des possibilités, les périodes types
// les affinent »), les liaisons appartiennent au socle : elles décrivent la
// structure — « le vendredi et le week-end, même binôme » — pas une saison.
//
// Ce que le loader doit garantir MAINTENANT :
//   1. il lit les liaisons du SOCLE (`profil_id IS NULL`), jamais celles d'une
//      période type ;
//   2. il RETIRE celles dont un bout n'existe pas sur la période type visée
//      (un créneau réglé à 0 véto) — sinon le moteur raisonnerait sur une
//      garde qu'il ne posera jamais ;
//   3. il reste best-effort : erreur DB → [], jamais de throw.
// ============================================================

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { chargerRelationsCreneau } from '@/data/chargerCreneauModele'

interface FiltreCall { methode: 'eq' | 'is'; col: string; val: unknown }

function makeSupabase(opts: {
  profilDefaut?: string | null
  relations?: Array<Record<string, unknown>>
  relationsError?: boolean
  /** Affinage de la période type visée : creneau_id → nb_vetos. */
  affinage?: Array<{ creneau_id: string; nb_vetos: number }>
  onFiltre?: (table: string, calls: FiltreCall[]) => void
}): SupabaseClient {
  const from = (table: string) => {
    const calls: FiltreCall[] = []
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.eq = (col: string, val: unknown) => {
      calls.push({ methode: 'eq', col, val })
      opts.onFiltre?.(table, calls)
      return b
    }
    b.is = (col: string, val: unknown) => {
      calls.push({ methode: 'is', col, val })
      opts.onFiltre?.(table, calls)
      return b
    }
    b.order = () => b
    b.maybeSingle = () =>
      Promise.resolve({
        data: opts.profilDefaut ? { id: opts.profilDefaut } : null,
        error: null,
      })
    b.then = (r: (v: { data: unknown; error: unknown }) => unknown) => {
      if (table === 'periode_type_creneau') {
        return r({ data: opts.affinage ?? [], error: null })
      }
      return r(
        opts.relationsError
          ? { data: null, error: { message: 'boom' } }
          : { data: opts.relations ?? [], error: null },
      )
    }
    return b
  }
  return { from } as unknown as SupabaseClient
}

const VEN_WE = {
  id: 'rel-1',
  source_id: 'cren-vendredi',
  cible_id: 'cren-weekend',
  genre: 'meme_binome',
  actif: true,
}
const WE_SEM = {
  id: 'rel-2',
  source_id: 'cren-weekend',
  cible_id: 'cren-semaine',
  genre: 'meme_binome',
  actif: true,
}

describe('Les liaisons se lisent sur le socle', () => {
  it('filtre par cabinet ET sur `profil_id IS NULL` — jamais sur une période type', async () => {
    const parTable: Record<string, FiltreCall[]> = {}
    const sb = makeSupabase({
      profilDefaut: 'p1',
      relations: [VEN_WE],
      onFiltre: (t, calls) => { parTable[t] = [...calls] },
    })

    const rels = await chargerRelationsCreneau(sb, 'cab-1', 'profil-ete')

    expect(parTable['relation_creneau']).toEqual([
      { methode: 'eq', col: 'cabinet_id', val: 'cab-1' },
      { methode: 'is', col: 'profil_id', val: null },
    ])
    expect(rels).toHaveLength(1)
  })

  it('mappe fidèlement les rows SQL → RelationCreneau (camelCase)', async () => {
    const sb = makeSupabase({ profilDefaut: 'p1', relations: [VEN_WE] })
    const rels = await chargerRelationsCreneau(sb, 'cab-1')
    expect(rels[0]).toEqual({
      id: 'rel-1',
      sourceId: 'cren-vendredi',
      cibleId: 'cren-weekend',
      genre: 'meme_binome',
      actif: true,
    })
  })
})

describe('Une garde retirée emporte ses liaisons', () => {
  it('la liaison disparaît quand sa SOURCE est réglée à 0 véto', async () => {
    // « L'été, pas de garde le vendredi soir » : la liaison vendredi↔week-end
    // n'a plus d'objet. La garder ferait raisonner le moteur sur un créneau
    // qu'il ne posera jamais.
    const sb = makeSupabase({
      profilDefaut: 'p1',
      relations: [VEN_WE, WE_SEM],
      affinage: [{ creneau_id: 'cren-vendredi', nb_vetos: 0 }],
    })
    const rels = await chargerRelationsCreneau(sb, 'cab-1', 'ete')
    expect(rels.map((r) => r.id)).toEqual(['rel-2'])
  })

  it('la liaison disparaît aussi quand c’est sa CIBLE qui est retirée', async () => {
    const sb = makeSupabase({
      profilDefaut: 'p1',
      relations: [VEN_WE, WE_SEM],
      affinage: [{ creneau_id: 'cren-semaine', nb_vetos: 0 }],
    })
    const rels = await chargerRelationsCreneau(sb, 'cab-1', 'ete')
    expect(rels.map((r) => r.id)).toEqual(['rel-1'])
  })

  it('un créneau simplement RÉDUIT ne supprime aucune liaison', async () => {
    // 1 véto au lieu de 2, la garde existe toujours : la liaison reste.
    const sb = makeSupabase({
      profilDefaut: 'p1',
      relations: [VEN_WE, WE_SEM],
      affinage: [{ creneau_id: 'cren-vendredi', nb_vetos: 1 }],
    })
    const rels = await chargerRelationsCreneau(sb, 'cab-1', 'ete')
    expect(rels).toHaveLength(2)
  })
})

describe('Best-effort — le chargement ne fait jamais tomber la génération', () => {
  it('sans cabinetId → []', async () => {
    const sb = makeSupabase({ profilDefaut: 'p1', relations: [VEN_WE] })
    expect(await chargerRelationsCreneau(sb, undefined)).toEqual([])
  })

  it('erreur DB → [] (jamais de throw)', async () => {
    const sb = makeSupabase({ profilDefaut: 'p1', relationsError: true })
    expect(await chargerRelationsCreneau(sb, 'cab-1')).toEqual([])
  })

  it('cabinet sans période type résolue → les liaisons du socle, telles quelles', async () => {
    // Cas des plannings d'avant la règle du 2026-08-04 : rien à affiner, donc
    // rien à retirer. Le socle s'applique tel quel — et surtout pas « [] »,
    // qui priverait le moteur de liaisons pourtant définies.
    const sb = makeSupabase({ profilDefaut: null, relations: [VEN_WE] })
    expect(await chargerRelationsCreneau(sb, 'cab-1')).toHaveLength(1)
  })
})
