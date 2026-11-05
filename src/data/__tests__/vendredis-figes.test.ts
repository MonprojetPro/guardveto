// B-189 — le cadenas du VENDREDI SEUL arrive au moteur comme une place figée
// du créneau `vendredi_soir`, avec la personne de la LIGNE DU VENDREDI (rôles
// déjà inversés par la vue).
import { describe, it, expect } from 'vitest'
import { chargerVendredisFiges, veille } from '../chargerPlacesFigees'
import { estVendrediDuWeekend } from '@/lib/planning/grilleSemaines'

type Ligne = Record<string, unknown>

function creerSupabase(tables: Record<string, Ligne[]>) {
  return {
    from: (nom: string) => {
      const filtres: Array<(l: Ligne) => boolean> = []
      const api = {
        select: () => api,
        eq: (c: string, v: unknown) => { filtres.push((l) => l[c] === v); return api },
        neq: (c: string, v: unknown) => {
          filtres.push((l) => (v === '{}' ? Array.isArray(l[c]) && (l[c] as unknown[]).length > 0 : l[c] !== v))
          return api
        },
        in: (c: string, v: unknown[]) => { filtres.push((l) => v.includes(l[c])); return api },
        then: (r: (x: unknown) => unknown) =>
          Promise.resolve({ data: (tables[nom] ?? []).filter((l) => filtres.every((f) => f(l))), error: null }).then(r),
      }
      return api
    },
  } as never
}

const GARDE = {
  id: 'g-we', periode_id: 'p', cabinet_id: 'c', type: 'weekend', date: '2026-12-26',
  vendredi_figees: ['premier'],
}

describe('B-189 — chargerVendredisFiges', () => {
  it('émet le vendredi avec la personne de la ligne du vendredi', async () => {
    const sb = creerSupabase({
      gardes: [GARDE],
      planning_semaine: [
        { id: 'g-we', date: '2026-12-25', premier_id: 'jean', second_id: 'victor', exception_premier: false, exception_second: false },
        { id: 'g-we', date: '2026-12-26', premier_id: 'victor', second_id: 'jean', exception_premier: false, exception_second: false },
      ],
    })
    const r = await chargerVendredisFiges(sb, 'p', 'c')
    expect(r.places).toEqual([{ date: '2026-12-25', type: 'vendredi_soir', role: 'premier', vetId: 'jean' }])
    expect(r.sansTitulaire).toEqual([])
  })

  it('laisse au remplacement d’un jour (B-187) la place qu’il tient', async () => {
    const sb = creerSupabase({
      gardes: [GARDE],
      planning_semaine: [
        { id: 'g-we', date: '2026-12-25', premier_id: 'manon', second_id: 'victor', exception_premier: true, exception_second: false },
      ],
    })
    const r = await chargerVendredisFiges(sb, 'p', 'c')
    expect(r.places).toEqual([])
  })

  it('dit inopérant un cadenas de vendredi sans ligne (vendredi plus matérialisé)', async () => {
    const r = await chargerVendredisFiges(creerSupabase({ gardes: [GARDE], planning_semaine: [] }), 'p', 'c')
    expect(r.places).toEqual([])
    expect(r.sansTitulaire).toEqual([{ date: '2026-12-25', type: 'vendredi_soir', role: 'premier' }])
  })

  it('veille() recule d’un jour, changement de mois compris', () => {
    expect(veille('2027-01-02')).toBe('2027-01-01')
    expect(veille('2026-03-01')).toBe('2026-02-28')
  })
})

describe('B-189 — estVendrediDuWeekend (la grille)', () => {
  const lignes = [
    { id: 'we', date: '2026-12-25', type: 'weekend' },
    { id: 'we', date: '2026-12-26', type: 'weekend' },
    { id: 'we', date: '2026-12-27', type: 'weekend' },
    { id: 'lun', date: '2026-12-28', type: 'semaine' },
  ]
  it('reconnaît le vendredi, et seulement lui', () => {
    expect(estVendrediDuWeekend(lignes, 'we', '2026-12-25')).toBe(true)
    expect(estVendrediDuWeekend(lignes, 'we', '2026-12-26')).toBe(false)
    expect(estVendrediDuWeekend(lignes, 'we', '2026-12-27')).toBe(false)
    expect(estVendrediDuWeekend(lignes, 'lun', '2026-12-28')).toBe(false)
  })
  it('sans vendredi matérialisé, le samedi n’est pas pris pour un vendredi', () => {
    expect(estVendrediDuWeekend(lignes.slice(1), 'we', '2026-12-26')).toBe(false)
  })
})
