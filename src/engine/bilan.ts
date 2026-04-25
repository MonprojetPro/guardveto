// ============================================================
// GUARDVETO — Bilan de période : calcul des bonus/malus
// ============================================================
// Calcul pur (sans accès DB) des écarts par rapport à la
// quote-part théorique pour une période terminée.
//
// Convention :
//   écart > 0 = a fait PLUS que sa part → malus (fera moins après)
//   écart < 0 = a fait MOINS que sa part → bonus (fera plus après)
// ============================================================

import type { CompteursRow } from '@/hooks/useCompteurs'

// ── Types exportés ───────────────────────────────────────

export interface BilanVet {
  veterinaire_id: string
  prenom: string
  nom: string
  couleur: string
  statut: 'associe' | 'salarie'
  // Week-ends
  we_realise: number
  we_quota: number        // quota flottant (pour affichage)
  ecart_we: number        // entier arrondi → stocké en DB
  // Semaine
  sem_realise: number
  sem_quota: number
  ecart_semaine: number
  // Fériés
  feries_realise: number
  feries_quota: number
  ecart_feries: number
  // Grands WE libres (salariés uniquement — 0 pour les associés)
  grands_we_realise: number
  grands_we_quota: number
  ecart_grands_we: number
}

// ── Calcul ───────────────────────────────────────────────

/**
 * calculerBilans — Calcule les écarts par rapport à la quote-part
 * théorique pour chaque vétérinaire d'une période.
 *
 * @param compteurs  Compteurs de la vue compteurs_gardes
 * @param totalWE    Nombre total de week-ends dans la période
 */
export function calculerBilans(
  compteurs: CompteursRow[],
  totalWE: number
): BilanVet[] {
  if (compteurs.length === 0) return []

  const n = compteurs.length

  // Moyennes globales
  const moyWE      = compteurs.reduce((s, r) => s + r.we_total,       0) / n
  const moySem     = compteurs.reduce((s, r) => s + r.sem_total,      0) / n
  const moyFeries  = compteurs.reduce((s, r) => s + r.feries_total,   0) / n

  // Grands WE libres uniquement pour les salariés
  const salaries = compteurs.filter((r) => r.statut === 'salarie')
  const nbSalaries = salaries.length
  const moyGrandsWE = nbSalaries > 0
    ? salaries.reduce((s, r) => s + Math.max(0, totalWE - r.we_total), 0) / nbSalaries
    : 0

  return compteurs.map((row): BilanVet => {
    const grandsWeRealise = row.statut === 'salarie'
      ? Math.max(0, totalWE - row.we_total)
      : 0

    return {
      veterinaire_id: row.veterinaire_id,
      prenom: row.prenom,
      nom: row.nom,
      couleur: row.couleur,
      statut: row.statut,
      // Week-ends
      we_realise: row.we_total,
      we_quota: parseFloat(moyWE.toFixed(2)),
      ecart_we: Math.round(row.we_total - moyWE),
      // Semaine
      sem_realise: row.sem_total,
      sem_quota: parseFloat(moySem.toFixed(2)),
      ecart_semaine: Math.round(row.sem_total - moySem),
      // Fériés
      feries_realise: row.feries_total,
      feries_quota: parseFloat(moyFeries.toFixed(2)),
      ecart_feries: Math.round(row.feries_total - moyFeries),
      // Grands WE
      grands_we_realise: grandsWeRealise,
      grands_we_quota: row.statut === 'salarie' ? parseFloat(moyGrandsWE.toFixed(2)) : 0,
      ecart_grands_we: row.statut === 'salarie'
        ? Math.round(grandsWeRealise - moyGrandsWE)
        : 0,
    }
  })
}
