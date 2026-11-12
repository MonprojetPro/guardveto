// ============================================================
// B-207 — Les routes du guichet du Hub MPP (/api/hub/*)
// ============================================================
// Ce que ces tests figent, route par route :
//   • sans secret configuré → 503, la base n'est JAMAIS appelée ;
//   • mauvais secret → 401, la base n'est jamais appelée ;
//   • une demande d'envoi invalide est refusée (400) avant la base ;
//   • les refus rédigés par la fonction SQL remontent tels quels
//     (22023 → 400, 42501 → 409), un refus inattendu devient un 500 générique ;
//   • un envoi réussi rend { data: { envois } } en camelCase, statut 201.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc, from })),
}))

import { POST } from '@/app/api/hub/messagerie/envoyer/route'
import { GET } from '@/app/api/hub/ping/route'

const SECRET = 'un-secret-de-test-suffisamment-long-0123456789'
const CAB = '3f1a2062-0512-4a83-b097-1801a8b90e5e'
const U1 = '11111111-1111-4111-8111-111111111111'

function requete(chemin: string, opts: { secret?: string | null; corps?: unknown; methode?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.secret !== null) headers.authorization = `Bearer ${opts.secret ?? SECRET}`
  return new NextRequest(`https://guardveto.test${chemin}`, {
    method: opts.methode ?? 'POST',
    headers,
    body: opts.corps === undefined ? undefined : JSON.stringify(opts.corps),
  })
}

const envoiValide = { cabinetId: CAB, destinataires: [U1], corps: 'Bonjour de MonProjetPro' }

beforeEach(() => {
  rpc.mockReset()
  from.mockReset()
  vi.stubEnv('HUB_GUICHET_SECRET', SECRET)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://exemple.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'cle-service-de-test')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/hub/messagerie/envoyer', () => {
  it('ferme le guichet (503) si le secret n’est pas configuré, sans toucher la base', async () => {
    vi.stubEnv('HUB_GUICHET_SECRET', '')
    const res = await POST(requete('/api/hub/messagerie/envoyer', { corps: envoiValide }))
    expect(res.status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuse (401) un mauvais secret, sans toucher la base', async () => {
    const res = await POST(requete('/api/hub/messagerie/envoyer', { secret: SECRET + 'x', corps: envoiValide }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Non autorisé.' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuse (401) une requête sans en-tête', async () => {
    const res = await POST(requete('/api/hub/messagerie/envoyer', { secret: null, corps: envoiValide }))
    expect(res.status).toBe(401)
  })

  it('refuse (400) une demande invalide avant la base', async () => {
    const res = await POST(
      requete('/api/hub/messagerie/envoyer', { corps: { ...envoiValide, destinataires: ['pas-un-uuid'] } }),
    )
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuse (400) un corps qui n’est pas du JSON', async () => {
    const req = new NextRequest('https://guardveto.test/api/hub/messagerie/envoyer', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
      body: '{pas du json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('rend 201 et les envois en camelCase quand la base accepte', async () => {
    rpc.mockResolvedValue({
      data: [{ user_id: U1, conversation_id: 'conv-1', message_id: 'msg-1' }],
      error: null,
    })
    const res = await POST(requete('/api/hub/messagerie/envoyer', { corps: envoiValide }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      data: { envois: [{ userId: U1, conversationId: 'conv-1', messageId: 'msg-1' }] },
    })
    expect(rpc).toHaveBeenCalledWith('messagerie_envoyer_editeur', {
      p_cabinet: CAB,
      p_destinataires: [U1],
      p_corps: 'Bonjour de MonProjetPro',
    })
  })

  it('remonte tel quel un refus 22023 de la base (400)', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: '1 destinataire(s) ne font pas partie des membres actifs de ce cabinet : rien n’a été envoyé.' },
    })
    const res = await POST(requete('/api/hub/messagerie/envoyer', { corps: envoiValide }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/rien n’a été envoyé/)
  })

  it('traduit la messagerie éteinte (42501) en 409', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'La messagerie est éteinte dans ce cabinet.' } })
    const res = await POST(requete('/api/hub/messagerie/envoyer', { corps: envoiValide }))
    expect(res.status).toBe(409)
  })

  it('cache un refus inattendu derrière un 500 générique', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'détail interne' } })
    const res = await POST(requete('/api/hub/messagerie/envoyer', { corps: envoiValide }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).not.toMatch(/détail interne/)
  })
})

describe('GET /api/hub/ping', () => {
  function cabinets(resultat: { count: number | null; error: { message: string } | null }) {
    from.mockReturnValue({ select: vi.fn(async () => resultat) })
  }

  it('rend le nombre de cabinets quand le secret est bon et la base répond', async () => {
    cabinets({ count: 2, error: null })
    const res = await GET(requete('/api/hub/ping', { methode: 'GET' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ data: { ok: true, cabinets: 2 } })
  })

  it('refuse (401) un mauvais secret', async () => {
    const res = await GET(requete('/api/hub/ping', { methode: 'GET', secret: 'mauvais' }))
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('dit 502 quand la base ne répond pas', async () => {
    cabinets({ count: null, error: { message: 'timeout' } })
    const res = await GET(requete('/api/hub/ping', { methode: 'GET' }))
    expect(res.status).toBe(502)
  })
})
