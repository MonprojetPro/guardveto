// ============================================================
// B-175 — chaque véto écrit SA semaine type, et seulement la sienne
// ============================================================
// MiKL, 27/10 : « chaque véto sa semaine type, l'admin garde la main ».
//
// Ce que ces cas prouvent : un vétérinaire passe la porte des trames, mais
// N'ÉCRIT RIEN dès qu'une ligne désigne un collègue — ni en création, ni en
// modification (y compris « donner » sa ligne à quelqu'un), ni en retrait.
// On regarde le JOURNAL des écritures, pas seulement le message : une action
// qui rendrait `{ error }` APRÈS avoir écrit passerait un test sur le résultat.
// ============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

let journal: string[] = []
let role = 'veto'
/** À qui appartient la ligne de trame `t-1` en base. */
let titulaire = 'v-moi'
/** Ce que la base renvoie à un UPDATE (une RLS qui refuse rend zéro ligne). */
let lignesEcrites: { id: string }[] = [{ id: 't-1' }]

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/cabinet', () => ({
  resoudreCabinetId: async () => 'cab-1',
  CabinetIntrouvableError: class extends Error {},
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    from: (table: string) => {
      let filtreId: string | null = null
      const chaine: Record<string, unknown> = {
        select: () => chaine,
        eq: (col: string, val: string) => {
          if (col === 'id') filtreId = val
          return chaine
        },
        order: () => chaine,
        maybeSingle: async () => {
          if (table === 'cabinets') {
            return { data: { modules_actifs: ['gardes', 'planning-journee'] }, error: null }
          }
          if (table === 'veterinaires') {
            // Sans filtre `id` : la fiche de la personne connectée (porte).
            // Avec : le contrôle « cette personne est-elle active ? ».
            return filtreId
              ? { data: { id: filtreId, prenom: 'X', actif: true }, error: null }
              : { data: { id: 'v-moi', role_app: role }, error: null }
          }
          if (table === 'trames_journee') return { data: { veterinaire_id: titulaire }, error: null }
          return { data: null, error: null }
        },
        insert: async () => {
          journal.push(`insert:${table}`)
          return { error: null }
        },
        update: () => {
          journal.push(`update:${table}`)
          const suite = { eq: () => suite, select: async () => ({ data: lignesEcrites, error: null }) }
          return suite
        },
      }
      ;(chaine as { then?: unknown }).then = (resoudre: (v: unknown) => void) =>
        resoudre({
          data: table === 'blocs_journee' ? [{ id: 'b-1', nom: 'Matin', actif: true }] : [],
          error: null,
        })
      return chaine
    },
  }),
}))

const { creerTrames, modifierTrame, basculerTrame } = await import('@/app/(v2)/journee/trames-actions')

const ecritures = () => journal.filter((e) => e.startsWith('insert:') || e.startsWith('update:'))
const saisie = (veterinaire_id: string) => ({ veterinaire_id, bloc_id: 'b-1', jour: 'lundi', semaine: 'toutes' })

beforeEach(() => {
  journal = []
  role = 'veto'
  titulaire = 'v-moi'
  lignesEcrites = [{ id: 't-1' }]
})

describe('Un vétérinaire remplit SA semaine type', () => {
  it('ajoute des jours à sa propre trame', async () => {
    const r = await creerTrames({ veterinaire_id: 'v-moi', bloc_id: 'b-1', jours: ['lundi'], semaine: 'toutes' })
    expect(r).toEqual({ success: true })
    expect(ecritures()).toEqual(['insert:trames_journee'])
  })

  it('modifie et retire sa propre ligne', async () => {
    expect(await modifierTrame('t-1', saisie('v-moi'))).toEqual({ success: true })
    expect(await basculerTrame('t-1', false)).toEqual({ success: true })
    expect(ecritures()).toEqual(['update:trames_journee', 'update:trames_journee'])
  })
})

describe('… et jamais celle d’un collègue', () => {
  it('refuse d’ajouter à la trame d’un collègue, sans rien écrire', async () => {
    const r = await creerTrames({ veterinaire_id: 'v-autre', bloc_id: 'b-1', jours: ['lundi'], semaine: 'toutes' })
    expect(r).toHaveProperty('error')
    expect(ecritures()).toEqual([])
  })

  it('refuse de modifier la ligne d’un collègue', async () => {
    titulaire = 'v-autre'
    expect(await modifierTrame('t-1', saisie('v-autre'))).toHaveProperty('error')
    expect(ecritures()).toEqual([])
  })

  it('refuse de DONNER sa ligne à un collègue', async () => {
    // La ligne est à lui, mais la saisie la réattribue : le second test de
    // `modifierTrame` est le seul à l'arrêter.
    expect(await modifierTrame('t-1', saisie('v-autre'))).toHaveProperty('error')
    expect(ecritures()).toEqual([])
  })

  it('refuse de retirer la ligne d’un collègue', async () => {
    titulaire = 'v-autre'
    expect(await basculerTrame('t-1', false)).toHaveProperty('error')
    expect(ecritures()).toEqual([])
  })

  it('ne présente pas comme réussi un UPDATE que la base a refusé (zéro ligne)', async () => {
    lignesEcrites = []
    expect(await basculerTrame('t-1', false)).toHaveProperty('error')
  })
})

describe('L’administratrice garde la main', () => {
  it('écrit la trame de n’importe qui dans son cabinet', async () => {
    role = 'admin'
    titulaire = 'v-autre'
    expect(await modifierTrame('t-1', saisie('v-autre'))).toEqual({ success: true })
    expect(await basculerTrame('t-1', true)).toEqual({ success: true })
  })
})
