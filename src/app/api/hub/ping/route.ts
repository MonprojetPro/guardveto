// ============================================================
// GUARDVETO — GET /api/hub/ping (guichet du Hub MPP, B-207)
// ============================================================
// Le voyant « Guichet connecté » du Hub. Prouve les DEUX maillons en une
// requête : le secret est bon (sinon 401/503), et la base répond (on compte
// les cabinets — un chiffre que l'on peut vérifier, pas un simple « ok »).
// ============================================================

import { type NextRequest } from 'next/server'
import { ouvrirGuichet, reponseErreur, reponseOk } from '@/lib/guichet-hub/serveur'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = ouvrirGuichet(req)
  if ('refus' in g) return g.refus

  const { count, error } = await g.supabase.from('cabinets').select('id', { count: 'exact', head: true })
  if (error) {
    console.error('[Guichet Hub] ping — base injoignable :', error.message)
    return reponseErreur('La base de GuardVeto ne répond pas.', 502)
  }

  return reponseOk({
    ok: true,
    cabinets: count ?? 0,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  })
}
