// ============================================================
// GUARDVETO — Le guichet du Hub MPP : la porte commune (B-207)
// ============================================================
// Chaque route `/api/hub/*` passe par `ouvrirGuichet` : verification du
// secret, puis client « service » (il ne depend d'aucune session — le Hub n'a
// pas de compte GuardVeto). Les reponses suivent TOUJOURS le meme format que
// le guichet MenuFacile : `{ data }` en cas de succes, `{ error }` sinon.
//
// ⚠️ Le client service CONTOURNE la RLS. Il ne sort jamais d'ici : chaque
//    route ne fait que ce qu'elle annonce, et les ecritures passent par des
//    fonctions SQL qui refont leurs propres controles (ex.
//    `messagerie_envoyer_editeur`, tout ou rien).
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { secretConfigure, verifierAcces } from './acces'

export function reponseOk<T>(data: T, statut = 200): NextResponse {
  return NextResponse.json({ data }, { status: statut, headers: { 'Cache-Control': 'no-store' } })
}

export function reponseErreur(message: string, statut: number): NextResponse {
  return NextResponse.json({ error: message }, { status: statut, headers: { 'Cache-Control': 'no-store' } })
}

/** Le secret est bon → le client service ; sinon la reponse de refus, prete a renvoyer. */
export function ouvrirGuichet(
  req: NextRequest,
): { supabase: SupabaseClient } | { refus: NextResponse } {
  const verdict = verifierAcces(req.headers.get('authorization'), secretConfigure())
  if (!verdict.ok) {
    if (verdict.statut === 503) {
      // Visible dans les journaux Vercel : sans cette ligne, un guichet ferme
      // par oubli de configuration ressemble a un mauvais secret cote Hub.
      console.error('[Guichet Hub] HUB_GUICHET_SECRET absent ou trop court : guichet fermé.')
    }
    return { refus: reponseErreur(verdict.raison, verdict.statut) }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !cle) {
    console.error('[Guichet Hub] Variables Supabase manquantes.')
    return { refus: reponseErreur('Guichet non configuré.', 503) }
  }
  return {
    supabase: createServiceClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } }),
  }
}
