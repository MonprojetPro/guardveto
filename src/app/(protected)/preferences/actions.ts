'use server'

// ============================================================
// GUARDVETO — Les réglages d'affichage propres à chacun
// ============================================================
// Volontairement à part des actions métier : ici on n'écrit RIEN qui concerne
// le cabinet, seulement le confort de la personne connectée. La table
// `preferences_affichage` existe pour la même raison — ouvrir l'écriture de la
// fiche `veterinaires` à son porteur lui donnerait aussi `role_app`,
// `dernier_recours` et `tags`, qu'aucune policy ne sait restreindre par
// colonne.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { revalidatePath } from 'next/cache'
import { normaliserColonnes } from '@/lib/planning/colonnesCompteurs'

/**
 * Enregistre les colonnes de l'encart compteurs pour la personne connectée.
 *
 * La liste est NORMALISÉE côté serveur (clés inconnues écartées, doublons
 * supprimés, plafond appliqué) : c'est une frontière de confiance, le client
 * pourrait envoyer n'importe quoi. Aucune garde de rôle — un vétérinaire a le
 * droit de régler son propre affichage, c'est même tout l'intérêt.
 */
export async function setColonnesCompteurs(colonnes: string[]) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!vet) return { error: 'Non authentifié.' }

  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Cabinet introuvable.' }
  }

  const propres = normaliserColonnes(colonnes)

  const { error } = await supabase
    .from('preferences_affichage')
    .upsert(
      {
        veterinaire_id: (vet as { id: string }).id,
        cabinet_id: cabinetId,
        colonnes_compteurs: propres,
        mis_a_jour_le: new Date().toISOString(),
      },
      { onConflict: 'veterinaire_id' },
    )

  if (error) return { error: error.message }

  revalidatePath('/planning')
  return { success: true, colonnes: propres }
}
