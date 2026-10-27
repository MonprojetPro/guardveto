'use server'

// ============================================================
// GUARDVETO V2 — B-175 : l'admin choisit les plannings de son cabinet
// ============================================================
// Décision de MiKL, le 27/10 : « il faut que ce choix appartienne à l'admin ».
//
// ⚠️ Toute l'autorité est EN BASE, dans `basculer_module_cabinet` (SECURITY
//    DEFINER) : admin de CE cabinet, liste fermée des modules réglables, une
//    seule colonne écrite. Aucune policy UPDATE n'existe sur `cabinets`, et
//    c'est voulu (B-120a). Ce fichier ne fait que traduire le refus en phrase.
// ============================================================

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { MODULES_REGLABLES_PAR_ADMIN } from '@/lib/produit/modules'

type Resultat = { success: true; modules: string[] } | { error: string }

export async function basculerModuleCabinet(module: string, actif: boolean): Promise<Resultat> {
  if (!(MODULES_REGLABLES_PAR_ADMIN as readonly string[]).includes(module)) {
    return { error: 'Ce module ne se règle pas depuis le cabinet.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('basculer_module_cabinet', {
    p_module: module,
    p_actif: actif,
  })

  if (error) {
    // La fonction refuse avec une phrase écrite pour être lue ; une fonction
    // absente (migration pas jouée) ne doit pas se lire comme une réussite.
    if (/basculer_module_cabinet/.test(error.message) || error.code === 'PGRST202') {
      return { error: 'Ce réglage n’est pas encore disponible sur votre cabinet. Contactez l’assistance.' }
    }
    return { error: error.message }
  }

  // Le dock, l'accueil, le planning et l'historique lisent tous les modules.
  revalidatePath('/', 'layout')
  return { success: true, modules: (data ?? []) as string[] }
}
