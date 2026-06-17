// ============================================================
// GUARDVETO — Helper d'isolation multi-tenant (cabinet_id)
// ============================================================
// Source UNIQUE et SERVEUR du cabinet_id à écrire sur toute ligne
// d'une table métier. Le cabinet_id est dérivé :
//   1. de app_metadata.cabinet_id du JWT (règle C1 — non falsifiable
//      par l'utilisateur, modifiable uniquement par le service_role) ;
//   2. en repli (DEV_BYPASS_AUTH ou JWT incomplet), de la ligne
//      veterinaires liée à l'utilisateur (veterinaires.cabinet_id).
//
// ⚠️ JAMAIS depuis un champ fourni par le client : sinon un user
//    pourrait écrire dans le cabinet d'un autre (cross-tenant write).
//
// Toutes les écritures (insert/upsert) dans une table portant
// cabinet_id DOIVENT passer par resoudreCabinetId() pour renseigner
// la colonne, faute de quoi la ligne est invisible sous RLS stricte
// (cabinet_id = auth_cabinet_actif()).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export class CabinetIntrouvableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CabinetIntrouvableError'
  }
}

/**
 * Résout le cabinet_id de l'utilisateur authentifié, côté serveur.
 *
 * @param supabase Client Supabase serveur (déjà authentifié)
 * @returns Le UUID du cabinet actif de l'utilisateur
 * @throws CabinetIntrouvableError si l'utilisateur n'est pas authentifié
 *         ou si aucun cabinet ne peut être déterminé.
 */
export async function resoudreCabinetId(

  supabase: SupabaseClient<any, any, any>
): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw new CabinetIntrouvableError('Utilisateur non authentifié.')
  }

  // 1. Source de vérité : app_metadata.cabinet_id (règle C1).
  const fromJwt = (user.app_metadata as Record<string, unknown> | undefined)
    ?.cabinet_id as string | undefined
  if (fromJwt) return fromJwt

  // 2. Repli serveur (DEV_BYPASS ou JWT sans app_metadata) :
  //    on lit le cabinet rattaché au profil véto de l'utilisateur.
  //    Toujours côté serveur, jamais depuis le client.
  const { data: vet, error } = await supabase
    .from('veterinaires')
    .select('cabinet_id')
    .eq('user_id', user.id)
    .single()

  if (error || !vet?.cabinet_id) {
    throw new CabinetIntrouvableError(
      'Cabinet non configuré pour cet utilisateur '
      + '(app_metadata.cabinet_id manquant et veterinaires.cabinet_id introuvable).'
    )
  }

  return vet.cabinet_id as string
}
