// ============================================================
// B-207 lot 1 — Le chemin d'invitation UNIQUE (`envoyerInvitation`)
// ============================================================
// Ce que ces tests figent (les deux incidents payés en premier) :
//   • 2026-08-15 : le cabinet est posé dans `app_metadata` (le jeton), et si
//     cette passe échoue le compte est EFFACÉ, pas annoncé ;
//   • on passe par `inviteUserByEmail`, jamais par un INSERT ;
//   • un compte déjà confirmé n'est jamais effacé ;
//   • le compte en attente d'une AUTRE fiche n'est jamais effacé ;
//   • la fiche est reliée au compte (et `invite_pending` pour un véto).
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { envoyerInvitation } from '@/lib/comptes/invitation'

function faux(opts: {
  existants?: { id: string; email: string; confirmed_at?: string | null; user_metadata?: Record<string, unknown> }[]
  erreurMeta?: boolean
  erreurLien?: boolean
}) {
  const appels = {
    deleteUser: vi.fn(async () => ({ error: null })),
    inviteUserByEmail: vi.fn(async () => ({ data: { user: { id: 'nouveau' } }, error: null })),
    updateUserById: vi.fn(async () => ({ error: opts.erreurMeta ? { message: 'boom' } : null })),
    updates: [] as { table: string; valeurs: Record<string, unknown>; id: unknown }[],
  }
  const client = {
    auth: {
      admin: {
        listUsers: vi.fn(async () => ({ data: { users: opts.existants ?? [] }, error: null })),
        deleteUser: appels.deleteUser,
        inviteUserByEmail: appels.inviteUserByEmail,
        updateUserById: appels.updateUserById,
      },
    },
    from: (table: string) => ({
      update: (valeurs: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          appels.updates.push({ table, valeurs, id })
          return { error: opts.erreurLien ? { message: 'refus' } : null }
        },
      }),
    }),
  }
  return { client: client as unknown as SupabaseClient, appels }
}

const veto = { genre: 'veterinaire' as const, id: 'v1', email: 'Fanny@Cabinet.fr', cabinetId: 'cab', userId: null, role: 'veto' }

describe('envoyerInvitation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invite, pose le cabinet DANS LE JETON, relie la fiche', async () => {
    const { client, appels } = faux({})
    const r = await envoyerInvitation(client, veto)
    expect(r).toEqual({ ok: true, email: 'fanny@cabinet.fr', userId: 'nouveau' })
    expect(appels.inviteUserByEmail).toHaveBeenCalledWith('fanny@cabinet.fr', { data: { veterinaire_id: 'v1' } })
    expect(appels.updateUserById).toHaveBeenCalledWith('nouveau', {
      app_metadata: { cabinet_id: 'cab' },
      user_metadata: { veterinaire_id: 'v1', role: 'veto' },
    })
    expect(appels.updates).toEqual([
      { table: 'veterinaires', valeurs: { user_id: 'nouveau', invite_pending: true }, id: 'v1' },
    ])
  })

  it('secrétariat : rôle « secretaire » et table secretaires, sans invite_pending', async () => {
    const { client, appels } = faux({})
    await envoyerInvitation(client, { genre: 'secretaire', id: 's1', email: 'accueil@cab.fr', cabinetId: 'cab', userId: null })
    expect(appels.updateUserById).toHaveBeenCalledWith('nouveau', {
      app_metadata: { cabinet_id: 'cab' },
      user_metadata: { secretaire_id: 's1', role: 'secretaire' },
    })
    expect(appels.updates).toEqual([{ table: 'secretaires', valeurs: { user_id: 'nouveau' }, id: 's1' }])
  })

  it('efface le compte et refuse si le cabinet ne peut pas être posé dans le jeton (incident du 15/08)', async () => {
    const { client, appels } = faux({ erreurMeta: true })
    const r = await envoyerInvitation(client, veto)
    expect(r).toMatchObject({ ok: false, code: 'echec' })
    expect(appels.deleteUser).toHaveBeenCalledWith('nouveau')
    expect(appels.updates).toEqual([])
  })

  it('refuse sans adresse, sans rien appeler', async () => {
    const { client, appels } = faux({})
    expect(await envoyerInvitation(client, { ...veto, email: null })).toEqual({ ok: false, code: 'sans_adresse' })
    expect(appels.inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('n’efface JAMAIS un compte déjà confirmé', async () => {
    const { client, appels } = faux({ existants: [{ id: 'u', email: 'fanny@cabinet.fr', confirmed_at: '2026-11-01' }] })
    expect(await envoyerInvitation(client, { ...veto, userId: 'u' })).toEqual({ ok: false, code: 'deja_ouvert' })
    expect(appels.deleteUser).not.toHaveBeenCalled()
  })

  it('n’efface JAMAIS le compte en attente d’une autre fiche', async () => {
    const { client, appels } = faux({
      existants: [{ id: 'autre', email: 'fanny@cabinet.fr', confirmed_at: null, user_metadata: { veterinaire_id: 'v9' } }],
    })
    expect(await envoyerInvitation(client, veto)).toEqual({ ok: false, code: 'conflit' })
    expect(appels.deleteUser).not.toHaveBeenCalled()
  })

  it('repart d’une base saine pour le compte en attente de CETTE fiche', async () => {
    const { client, appels } = faux({
      existants: [{ id: 'ancien', email: 'fanny@cabinet.fr', confirmed_at: null, user_metadata: { veterinaire_id: 'v1' } }],
    })
    const r = await envoyerInvitation(client, veto)
    expect(r.ok).toBe(true)
    expect(appels.deleteUser).toHaveBeenCalledWith('ancien')
  })
})
