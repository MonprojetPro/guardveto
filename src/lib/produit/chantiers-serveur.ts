// ============================================================
// GUARDVETO — La lecture serveur du « bac a sable »
// ============================================================
// Le pendant de `modules-serveur.ts`, pour les chantiers (`chantiers.ts`).
//
// ⚠️ LE REPLI EST « PAS UN BAC A SABLE », JAMAIS L'INVERSE. Si le cabinet est
//    introuvable ou la lecture echoue, on rend `false` : la personne voit alors
//    l'ecran ACTUEL, celui du client. Le produit se degrade en montrant ce qui
//    est deja recette, jamais en montrant un chantier.
//
//    C'est la difference avec `RubanBacASable`, qui applique « en cas de doute,
//    on n'affiche rien ». Les deux choisissent le defaut sur, mais ce n'est pas
//    le meme defaut : la, un ruban en trop serait une fausse alerte ; ici, un
//    chantier en trop serait l'incident du 08/10 (B-151).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { chantierOuvert, type ContexteDiffusion } from '@/lib/produit/chantiers'

/**
 * Le cabinet de l'utilisateur connecte est-il marque bac a sable ?
 *
 * Ne leve jamais : une panne de lecture rend `false` (voir l'avertissement en
 * tete de fichier).
 */
export async function estBacASable(

  supabase: SupabaseClient<any, any, any>
): Promise<boolean> {
  try {
    const cabinetId = await resoudreCabinetId(supabase)
    const { data, error } = await supabase
      .from('cabinets')
      .select('est_bac_a_sable')
      .eq('id', cabinetId)
      .maybeSingle()

    if (error) return false
    return Boolean((data as { est_bac_a_sable?: boolean } | null)?.est_bac_a_sable)
  } catch {
    return false
  }
}

/**
 * Le contexte de diffusion du cabinet connecte, pret a passer a
 * `chantierOuvert`.
 */
export async function contexteDiffusion(

  supabase: SupabaseClient<any, any, any>
): Promise<ContexteDiffusion> {
  return { estBacASable: await estBacASable(supabase) }
}

/**
 * Raccourci serveur : ce chantier est-il ouvert au cabinet connecte ?
 *
 * A preferer quand un ecran n'a qu'un seul chantier a consulter — il evite de
 * faire circuler le contexte pour rien.
 */
export async function chantierOuvertPourLeCabinet(

  supabase: SupabaseClient<any, any, any>,
  id: string
): Promise<boolean> {
  return chantierOuvert(id, await contexteDiffusion(supabase))
}
