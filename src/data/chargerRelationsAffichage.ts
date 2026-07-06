// ============================================================
// GUARDVETO — Relations d'affichage résolues pour une période (P6 verrou n°3)
// ============================================================
// Charge les relations entre créneaux (résolues en CODES) du profil EFFECTIF
// d'une période, pour PILOTER la dérivation d'affichage du vendredi (vue / PDF /
// agenda). MIROIR EXACT du gating du moteur (src/engine/loader.ts) :
//
//   - Pas de catalogue `creneau_modele` pour le cabinet/profil (contextes
//     legacy) → `undefined` → l'aval retombe sur le couple historique câblé
//     (byte-identique).
//   - Catalogue présent → la DONNÉE fait foi (y compris `[]` = découplage réel),
//     EXACTEMENT comme la génération : ce que le moteur a produit et ce que
//     l'affichage montre restent cohérents.
//
// Best-effort : jamais de throw (période/cabinet introuvable → undefined).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  chargerCreneauModele,
  chargerRelationsCreneau,
  resoudreProfilId,
} from '@/data/chargerCreneauModele'
import { resoudreRelationsStructure } from '@/engine/relations-structure'
import type { RelationStructure } from '@/engine/structure-config'

/**
 * Relations d'affichage (codes) du profil effectif de la période, ou `undefined`
 * si aucun catalogue (→ repli couple historique dans l'aval). Voir en-tête.
 */
export async function chargerRelationsAffichagePeriode(
  supabase: SupabaseClient,
  periodeId: string,
): Promise<RelationStructure[] | undefined> {
  const { data: periode } = await supabase
    .from('periodes')
    .select('cabinet_id, profil_id')
    .eq('id', periodeId)
    .maybeSingle()

  const cabinetId = (periode as { cabinet_id?: string | null } | null)?.cabinet_id
  if (!cabinetId) return undefined // legacy / hors-tenant → couple historique

  const profilId = await resoudreProfilId(
    supabase,
    cabinetId,
    (periode as { profil_id?: string | null } | null)?.profil_id ?? undefined,
  )

  const creneaux = await chargerCreneauModele(supabase, cabinetId, profilId)
  // Gating IDENTIQUE au loader moteur : sans catalogue → undefined (historique).
  if (!creneaux || creneaux.length === 0) return undefined

  const relationsRows = await chargerRelationsCreneau(supabase, cabinetId, profilId)
  return resoudreRelationsStructure(relationsRows, creneaux)
}
