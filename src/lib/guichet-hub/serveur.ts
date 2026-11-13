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
import type { CompteAuth } from './lectures'

export function reponseOk<T>(data: T, statut = 200): NextResponse {
  return NextResponse.json({ data }, { status: statut, headers: { 'Cache-Control': 'no-store' } })
}

export function reponseErreur(message: string, statut: number): NextResponse {
  return NextResponse.json({ error: message }, { status: statut, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Les comptes Supabase Auth, par identifiant — trois dates seulement, jamais
 * les métadonnées ni les jetons. `null` si l'API Auth ne répond pas : l'appelant
 * affiche alors « inconnu », pas « aucun compte ».
 */
export async function lireComptesAuth(supabase: SupabaseClient): Promise<Map<string, CompteAuth> | null> {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) {
    console.error('[Guichet Hub] Comptes auth illisibles :', error.message)
    return null
  }
  return new Map(
    (data?.users ?? []).map((u) => [
      u.id,
      { id: u.id, confirmed_at: u.confirmed_at ?? null, last_sign_in_at: u.last_sign_in_at ?? null, invited_at: u.invited_at ?? null },
    ]),
  )
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
