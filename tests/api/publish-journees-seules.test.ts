// ============================================================
// B-172 — Un planning de journées seules se publie
// ============================================================
// Avant le 23/10, `/api/publish` refusait tout planning sans garde. Depuis
// B-162 une période « journées » n'en a jamais : elle ne pouvait donc pas être
// publiée, et ses présences jamais vues de l'équipe.
//
// Ce que ces tests figent :
//   • sans garde mais avec des présences → publié, sans re-validation, sans
//     e-mail ni agenda (ils ne portent que les gardes) ;
//   • ni garde ni présence → toujours refusé, avec un message qui le dit.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { etat, revalider, sync, mails } = vi.hoisted(() => ({
  etat: { gardes: 0, presences: 0, updates: [] as Record<string, unknown>[] },
  revalider: vi.fn(),
  sync: vi.fn(),
  mails: vi.fn(),
}))

function chaine(table: string) {
  const c: Record<string, unknown> = {}
  const self = () => c
  c.select = vi.fn(self)
  c.eq = vi.fn(self)
  c.neq = vi.fn(self)
  c.update = vi.fn((v: Record<string, unknown>) => {
    etat.updates.push({ table, ...v })
    return c
  })
  c.single = vi.fn(async () => {
    if (table === 'veterinaires') return { data: { role_app: 'admin', cabinet_id: 'cab' } }
    if (table === 'periodes') return { data: { id: 'p', statut: 'brouillon', date_debut: '2026-11-09', date_fin: '2026-11-16' } }
    return { data: null }
  })
  // Un comptage `head: true` se lit en attendant la chaîne elle-même.
  c.then = (res: (v: unknown) => unknown) => {
    if (table === 'gardes') return Promise.resolve({ count: etat.gardes, error: null }).then(res)
    if (table === 'presences_journee') return Promise.resolve({ count: etat.presences, error: null }).then(res)
    return Promise.resolve({ error: null }).then(res)
  }
  return c
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) },
    from: (t: string) => chaine(t),
  }),
}))
vi.mock('@/data/revaliderPlanning', () => ({ revaliderPlanning: revalider }))
vi.mock('@/lib/sync-calendrier', () => ({ syncCalendrier: sync }))
vi.mock('@/lib/notifications', () => ({ sendPlanningPublie: mails }))
vi.mock('@/lib/notifications-inapp', () => ({ signalerIncidentTechnique: vi.fn() }))
vi.mock('@/data/historiqueFetes', () => ({ enregistrerHistoriqueFetes: vi.fn() }))
vi.mock('@/data/souhaitsCongesEnAttente', () => ({ compterSouhaitsCongesEnAttente: vi.fn(async () => 0) }))
vi.mock('@/data/casesAPourvoir', () => ({ casesAPourvoir: vi.fn(async () => []) }))

const { POST } = await import('@/app/api/publish/route')

function requete() {
  return new Request('http://test/api/publish', {
    method: 'POST',
    body: JSON.stringify({ periodeId: 'p' }),
  }) as unknown as Parameters<typeof POST>[0]
}

describe('/api/publish — planning de journées seules (B-172)', () => {
  beforeEach(() => {
    etat.updates = []
    revalider.mockReset()
    sync.mockReset()
    mails.mockReset()
  })

  it('publie un planning sans garde qui porte des présences, sans e-mail ni agenda', async () => {
    etat.gardes = 0
    etat.presences = 12
    const res = await POST(requete())
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data).toMatchObject({ success: true, journeesSeules: true })
    expect(etat.updates).toEqual([
      expect.objectContaining({ table: 'periodes', statut: 'publie', publie_at: expect.any(String) }),
    ])
    expect(revalider).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
    expect(mails).not.toHaveBeenCalled()
  })

  it('refuse toujours un planning vide, et le dit', async () => {
    etat.gardes = 0
    etat.presences = 0
    const res = await POST(requete())
    const data = await res.json()

    expect(res.status).toBe(422)
    expect(data.error).toMatch(/ni garde ni journée/)
    expect(etat.updates).toEqual([])
  })
})
