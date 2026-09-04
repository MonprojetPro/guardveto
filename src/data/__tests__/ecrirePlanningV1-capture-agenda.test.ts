// ============================================================
// GUARDVETO — Les identifiants d'agenda se lisent AVANT le DELETE (B-079)
// ============================================================
// `garde_evenements.garde_id` est en `ON DELETE CASCADE`. Lire les identifiants
// après la suppression des gardes ne rend donc pas une liste incomplète : elle
// rend une liste VIDE, sans la moindre erreur. La purge de l'agenda ne
// supprimerait rien, et la cliente garderait des dizaines de gardes dans son
// agenda que plus rien dans le logiciel ne peut retirer.
//
// Un commentaire ne protège pas cet ordre : il suffit qu'on déplace deux lignes.
// Le faux Supabase ci-dessous REPRODUIT LE CASCADE — c'est ce qui rend le test
// capable d'échouer si l'ordre s'inverse un jour.
//
// La deuxième chose vérifiée ici est le SCOPE : une garde verrouillée survit au
// DELETE, purger ses événements effacerait de l'agenda des gardes valides.
// ============================================================

import { describe, it, expect, vi } from 'vitest'

// Best-effort et hors sujet ici : le miroir des placements et le réalignement V2.
vi.mock('@/data/gardePlacements', () => ({ construireGardePlacements: () => [] }))
vi.mock('@/data/syncAttributions', () => ({
  syncAttributionsPourJours: async () => ({ ok: true }),
  joursImpactesGarde: (date: string) => [date],
}))

import { ecrirePlanningV1 } from '../ecrirePlanningV1'
import type { PlanningPartiel } from '@/engine/types'

const PERIODE = 'per-1'
const CABINET = 'cab-1'

type Ligne = Record<string, unknown>

/**
 * Faux Supabase — minimal, mais avec LE CASCADE, qui est tout l'enjeu.
 * Un faux qui l'ignorerait laisserait passer exactement le défaut visé.
 */
function creerSupabase(tables: Record<string, Ligne[]>) {
  const correspond = (l: Ligne, f: Array<[string, unknown, 'eq' | 'in' | 'neq']>) =>
    f.every(([c, v, op]) => {
      if (op === 'in') return (v as unknown[]).includes(l[c])
      // B-111 — `neq('places_figees', '{}')` : côté PostgREST, `{}` désigne le
      // tableau VIDE, pas la chaîne. On reproduit la comparaison sur le tableau,
      // sinon toute garde sans cadenas passerait le filtre et le test mesurerait
      // autre chose que la réalité.
      if (op === 'neq') {
        if (v === '{}') return Array.isArray(l[c]) ? (l[c] as unknown[]).length > 0 : Boolean(l[c])
        return l[c] !== v
      }
      return l[c] === v
    })

  function requete(nom: string) {
    const filtres: Array<[string, unknown, 'eq' | 'in' | 'neq']> = []
    let mode: 'select' | 'delete' | 'upsert' = 'select'

    const executer = () => {
      const lignes = tables[nom] ?? (tables[nom] = [])
      if (mode === 'delete') {
        const partantes = lignes.filter((l) => correspond(l, filtres))
        tables[nom] = lignes.filter((l) => !correspond(l, filtres))
        // ⚠️ LE CASCADE, reproduit : supprimer une garde emporte ses événements.
        if (nom === 'gardes') {
          const ids = partantes.map((g) => g.id)
          tables.garde_evenements = (tables.garde_evenements ?? [])
            .filter((e) => !ids.includes(e.garde_id))
        }
        return { data: null, error: null }
      }
      if (mode === 'upsert') return { data: null, error: null }
      return { data: lignes.filter((l) => correspond(l, filtres)).map((l) => ({ ...l })), error: null }
    }

    const api = {
      select: () => api,
      eq: (c: string, v: unknown) => { filtres.push([c, v, 'eq']); return api },
      in: (c: string, v: unknown[]) => { filtres.push([c, v, 'in']); return api },
      neq: (c: string, v: unknown) => { filtres.push([c, v, 'neq']); return api },
      not: () => api,
      delete: () => { mode = 'delete'; return api },
      upsert: () => { mode = 'upsert'; return api },
      then: (r: (v: unknown) => unknown) => Promise.resolve(executer()).then(r),
    }
    return api
  }
  return { from: (n: string) => requete(n) } as never
}

const PLANNING_VIDE: PlanningPartiel = { attributions: [] } as unknown as PlanningPartiel

function base() {
  return {
    gardes: [
      { id: 'g-1', periode_id: PERIODE, cabinet_id: CABINET, verrouille: false, date: '2026-09-29', type: 'semaine', google_event_id: 'ancien-1' },
      { id: 'g-2', periode_id: PERIODE, cabinet_id: CABINET, verrouille: false, date: '2026-10-03', type: 'weekend', google_event_id: null },
      // Verrouillée : elle SURVIT au DELETE, ses événements doivent survivre aussi.
      { id: 'g-verrou', periode_id: PERIODE, cabinet_id: CABINET, verrouille: true, date: '2026-09-22', type: 'semaine', google_event_id: null },
    ] as Ligne[],
    garde_evenements: [
      { garde_id: 'g-1', jour: '2026-09-29', place_index: 0, google_event_id: 'ev-1' },
      { garde_id: 'g-1', jour: '2026-09-29', place_index: 1, google_event_id: 'ev-2' },
      { garde_id: 'g-2', jour: '2026-10-02', place_index: 0, google_event_id: 'ev-3' },
      { garde_id: 'g-verrou', jour: '2026-09-22', place_index: 0, google_event_id: 'ev-verrou' },
    ] as Ligne[],
    garde_placements: [] as Ligne[],
  }
}

describe('B-079 — capture des identifiants d’agenda avant le DELETE', () => {
  it('rend les DEUX sources : l’ancien format ET les événements par jour', async () => {
    const tables = base()
    const r = await ecrirePlanningV1(creerSupabase(tables), PLANNING_VIDE, PERIODE, CABINET)

    expect(r.ok).toBe(true)
    // Si la lecture se faisait après le DELETE, le cascade aurait déjà emporté
    // ev-1/2/3 et cette liste ne contiendrait que l'ancien identifiant.
    expect(new Set(r.eventIdsAPurger)).toEqual(new Set(['ancien-1', 'ev-1', 'ev-2', 'ev-3']))
  })

  it('le cascade a bien eu lieu — donc lire après aurait rendu une liste vide', () => {
    // Garde-fou du garde-fou : si le faux Supabase cessait de simuler le
    // cascade, le test ci-dessus passerait sans plus rien prouver.
    const tables = base()
    const avant = tables.garde_evenements.length
    return ecrirePlanningV1(creerSupabase(tables), PLANNING_VIDE, PERIODE, CABINET).then(() => {
      expect(avant).toBe(4)
      // Seuls les événements de la garde VERROUILLÉE ont survécu.
      expect(tables.garde_evenements.map((e) => e.google_event_id)).toEqual(['ev-verrou'])
    })
  })

  it('une garde VERROUILLÉE n’est pas purgée : elle survit au DELETE', async () => {
    const tables = base()
    const r = await ecrirePlanningV1(creerSupabase(tables), PLANNING_VIDE, PERIODE, CABINET)

    // Purger `ev-verrou` effacerait de l'agenda une garde toujours valide.
    expect(r.eventIdsAPurger).not.toContain('ev-verrou')
  })
})
