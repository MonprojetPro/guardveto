// ============================================================
// GUARDVETO — Chargeur de la config roulement PAR CABINET (Fondation B)
// ============================================================
// Lit la table `roulement_place` et produit une RoulementCabinet (map
// code:role → réglage). BEST-EFFORT : pas de cabinetId / table absente /
// erreur → map vide = tout est généré (comportement actuel).
//
// Prend le client Supabase en paramètre (server OU client déjà instancié).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypeGardeEngine, RoleGarde } from '@/engine/types'
import {
  type RoulementCabinet,
  type RoulementPlace,
  type PolitiqueConge,
  type ModePlace,
  clePlace,
} from '@/engine/roulement'

interface RoulementRow {
  code: string
  role: string
  mode: string
  politique_conge: string
  sequence_vets: string[] | null
  position_reprise: number
  actif: boolean
}

const CODES_VALIDES: TypeGardeEngine[] = ['semaine_soir', 'vendredi_soir', 'weekend', 'ferie']
const ROLES_VALIDES: RoleGarde[] = ['premier', 'second']

export async function chargerRoulementCabinet(
  supabase: SupabaseClient,
  cabinetId?: string,
): Promise<RoulementCabinet> {
  const map: RoulementCabinet = new Map()
  if (!cabinetId) return map

  const { data, error } = await supabase
    .from('roulement_place')
    .select('code, role, mode, politique_conge, sequence_vets, position_reprise, actif')
    .eq('cabinet_id', cabinetId)

  if (error || !data) return map

  for (const row of data as RoulementRow[]) {
    if (!CODES_VALIDES.includes(row.code as TypeGardeEngine)) continue
    if (!ROLES_VALIDES.includes(row.role as RoleGarde)) continue
    const mode: ModePlace = row.mode === 'roulement' ? 'roulement' : 'genere'
    const politiqueConge: PolitiqueConge = row.politique_conge === 'garde_place' ? 'garde_place' : 'saute'
    const place: RoulementPlace = {
      code: row.code as TypeGardeEngine,
      role: row.role as RoleGarde,
      mode,
      politiqueConge,
      sequenceVets: row.sequence_vets ?? [],
      positionReprise: row.position_reprise ?? 0,
      actif: row.actif,
    }
    map.set(clePlace(place.code, place.role), place)
  }

  return map
}
