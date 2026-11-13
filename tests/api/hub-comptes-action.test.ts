// ============================================================
// B-207 lot 1 — POST /api/hub/comptes/action (inviter / réinitialiser)
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { etat, inviter, reset } = vi.hoisted(() => ({
  etat: {
    fiche: null as Record<string, unknown> | null,
    users: [] as { id: string; confirmed_at?: string | null }[],
  },
  inviter: vi.fn(),
  reset: vi.fn(async () => ({ error: null })),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: etat.fiche, error: null }) }) }),
    }),
    auth: {
      admin: { listUsers: async () => ({ data: { users: etat.users }, error: null }) },
      resetPasswordForEmail: reset,
    },
  })),
}))
vi.mock('@/lib/comptes/invitation', () => ({ envoyerInvitation: inviter }))

import { POST } from '@/app/api/hub/comptes/action/route'

const SECRET = 'un-secret-de-test-suffisamment-long-0123456789'
const ID = '11111111-1111-4111-8111-111111111111'

function req(corps: unknown) {
  return new NextRequest('https://guardveto.test/api/hub/comptes/action', {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify(corps),
  })
}

beforeEach(() => {
  inviter.mockReset()
  reset.mockClear()
  etat.fiche = { id: ID, cabinet_id: 'cab', user_id: 'u1', email: 'fanny@cab.fr', actif: true, role_app: 'veto' }
  etat.users = [{ id: 'u1', confirmed_at: '2026-11-01T00:00:00Z' }]
  vi.stubEnv('HUB_GUICHET_SECRET', SECRET)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://exemple.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'cle')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/hub/comptes/action', () => {
  it('refuse une action, un genre ou un identifiant inconnus (400)', async () => {
    expect((await POST(req({ action: 'supprimer', genre: 'veterinaire', id: ID }))).status).toBe(400)
    expect((await POST(req({ action: 'inviter', genre: 'admin', id: ID }))).status).toBe(400)
    expect((await POST(req({ action: 'inviter', genre: 'veterinaire', id: 'x' }))).status).toBe(400)
  })

  it('404 sur une fiche inexistante, 409 sur une fiche désactivée', async () => {
    etat.fiche = null
    expect((await POST(req({ action: 'inviter', genre: 'veterinaire', id: ID }))).status).toBe(404)
    etat.fiche = { id: ID, cabinet_id: 'cab', user_id: null, email: 'a@b.fr', actif: false }
    expect((await POST(req({ action: 'inviter', genre: 'veterinaire', id: ID }))).status).toBe(409)
    expect(inviter).not.toHaveBeenCalled()
  })

  it('inviter passe par le chemin unique et rend l’adresse', async () => {
    inviter.mockResolvedValue({ ok: true, email: 'fanny@cab.fr', userId: 'n' })
    const res = await POST(req({ action: 'inviter', genre: 'veterinaire', id: ID }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { envoyeA: 'fanny@cab.fr' } })
    expect(inviter).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ genre: 'veterinaire', cabinetId: 'cab' }))
  })

  it('un lien déjà ouvert renvoie vers la réinitialisation (409), un échec technique reste générique (502)', async () => {
    inviter.mockResolvedValue({ ok: false, code: 'deja_ouvert' })
    const r1 = await POST(req({ action: 'inviter', genre: 'veterinaire', id: ID }))
    expect(r1.status).toBe(409)
    expect((await r1.json()).error).toMatch(/Réinitialiser/)
    inviter.mockResolvedValue({ ok: false, code: 'echec', detail: 'détail interne' })
    const r2 = await POST(req({ action: 'inviter', genre: 'veterinaire', id: ID }))
    expect(r2.status).toBe(502)
    expect((await r2.json()).error).not.toMatch(/détail interne/)
  })

  it('réinitialiser envoie le mail « mot de passe oublié » à un compte actif', async () => {
    const res = await POST(req({ action: 'reinitialiser', genre: 'veterinaire', id: ID }))
    expect(res.status).toBe(200)
    expect(reset).toHaveBeenCalledWith('fanny@cab.fr', { redirectTo: expect.stringMatching(/\/set-password$/) })
  })

  it('refuse de réinitialiser un compte dont l’invitation n’a pas été ouverte', async () => {
    etat.users = [{ id: 'u1', confirmed_at: null }]
    const res = await POST(req({ action: 'reinitialiser', genre: 'veterinaire', id: ID }))
    expect(res.status).toBe(409)
    expect(reset).not.toHaveBeenCalled()
  })

  it('accepte de réinitialiser un secrétariat qui a ouvert son lien sans choisir de mot de passe (pas de boucle)', async () => {
    etat.fiche = { id: ID, cabinet_id: 'cab', user_id: 'u1', email: 'accueil@cab.fr', actif: true, mot_de_passe_le: null }
    const res = await POST(req({ action: 'reinitialiser', genre: 'secretaire', id: ID }))
    expect(res.status).toBe(200)
    expect(reset).toHaveBeenCalled()
  })
})
