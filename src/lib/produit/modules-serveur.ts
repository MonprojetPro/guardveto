// ============================================================
// GUARDVETO — Le refus serveur d'un module eteint
// ============================================================
// Cacher une entree de menu n'a JAMAIS ferme une URL. Une porte fermee a
// l'ecran et ouverte au serveur n'est pas un defaut d'affichage, c'est une
// faille — et c'est la famille de defauts la plus payee sur ce produit
// (« trois chemins d'ecriture, deux gardiens », 22/08).
//
// ⚠️ LE REPLI EST LE SOCLE, JAMAIS « TOUT ALLUME ». Si le cabinet est
//    introuvable ou la lecture echoue, on rend `['gardes']` : le produit se
//    degrade en fermant, pas en ouvrant. Un repli permissif transformerait
//    une panne de lecture en ouverture generale, sans un seul message.
//
// ⚠️ UN MODULE INCONNU EST REFUSE. Une faute de frappe dans un appelant
//    (`'chatt'`) ne doit pas se traduire par une porte ouverte : elle ne
//    figurera jamais dans `modules_actifs`, donc `exigerModule` la refuse.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { MODULES, MODULE_SOCLE } from '@/lib/produit/modules'

export class ModuleEteintError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModuleEteintError'
  }
}

/** Les modules allumes pour le cabinet de l'utilisateur connecte. */
export async function modulesDuCabinet(

  supabase: SupabaseClient<any, any, any>
): Promise<string[]> {
  const cabinetId = await resoudreCabinetId(supabase)

  const { data, error } = await supabase
    .from('cabinets')
    .select('modules_actifs')
    .eq('id', cabinetId)
    .maybeSingle()

  // Repli fermant, jamais ouvrant. Voir l'avertissement en tete de fichier.
  if (error || !data?.modules_actifs) return [MODULE_SOCLE]

  return data.modules_actifs as string[]
}

/**
 * Refuse l'action si le module n'est pas allume pour ce cabinet.
 *
 * A appeler EN PREMIER dans toute action serveur d'un module eteignable,
 * avant toute lecture et toute ecriture.
 */
export async function exigerModule(

  supabase: SupabaseClient<any, any, any>,
  module: string
): Promise<void> {
  const allumes = await modulesDuCabinet(supabase)
  if (allumes.includes(module)) return

  const nom = MODULES[module]?.nom ?? module
  throw new ModuleEteintError(
    `« ${nom} » n’est pas activé pour ce cabinet. Contactez MonProjetPro pour l’ouvrir.`,
  )
}
