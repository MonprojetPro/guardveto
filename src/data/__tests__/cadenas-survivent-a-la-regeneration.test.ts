// ============================================================
// B-111 — LES CADENAS SURVIVENT À LA RÉGÉNÉRATION
// ============================================================
// LE DÉFAUT QUE CE TEST EMPÊCHE, ET POURQUOI IL AURAIT ÉTÉ INVISIBLE.
//
// `ecrirePlanningV1` supprime les gardes de la période puis les réinsère. Une
// garde cadenassée par l'admin n'est PAS `verrouille` (ce booléen porte la
// protection automatique des gardes passées/publiées) : elle passe donc par ce
// DELETE, et sans reprise explicite ses cadenas repartiraient à vide.
//
// Le symptôme aurait été le plus trompeur possible : le planning resterait
// JUSTE — le moteur a bien composé autour des places figées, elles sont dans ce
// qu'il rend — mais les cadenas auraient disparu de l'écran. À la génération
// suivante, plus rien ne serait fixé, et l'admin, qui vient de voir son choix
// respecté, n'aurait aucune raison de re-vérifier.
// ============================================================

import { describe, it, expect } from 'vitest'
import { ecrirePlanningV1 } from '../ecrirePlanningV1'
import type { PlanningPartiel } from '@/engine/types'

const PERIODE = 'periode-1'
const CABINET = 'cabinet-1'

type Ligne = Record<string, unknown>

/**
 * Faux Supabase minimal, qui CAPTURE ce qui est envoyé à l'upsert — c'est la
 * seule chose que ce test veut voir.
 */
function creerSupabase(gardes: Ligne[]) {
  const upserts: Ligne[] = []

  function requete(nom: string) {
    const filtres: Array<[string, unknown, 'eq' | 'neq' | 'in']> = []
    let mode: 'select' | 'delete' | 'upsert' = 'select'

    const correspond = (l: Ligne) =>
      filtres.every(([c, v, op]) => {
        if (op === 'in') return (v as unknown[]).includes(l[c])
        if (op === 'neq') {
          if (v === '{}') return Array.isArray(l[c]) ? (l[c] as unknown[]).length > 0 : Boolean(l[c])
          return l[c] !== v
        }
        return l[c] === v
      })

    const executer = () => {
      if (mode === 'delete') return { data: null, error: null }
      if (mode === 'upsert') return { data: null, error: null }
      if (nom !== 'gardes') return { data: [], error: null }
      return { data: gardes.filter(correspond).map((l) => ({ ...l })), error: null }
    }

    const api = {
      select: () => api,
      eq: (c: string, v: unknown) => { filtres.push([c, v, 'eq']); return api },
      neq: (c: string, v: unknown) => { filtres.push([c, v, 'neq']); return api },
      in: (c: string, v: unknown[]) => { filtres.push([c, v, 'in']); return api },
      not: () => api,
      delete: () => { mode = 'delete'; return api },
      // On ne capture QUE les écritures de `gardes` : l'étape du miroir
      // `garde_placements` passe par le même verbe et polluerait la mesure.
      upsert: (rows: Ligne[]) => {
        mode = 'upsert'
        if (nom === 'gardes') upserts.push(...rows)
        return api
      },
      then: (r: (v: unknown) => unknown) => Promise.resolve(executer()).then(r),
    }
    return api
  }

  return { client: { from: (n: string) => requete(n) } as never, upserts }
}

const PLANNING: PlanningPartiel = {
  attributions: [
    {
      date: '2026-09-28', type: 'semaine_soir',
      placements: [{ role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v2' }],
    },
    {
      date: '2026-10-03', type: 'weekend',
      placements: [{ role: 'premier', vetId: 'v3' }, { role: 'second', vetId: 'v4' }],
    },
  ],
}

describe('les cadenas de l’admin traversent une régénération', () => {
  it('réinjecte `places_figees` sur la garde qui en portait', async () => {
    const { client, upserts } = creerSupabase([
      // Cadenassée par l'admin, mais PAS verrouillée : elle passe par le DELETE.
      {
        id: 'g-1', periode_id: PERIODE, cabinet_id: CABINET, verrouille: false,
        date: '2026-09-28', type: 'semaine', google_event_id: null,
        places_figees: ['premier'],
      },
    ])

    const r = await ecrirePlanningV1(client, PLANNING, PERIODE, CABINET)
    expect(r.ok).toBe(true)

    const reecrite = upserts.find((u) => u.date === '2026-09-28')
    expect(reecrite).toBeDefined()
    expect(reecrite?.places_figees).toEqual(['premier'])
  })

  it('laisse vide celle qui n’avait aucun cadenas', async () => {
    const { client, upserts } = creerSupabase([
      {
        id: 'g-1', periode_id: PERIODE, cabinet_id: CABINET, verrouille: false,
        date: '2026-09-28', type: 'semaine', google_event_id: null,
        places_figees: ['premier'],
      },
    ])

    await ecrirePlanningV1(client, PLANNING, PERIODE, CABINET)

    const weekend = upserts.find((u) => u.date === '2026-10-03')
    expect(weekend).toBeDefined()
    expect(weekend?.places_figees).toEqual([])
  })

  it('n’invente pas de cadenas quand la période n’en a aucun', async () => {
    const { client, upserts } = creerSupabase([
      {
        id: 'g-1', periode_id: PERIODE, cabinet_id: CABINET, verrouille: false,
        date: '2026-09-28', type: 'semaine', google_event_id: null,
        places_figees: [],
      },
    ])

    await ecrirePlanningV1(client, PLANNING, PERIODE, CABINET)

    expect(upserts.every((u) => Array.isArray(u.places_figees) && (u.places_figees as unknown[]).length === 0)).toBe(true)
  })
})
