// ============================================================
// GUARDVETO — Qui a le droit d'importer un ancien planning
// ============================================================
// POURQUOI CE FICHIER EXISTE. Ce contrôle vivait à l'intérieur de
// `filou/import-actions.ts`, qui porte un `'use server'`. Deux appelants en ont
// désormais besoin — l'action d'écriture et la route `/api/import/lire` — et un
// `'use server'` ne peut PAS servir de bibliothèque partagée : tout ce qu'il
// exporte devient une Server Action, donc un point d'entrée appelable depuis le
// navigateur. Exporter le contrôle d'accès depuis là reviendrait à en faire une
// porte de plus à surveiller.
//
// Un module serveur ordinaire, lui, se laisse importer des deux côtés sans rien
// exposer. Et il n'y a qu'UNE définition de « qui a le droit » : le jour où la
// règle change, elle change à un seul endroit — l'audit de migration d'écran a
// déjà montré ce que coûte un droit recopié (`docs/08-lessons-learned.md`).
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { IMPORT_PLANNING_ACTIF, IMPORT_PLANNING_ETEINT } from './actif'

export type ContexteAdmin =
  | { error: string }
  | { cabinetId: string; supabase: Awaited<ReturnType<typeof createClient>> }

/** Le contexte commun : qui parle, et est-ce bien un administrateur.
 *  L'import écrit dans l'historique du cabinet — ce n'est pas un geste de
 *  vétérinaire. */
export async function contexteAdmin(): Promise<ContexteAdmin> {
  // ⚠️ LA COUPURE EST ICI, ET NULLE PART AILLEURS. Ce module est le passage
  // obligé des DEUX portes de l'import — la route de lecture et l'action
  // d'écriture. Éteindre l'import à cet endroit les ferme toutes les deux d'un
  // seul geste, et rend impossible d'en rouvrir une en oubliant l'autre.
  // Cf. `actif.ts` pour la décision produit du 2026-08-18.
  if (!IMPORT_PLANNING_ACTIF) return { error: IMPORT_PLANNING_ETEINT }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()
  if (!vet) return { error: 'Profil vétérinaire introuvable.' }
  if ((vet.role_app as string) !== 'admin') {
    return { error: "L'import d'un ancien planning est réservé à l'administrateur." }
  }

  try {
    return { cabinetId: await resoudreCabinetId(supabase), supabase }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }
}
