// ============================================================
// Tests — Gestion de crise (Lot 2) : réparation CIBLÉE d'UN créneau.
// ============================================================
// On vérifie :
//   (a) un seul véto légal sur le créneau → il est proposé (et recommandé) ;
//   (b) l'absent X est toujours exclu ;
//   (c) aucun candidat légal → meilleur=null + diagnostic non vide ;
//   (d) cohérence STRUCTURE : un candidat qui violerait R8/R9 n'est PAS proposé.
// ============================================================

import { describe, it, expect } from 'vitest'
import { proposerReparation } from '../reparer'
import type { VetEngine, AttributionGarde } from '../../types'
import { DEFAULT_STRUCTURE_CONFIG } from '../../structure-config'

// ── Fixtures ─────────────────────────────────────────────

function vet(id: string, prenom: string, over: Partial<VetEngine> = {}): VetEngine {
  return {
    id,
    nom: prenom.toUpperCase(),
    prenom,
    statut: 'associe',
    dernier_recours: false,
    contraintes: [],
    conges: [],
    ...over,
  }
}

const LUNDI = '2025-11-03'
const MARDI = '2025-11-04'
const VENDREDI = '2025-11-07'
const SAMEDI = '2025-11-08'

describe('proposerReparation — réparation ciblée d’UN créneau', () => {
  // (a) Un seul véto réellement légal → il est proposé et recommandé.
  it('(a) propose l’unique véto légal pour le créneau libéré', () => {
    // Créneau semaine_soir mardi, rôle premier libéré par l'absence de A.
    // B est en congé → seul C est légal. (effectif 1 en été : pas de 2nd.)
    const vets = [
      vet('A', 'Alice'),
      vet('B', 'Bob', {
        conges: [{ date_debut: LUNDI, date_fin: '2025-11-30', type: 'vacances' }],
      }),
      vet('C', 'Carla'),
    ]
    const planningComplet: AttributionGarde[] = [
      { date: MARDI, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: null }] },
    ]

    const res = proposerReparation({
      creneau: { date: MARDI, type: 'semaine_soir', role: 'premier', saison: 'ete', besoinSecond: false },
      absentId: 'A',
      vets,
      planningComplet,
      structure: DEFAULT_STRUCTURE_CONFIG,
    })

    expect(res.meilleur).toBe('C')
    expect(res.candidats.map((c) => c.vetId)).toEqual(['C'])
    expect(res.candidats.every((c) => c.score !== undefined)).toBe(true)
  })

  // (b) L'absent X n'apparaît jamais dans les candidats.
  it('(b) exclut toujours l’absent des candidats', () => {
    const vets = [vet('A', 'Alice'), vet('C', 'Carla')]
    const planningComplet: AttributionGarde[] = [
      { date: MARDI, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: null }] },
    ]

    const res = proposerReparation({
      creneau: { date: MARDI, type: 'semaine_soir', role: 'premier', saison: 'ete', besoinSecond: false },
      absentId: 'A',
      vets,
      planningComplet,
    })

    expect(res.candidats.map((c) => c.vetId)).not.toContain('A')
    expect(res.meilleur).toBe('C')
  })

  // (c) Aucun candidat légal → meilleur=null + diagnostic non vide.
  it('(c) renvoie meilleur=null + diagnostic quand aucun véto n’est légal', () => {
    // A absent. Tous les autres en congé sur le créneau → personne de légal.
    const vets = [
      vet('A', 'Alice'),
      vet('B', 'Bob', {
        conges: [{ date_debut: LUNDI, date_fin: '2025-11-30', type: 'vacances' }],
      }),
      vet('C', 'Carla', {
        conges: [{ date_debut: LUNDI, date_fin: '2025-11-30', type: 'vacances' }],
      }),
    ]
    const planningComplet: AttributionGarde[] = [
      { date: MARDI, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: null }] },
    ]

    const res = proposerReparation({
      creneau: { date: MARDI, type: 'semaine_soir', role: 'premier', saison: 'ete', besoinSecond: false },
      absentId: 'A',
      vets,
      planningComplet,
    })

    expect(res.candidats).toEqual([])
    expect(res.meilleur).toBeNull()
    expect(res.diagnostic).toBeDefined()
    expect(res.diagnostic!.reglesEnCause.length).toBeGreaterThan(0)
    expect(res.diagnostic!.creneauBloquant.role).toBe('premier')
    expect(res.diagnostic!.creneauBloquant.date).toBe(MARDI)
  })

  // (d) COHÉRENCE STRUCTURE : un candidat hors-duo (qui violerait R9) n'est PAS
  // proposé tant que la structure R8/R9 est fournie (mêmes règles qu'à la génération).
  it('(d) n’ouvre PAS le créneau WE à un véto hors-duo quand R9 est fermes', () => {
    // Vendredi soir = duo (A 1er, B 2nd). R9 impose le même duo au WE.
    // WE = A 1er, B 2nd ; A s'absente → le 1er du WE se libère.
    // Candidats pour le 1er WE :
    //   • C (hors du duo vendredi) → R9 le bloque (pas dans le duo).
    //   • B (partenaire, déjà 2nd du WE) → R21 le bloque (1er ≠ 2nd).
    // Conséquence STRUCTURELLE réelle : un rôle WE libéré n'est pas réparable par
    // simple substitution tant que R8/R9 sont fermes → meilleur=null + diagnostic.
    const vets = [vet('A', 'Alice'), vet('B', 'Bob'), vet('C', 'Carla')]
    const planningComplet: AttributionGarde[] = [
      { date: VENDREDI, type: 'vendredi_soir', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
      { date: SAMEDI, type: 'weekend', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
    ]

    const res = proposerReparation({
      creneau: { date: SAMEDI, type: 'weekend', role: 'premier', saison: 'hiver' },
      absentId: 'A',
      vets,
      planningComplet,
      structure: DEFAULT_STRUCTURE_CONFIG, // R8/R9 fermes — MÊME config qu'à la génération
    })

    // C (hors-duo) n'est jamais proposé → cohérence R9 prouvée.
    expect(res.candidats.map((c) => c.vetId)).not.toContain('C')
    expect(res.meilleur).toBeNull()
    expect(res.diagnostic).toBeDefined()
  })

  // (d-bis) Sans la structure (R8/R9 désactivées), un candidat hors-duo redevient
  // proposable → prouve que c'est bien la STRUCTURE qui filtrait, pas un hasard.
  it('(d-bis) avec R8/R9 désactivées, le candidat hors-duo redevient légal', () => {
    const vets = [vet('A', 'Alice'), vet('B', 'Bob'), vet('C', 'Carla')]
    const planningComplet: AttributionGarde[] = [
      { date: VENDREDI, type: 'vendredi_soir', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
      { date: SAMEDI, type: 'weekend', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
    ]

    const res = proposerReparation({
      creneau: { date: SAMEDI, type: 'weekend', role: 'premier', saison: 'hiver' },
      absentId: 'A',
      vets,
      planningComplet,
      structure: {
        r8_inversion: { actif: false, etage: 2 },
        r9_liaison: { actif: false, etage: 2 },
      },
    })

    // R8/R9 off → C (hors-duo) devient un candidat légal pour le 1er du WE.
    expect(res.candidats.map((c) => c.vetId)).toContain('C')
  })
})
