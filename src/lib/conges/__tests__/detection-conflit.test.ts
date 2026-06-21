// ============================================================
// Tests — detecterConflitPlanningPublie (LOT A3)
// ============================================================
// On teste la LOGIQUE DE DÉCISION du service en isolant le recensement :
// `recenserCreneauxImpactes` est mocké. Le filtrage réel (cabinet, rôle,
// statut publié/verrouillé vs brouillon, futur) est déjà couvert par la
// source `src/lib/crise/contexte.ts` ; ici on vérifie que le service en
// dérive correctement `aConflit` + propage les créneaux, et qu'il fail-open
// proprement si le recensement échoue.
//
// Cas couverts :
//   (a) une garde publiée chevauche la plage → aConflit:true + le bon créneau
//   (b) aucune garde dans la plage          → aConflit:false
//   (c) garde en période brouillon          → recenserCreneauxImpactes la filtre
//       déjà (retourne []) → aConflit:false (on prouve la délégation)
//   (d) le recensement throw                → fail-open : aConflit:false, pas de throw
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CreneauImpacte } from '@/lib/crise/contexte'

// Mock de la source de recensement (réutilisée par le service).
vi.mock('@/lib/crise/contexte', () => ({
  recenserCreneauxImpactes: vi.fn(),
}))

import { recenserCreneauxImpactes } from '@/lib/crise/contexte'
import { detecterConflitPlanningPublie } from '@/lib/conges/detection-conflit'

const recenserMock = vi.mocked(recenserCreneauxImpactes)

// Client Supabase factice : jamais utilisé réellement (le recensement est mocké).
const supabaseFake = {} as Parameters<typeof detecterConflitPlanningPublie>[0]['supabase']

const baseParams = {
  supabase: supabaseFake,
  cabinetId: 'cab-1',
  veterinaireId: 'antoine',
  dateDebut: '2026-07-06',
  dateFin: '2026-07-12',
}

function creneau(partial: Partial<CreneauImpacte> = {}): CreneauImpacte {
  return {
    gardeId: 'garde-1',
    date: '2026-07-08',
    type: 'weekend',
    typeEngine: 'weekend',
    role: 'premier',
    saison: 'ete',
    periodeId: 'per-1',
    ...partial,
  }
}

beforeEach(() => {
  recenserMock.mockReset()
})

describe('detecterConflitPlanningPublie', () => {
  it('(a) garde publiée chevauchant la plage → aConflit:true avec le bon créneau', async () => {
    const impacte = creneau({ gardeId: 'g-antoine', date: '2026-07-08', role: 'premier' })
    recenserMock.mockResolvedValue([impacte])

    const res = await detecterConflitPlanningPublie(baseParams)

    expect(res.aConflit).toBe(true)
    expect(res.creneauxImpactes).toEqual([impacte])
    // La délégation passe bien les bons arguments positionnels.
    expect(recenserMock).toHaveBeenCalledWith(
      supabaseFake,
      'cab-1',
      'antoine',
      '2026-07-06',
      '2026-07-12',
    )
  })

  it('(b) aucune garde dans la plage → aConflit:false', async () => {
    recenserMock.mockResolvedValue([])

    const res = await detecterConflitPlanningPublie(baseParams)

    expect(res.aConflit).toBe(false)
    expect(res.creneauxImpactes).toEqual([])
  })

  it('(c) garde en période brouillon → filtrée par le recensement → aConflit:false', async () => {
    // recenserCreneauxImpactes filtre déjà les brouillons (statut != publie/verrouille)
    // → renvoie [] même s'il existe une garde sur ce véto dans un planning brouillon.
    recenserMock.mockResolvedValue([])

    const res = await detecterConflitPlanningPublie(baseParams)

    expect(res.aConflit).toBe(false)
    expect(res.creneauxImpactes).toEqual([])
  })

  it('(d) recensement en erreur → fail-open : aConflit:false, sans throw', async () => {
    recenserMock.mockRejectedValue(new Error('Erreur lecture des gardes impactées : boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await detecterConflitPlanningPublie(baseParams)

    expect(res.aConflit).toBe(false)
    expect(res.creneauxImpactes).toEqual([])
    expect(spy).toHaveBeenCalled()

    spy.mockRestore()
  })
})
