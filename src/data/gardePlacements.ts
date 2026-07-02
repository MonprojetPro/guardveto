// ============================================================
// GUARDVETO — Double écriture des placements (P3b slice 1)
// ============================================================
// Couche PURE (aucun accès réseau) qui construit les lignes `garde_placements`
// à partir des attributions qu'on vient d'écrire dans `gardes`. Une ligne par
// PLACE POURVUE (les places vides sont ignorées, comme second_id NULL en V1).
//
// P3b-1 = « on ajoute » : ces lignes doublent premier_id/second_id sans qu'aucun
// lecteur ne les consomme encore → additif, réversible, sans effet visuel. La
// résolution (date|type_db) → garde_id est faite par l'appelant (il connaît les
// ids des gardes réellement écrites).
// ============================================================

/** Une attribution persistée dans `gardes`, avec sa clé de type côté DB. */
export interface AttributionPersistee {
  date: string
  /** Type tel que stocké dans gardes.type ('semaine' | 'weekend' | 'ferie'). */
  dbType: string
  placements: { role: string; vetId: string | null }[]
}

/** Une ligne prête pour l'insert dans `garde_placements`. */
export interface GardePlacementRow {
  cabinet_id: string
  garde_id: string
  place_index: number
  role: string
  veterinaire_id: string
}

/**
 * construireGardePlacements — miroir des placements pourvus vers garde_placements.
 * `idParCle` : Map `${date}|${dbType}` → garde_id (les gardes réellement écrites).
 * Une attribution sans garde_id résolu est ignorée (garde verrouillée non réécrite).
 * PUR & déterministe → testable sans base.
 */
export function construireGardePlacements(
  attributions: AttributionPersistee[],
  idParCle: Map<string, string>,
  cabinetId: string,
): GardePlacementRow[] {
  const rows: GardePlacementRow[] = []
  for (const a of attributions) {
    const gardeId = idParCle.get(`${a.date}|${a.dbType}`)
    if (!gardeId) continue
    a.placements.forEach((p, index) => {
      if (!p.vetId) return // place non pourvue → pas de ligne (comme second_id NULL)
      rows.push({
        cabinet_id: cabinetId,
        garde_id: gardeId,
        place_index: index,
        role: p.role,
        veterinaire_id: p.vetId,
      })
    })
  }
  return rows
}
