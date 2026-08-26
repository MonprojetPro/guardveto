// ============================================================
// GUARDVETO — Des décisions de réparation aux changements de garde réels
// ============================================================
// SERVER-ONLY.
//
// Une réparation d'absence s'exprime en DÉCISIONS (« sur cette garde, tel rôle
// passe à untel ») et le gardien des règles, lui, raisonne en CHANGEMENTS DE
// GARDE (« cette garde aura ce premier et ce second »). La traduction entre les
// deux n'est pas mécanique : deux décisions peuvent viser les deux rôles d'un
// même créneau, et les traiter séparément ferait juger un état qui n'existera
// jamais.
//
// POURQUOI CE FICHIER
//
// Cette traduction vivait uniquement dans l'outil Filou (`lib/ia/outils/
// absences.ts`). L'écran de crise, lui, appelait `appliquerChangementGarde`
// sans jamais consulter le gardien — l'écran était en retard sur Filou (T-006,
// relevé par l'audit B-007 du 24/08, oublié du recensement des chemins
// d'écriture du 22/08).
//
// La leçon du 22/08 est exactement celle-là : quand un contrôle existe à un
// endroit et pas à l'autre, ce n'est pas le contrôle qu'il faut recopier, c'est
// la fonction qu'il faut sortir. Deux copies divergent ; une seule ne peut pas.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fusionnerChangementsParGarde,
  type ChangementGardeSitue,
} from '@/lib/gardes/avertissements-regles'

/** Une décision de remplacement, telle que l'écran comme Filou la formulent. */
export interface DecisionChangement {
  gardeId: string
  role: string
  remplacant_id: string
}

/**
 * Traduit des décisions de remplacement en changements de garde situés (avec
 * leur période), prêts pour `avertissementsReglesDuresMultiPeriodes`.
 *
 * Best-effort ASSUMÉ, au même titre que le gardien qu'elle alimente : si la
 * lecture échoue, on rend un tableau vide et l'écriture passe. Un contrôle
 * informatif qui empêcherait de réparer une absence quand la base tousse serait
 * pire que son absence — et la re-validation continue rattrapera l'écart.
 */
export async function changementsPourDecisions(
  supabase: SupabaseClient,
  cabinetId: string,
  decisions: readonly DecisionChangement[],
): Promise<ChangementGardeSitue[]> {
  if (decisions.length === 0) return []

  const { data, error } = await supabase
    .from('gardes')
    .select('id, periode_id, premier_id, second_id')
    .in('id', decisions.map((d) => d.gardeId))
    .eq('cabinet_id', cabinetId)

  // L'erreur est LUE et dite au journal : sans ça, une base muette produirait
  // « aucune règle enfreinte » — la réponse rassurante qu'on refuse partout
  // ailleurs dans ce projet (B-011, B-005).
  if (error) {
    console.error(
      '[changementsPourDecisions] lecture des gardes impossible, contrôle des règles ignoré :',
      error.message,
    )
    return []
  }
  if (!data) return []

  type Row = {
    id: string
    periode_id: string | null
    premier_id: string | null
    second_id: string | null
  }
  const base: ChangementGardeSitue[] = (data as Row[])
    .filter((g): g is Row & { periode_id: string } => Boolean(g.periode_id))
    .map((g) => ({
      gardeId: g.id,
      periodeId: g.periode_id,
      premier_id: g.premier_id,
      second_id: g.second_id,
    }))

  // Plusieurs décisions peuvent viser LA MÊME garde (les deux rôles d'un même
  // créneau) : la fusion les empile sur un seul changement — sinon la seconde
  // effacerait la première et on jugerait un état qui n'existera jamais.
  return fusionnerChangementsParGarde(base, decisions)
}
