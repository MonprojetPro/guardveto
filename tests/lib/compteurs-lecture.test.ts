// ============================================================
// GUARDVETO — Les compteurs disent-ils la vérité ?
// ============================================================
// Ces tests gardent DEUX propriétés de l'écran « Historique & compteurs »,
// toutes deux violées avant le 2026-08-14 et toutes deux invisibles à l'œil :
//
//  ① Une erreur de lecture ne devient JAMAIS « zéro garde ». Elle remonte
//    dans `erreur`, et l'écran doit dire « je ne sais pas » plutôt que
//    d'afficher un tableau à zéro parfaitement crédible.
//
//  ② Une plage de dates large n'est pas coupée à 1000 lignes. PostgREST
//    plafonne silencieusement : au-delà, les compteurs seraient simplement
//    faux, sans le moindre message. Une période de 17 semaines pèse déjà
//    ~120 gardes — le cumul inter-périodes franchit le seuil vers la
//    huitième période.
//
// La fausse base ci-dessous n'imite que ce que `queryCompteursPlage` utilise
// vraiment de PostgREST : le chaînage fluide, `.range()`, et la forme
// `{ data, error }`.
// ============================================================

import { describe, it, expect } from 'vitest'
import { queryCompteursPlage, queryCompteurs, queryTotalWE } from '@/hooks/useCompteurs'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Une fausse base, aussi bête que possible ───────────────────────────────

type Ligne = Record<string, unknown>

interface Faux {
  /** Lignes servies par table. */
  tables: Record<string, Ligne[]>
  /** Erreur à renvoyer pour une table donnée, au lieu de ses lignes. */
  erreurs?: Record<string, string>
  /** Nombre d'allers-retours réellement effectués sur `gardes`. */
  appelsGardes?: number
}

function fausseBase(f: Faux): SupabaseClient {
  const client = {
    from(table: string) {
      let de = 0
      let a = 999
      const req = {
        // Tous les filtres se comportent en pass-through : ce n'est pas eux
        // qu'on teste ici, c'est la pagination et la remontée d'erreur.
        select: () => req,
        eq: () => req,
        gte: () => req,
        lte: () => req,
        order: () => req,
        range: (d: number, b: number) => {
          de = d
          a = b
          return req
        },
        then(resoudre: (v: { data: Ligne[] | null; error: { message: string } | null }) => unknown) {
          if (table === 'gardes') f.appelsGardes = (f.appelsGardes ?? 0) + 1
          const err = f.erreurs?.[table]
          if (err) return resoudre({ data: null, error: { message: err } })
          const toutes = f.tables[table] ?? []
          return resoudre({ data: toutes.slice(de, a + 1), error: null })
        },
      }
      return req
    },
  }
  return client as unknown as SupabaseClient
}

const VETS: Ligne[] = [
  { id: 'v1', prenom: 'Fanny', nom: 'Altieri', statut: 'associe', couleur: '#f00' },
  { id: 'v2', prenom: 'Victor', nom: 'Coelho', statut: 'salarie', couleur: '#0f0' },
]

/** Une garde de week-end tenue par v1 (1er) et v2 (2nd), période publiée. */
function gardeWE(): Ligne {
  return {
    type: 'weekend',
    premier_id: 'v1',
    second_id: 'v2',
    periodes: { statut: 'publie' },
    garde_placements: [],
  }
}

// ── ① Une erreur n'est pas un zéro ─────────────────────────────────────────

describe('une erreur de lecture ne se déguise jamais en « zéro garde »', () => {
  it('queryCompteurs remonte l’erreur au lieu d’une liste vide muette', async () => {
    const base = fausseBase({ tables: {}, erreurs: { compteurs_gardes: 'permission denied' } })
    const res = await queryCompteurs(base, 'p1')

    expect(res.erreur).toBe('permission denied')
    // La liste est vide, mais l'appelant a de quoi savoir POURQUOI — c'est
    // toute la différence entre « personne n'a de garde » et « je ne sais pas ».
    expect(res.compteurs).toEqual([])
  })

  it('queryTotalWE remonte l’erreur au lieu de compter zéro week-end', async () => {
    const base = fausseBase({ tables: {}, erreurs: { gardes: 'relation does not exist' } })
    const res = await queryTotalWE(base, 'p1')

    expect(res.erreur).toBe('relation does not exist')
    expect(res.totalWE).toBe(0)
  })

  it('queryCompteursPlage abandonne si les gardes sont illisibles', async () => {
    const base = fausseBase({
      tables: { veterinaires: VETS },
      erreurs: { gardes: 'statement timeout' },
    })
    const res = await queryCompteursPlage(base, '2026-01-01', '2026-12-31', false)

    expect(res.erreur).toBe('statement timeout')
    expect(res.compteurs).toEqual([])
    expect(res.totalWE).toBe(0)
  })

  it('queryCompteursPlage abandonne aussi si l’équipe est illisible', async () => {
    // Sans l'équipe, toutes les gardes tomberaient à côté de la plaque : la
    // map est vide, donc aucun compteur ne s'incrémente — et le résultat
    // serait un tableau vide très convaincant.
    const base = fausseBase({
      tables: { gardes: [gardeWE()] },
      erreurs: { veterinaires: 'JWT expired' },
    })
    const res = await queryCompteursPlage(base, '2026-01-01', '2026-12-31', false)

    expect(res.erreur).toBe('JWT expired')
    expect(res.compteurs).toEqual([])
  })

  it('une lecture qui réussit ne signale aucune erreur', async () => {
    const base = fausseBase({ tables: { veterinaires: VETS, gardes: [gardeWE()] } })
    const res = await queryCompteursPlage(base, '2026-01-01', '2026-12-31', false)

    expect(res.erreur).toBeNull()
    expect(res.totalWE).toBe(1)
    expect(res.compteurs.find((c) => c.veterinaire_id === 'v1')?.we_premier).toBe(1)
    expect(res.compteurs.find((c) => c.veterinaire_id === 'v2')?.we_second).toBe(1)
  })
})

// ── ② La plage large n'est pas tronquée ────────────────────────────────────

describe('une plage large compte TOUTES les gardes, pas les 1000 premières', () => {
  it('pagine au-delà du plafond PostgREST', async () => {
    // 2500 week-ends : trois pages. Sans pagination, on en verrait 1000 —
    // et rien, absolument rien, ne l'aurait signalé.
    const gardes = Array.from({ length: 2500 }, gardeWE)
    const f: Faux = { tables: { veterinaires: VETS, gardes } }
    const base = fausseBase(f)

    const res = await queryCompteursPlage(base, '2020-01-01', '2030-12-31', false)

    expect(res.erreur).toBeNull()
    expect(res.totalWE).toBe(2500)
    expect(res.compteurs.find((c) => c.veterinaire_id === 'v1')?.we_total).toBe(2500)
    // 1000 + 1000 + 500 : la dernière page incomplète arrête la boucle.
    expect(f.appelsGardes).toBe(3)
  })

  it('s’arrête après une seule page quand tout tient dedans', async () => {
    const f: Faux = { tables: { veterinaires: VETS, gardes: [gardeWE(), gardeWE()] } }
    const base = fausseBase(f)

    const res = await queryCompteursPlage(base, '2026-01-01', '2026-12-31', false)

    expect(res.totalWE).toBe(2)
    expect(f.appelsGardes).toBe(1)
  })

  it('un lot exactement plein déclenche bien une page de plus', async () => {
    // Le cas limite qui se rate : 1000 pile. Si la boucle s'arrêtait à
    // « lot non vide », elle croirait avoir tout lu.
    const f: Faux = { tables: { veterinaires: VETS, gardes: Array.from({ length: 1000 }, gardeWE) } }
    const base = fausseBase(f)

    const res = await queryCompteursPlage(base, '2026-01-01', '2026-12-31', false)

    expect(res.totalWE).toBe(1000)
    expect(f.appelsGardes).toBe(2)
  })
})
