'use client'

import { useMemo } from 'react'
import type { GardeDenormalisee, Periode } from '@/types'

/**
 * usePeriodeActuelle — Retourne la période principale affichée
 * en se basant sur les gardes et la liste des périodes connues.
 *
 * Priorité : période publiée > brouillon > verrouillée.
 * Si plusieurs périodes couvrent le mois, retourne la plus récente.
 */
export function usePeriodeActuelle(
  gardes: GardeDenormalisee[],
  periodes: Periode[]
): Periode | null {
  return useMemo(() => {
    if (gardes.length === 0 || periodes.length === 0) return null

    // Extraire les periode_id uniques des gardes affichées
    const periodeIds = new Set(gardes.map((g) => g.periode_id))

    // Filtrer les périodes qui ont des gardes dans le mois courant
    const periodesDuMois = periodes.filter((p) => periodeIds.has(p.id))

    if (periodesDuMois.length === 0) return null

    // Prioriser : publiée > brouillon > verrouillée
    const ordre = { publie: 0, brouillon: 1, verrouille: 2 }
    return periodesDuMois.sort((a, b) => {
      const diff = ordre[a.statut] - ordre[b.statut]
      if (diff !== 0) return diff
      // À statut égal, la plus récente en premier
      return b.date_debut.localeCompare(a.date_debut)
    })[0]
  }, [gardes, periodes])
}
