// ============================================================
// GUARDVETO — Aval générique : équivalence + contre-preuve V2 (P6, ÉTAPE 1)
// ============================================================
// Prouve que la dérivation GÉNÉRIQUE (pilotée par les relations) reproduit
// byte-à-byte l'ancienne magie R8 sur le DÉFAUT, et se comporte correctement
// quand un cabinet PILOTE ses relations (inversion coupée / découplage total).
//
// CONTRE-PREUVE V2 (la plus forte) : le moteur produit DÉJÀ le `vendredi_soir`
// explicite (V2 = vérité), déjà inversé par les relations. On génère un vrai
// planning, on le PROJETTE en V1 (week-end sur le samedi, vendredi supprimé),
// on RECONSTRUIT le vendredi depuis V1 par les relations, et on vérifie qu'il
// matche EXACTEMENT le vendredi que le moteur avait posé.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  reconstruireWeekend,
  resoudrePlanningAffichage,
  placementsVendrediLie,
  ordonnerSourceLiee,
  type GardeRowAval,
} from '@/engine/aval/resoudrePlanningAffichage'
import { gardesVersPlanningPartiel, type GardeRow } from '@/engine/validation/gardesVersPlanning'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import type { Placement, VetEngine, AttributionGarde } from '@/engine/types'
import type { RelationStructure } from '@/engine/structure-config'

const HISTORIQUE = undefined // → RELATIONS_STRUCTURE_DEFAUT (couple câblé)

// ── 1. Équivalence byte-identique avec l'ancienne magie ──
describe('reconstruireWeekend — équivalent byte-identique à gardesVersPlanningPartiel', () => {
  const GARDES: GardeRow[] = [
    { date: '2026-01-03', type: 'weekend', premier_id: 'A', second_id: 'B' },
    { date: '2026-01-10', type: 'weekend', premier_id: 'C', second_id: 'D' },
  ]

  it('week-end : reconstruction générique = ancienne synthèse (vendredi inversé)', () => {
    for (const g of GARDES) {
      const gen = reconstruireWeekend(g as GardeRowAval, { relations: HISTORIQUE })
      const ancien = gardesVersPlanningPartiel([g]).attributions
      // Même contenu (ordre indifférent).
      const tri = (xs: AttributionGarde[]) =>
        [...xs].sort((a, b) => (a.type < b.type ? -1 : 1))
      expect(tri(gen)).toEqual(tri(ancien))
    }
  })
})

// ── 2. Pilotabilité : la donnée fait foi ──
describe('placementsVendrediLie — pilotable par les relations', () => {
  const we: Placement[] = [
    { role: 'premier', vetId: 'A' },
    { role: 'second', vetId: 'B' },
  ]
  const rel = (genre: RelationStructure['genre']): RelationStructure => ({
    sourceCode: 'vendredi_soir', cibleCode: 'weekend', genre,
  })

  it('défaut (meme_binome + inversion) → vendredi INVERSÉ (B,A)', () => {
    expect(placementsVendrediLie(we, [rel('meme_binome'), rel('inversion_role')])).toEqual([
      { role: 'premier', vetId: 'B' },
      { role: 'second', vetId: 'A' },
    ])
  })

  it('inversion COUPÉE (meme_binome seul) → vendredi = même rôles que le WE (A,B)', () => {
    expect(placementsVendrediLie(we, [rel('meme_binome')])).toEqual([
      { role: 'premier', vetId: 'A' },
      { role: 'second', vetId: 'B' },
    ])
  })

  it('découplage total (relations = []) → vendredi NON matérialisé (null)', () => {
    expect(placementsVendrediLie(we, [])).toBeNull()
  })

  it('kernel générique ordonnerSourceLiee : réversion vs copie selon les genres', () => {
    expect(ordonnerSourceLiee(['A', 'B'], [rel('meme_binome'), rel('inversion_role')], 'vendredi_soir', 'weekend')).toEqual(['B', 'A'])
    expect(ordonnerSourceLiee(['A', 'B'], [rel('meme_binome')], 'vendredi_soir', 'weekend')).toEqual(['A', 'B'])
    expect(ordonnerSourceLiee(['A', 'B'], [], 'vendredi_soir', 'weekend')).toBeNull()
  })
})

// ── 3. resoudrePlanningAffichage — grille complète (ven/sam/dim) ──
describe('resoudrePlanningAffichage — grille d\'affichage', () => {
  it('un week-end → 3 cellules : vendredi (lié inversé), samedi (natif), dimanche (continuation)', () => {
    const grille = resoudrePlanningAffichage([
      { id: 'g1', date: '2026-01-03', type: 'weekend', premier_id: 'A', second_id: 'B' },
    ])
    expect(grille).toEqual([
      { gardeId: 'g1', date: '2026-01-02', type: 'vendredi_soir', origine: 'lie', placements: [{ role: 'premier', vetId: 'B' }, { role: 'second', vetId: 'A' }] },
      { gardeId: 'g1', date: '2026-01-03', type: 'weekend', origine: 'native', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
      { gardeId: 'g1', date: '2026-01-04', type: 'weekend', origine: 'continuation', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
    ])
  })

  it('une garde de semaine → 1 cellule native, pas de continuation', () => {
    const grille = resoudrePlanningAffichage([
      { id: 'g2', date: '2026-01-06', type: 'semaine', premier_id: 'A', second_id: 'B' },
    ])
    expect(grille).toEqual([
      { gardeId: 'g2', date: '2026-01-06', type: 'semaine_soir', origine: 'native', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
    ])
  })
})

// ── 4. CONTRE-PREUVE V2 : reconstruction V1 == vendredi que le moteur pose ──
describe('contre-preuve V2 — le vendredi reconstruit matche le vendredi du moteur', () => {
  const vets: VetEngine[] = Array.from({ length: 6 }, (_, i) => ({
    id: `v${i + 1}`, nom: `N${i + 1}`, prenom: `P${i + 1}`, statut: 'associe',
    dernier_recours: false, contraintes: [], conges: [],
  }))
  const input: SolverInput = {
    dateDebut: '2026-01-05', dateFin: '2026-02-15', saison: 'hiver',
    vets, bonusMalus: {},
  }
  const res = genererPlanningPur(input)

  const vet = (a: AttributionGarde | undefined, role: string) =>
    a?.placements.find((p) => p.role === role)?.vetId ?? null

  it('le moteur produit bien des vendredi_soir explicites (V2)', () => {
    expect(res.success).toBe(true)
    if (!res.success) return
    const vendredis = res.planning.attributions.filter((a) => a.type === 'vendredi_soir')
    expect(vendredis.length).toBeGreaterThan(0)
  })

  it('projeter en V1 puis reconstruire → vendredi byte-identique au moteur', () => {
    expect(res.success).toBe(true)
    if (!res.success) return
    const planning = res.planning.attributions

    // Projection V1 : le week-end (samedi) devient une GardeRow ; le vendredi
    // n'existe PAS en V1 (il sera reconstruit).
    const weekends = planning.filter((a) => a.type === 'weekend')
    expect(weekends.length).toBeGreaterThan(0)

    for (const we of weekends) {
      const gardeV1: GardeRowAval = {
        date: we.date, type: 'weekend',
        premier_id: vet(we, 'premier'), second_id: vet(we, 'second'),
      }
      const recon = reconstruireWeekend(gardeV1, { relations: HISTORIQUE })
      const venRecon = recon.find((a) => a.type === 'vendredi_soir')!

      // Le vendredi que le moteur avait réellement posé (V2 = vérité).
      const venMoteur = planning.find((a) => a.type === 'vendredi_soir' && a.date === venRecon.date)
      expect(venMoteur, `vendredi moteur absent pour ${venRecon.date}`).toBeDefined()
      expect(vet(venRecon, 'premier')).toBe(vet(venMoteur, 'premier'))
      expect(vet(venRecon, 'second')).toBe(vet(venMoteur, 'second'))
    }
  })
})
