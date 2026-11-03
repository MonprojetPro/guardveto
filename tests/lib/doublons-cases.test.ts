// B-180 — à la publication, une place vide ne se dit qu'une fois.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sansDoublonDesCases } from '@/lib/planning/doublonsCases'

// Le cas exact de la capture MiKL du 03/11 (Hiver P2, bac à sable).
const cases = [
  { date: '2026-10-20', type: 'semaine_soir', role: 'second' },
  { date: '2026-10-27', type: 'semaine_soir', role: 'second' },
  { date: '2026-11-10', type: 'semaine_soir', role: 'second' },
]
const r18 = (date: string) => ({ regle: 'R18', date, type: 'semaine_soir', role: 'second', detail: `hiver, garde semaine sans 2nd (${date})` })
const espacement = { regle: 'R10', date: '2026-10-13', type: 'semaine_soir', vetId: 'v1', detail: 'Fanny — seulement 1 jour(s)…' }

describe('sansDoublonDesCases', () => {
  it('retire « garde semaine sans 2nd » quand la place vide est déjà listée', () => {
    const v = [r18('2026-10-20'), r18('2026-10-27'), r18('2026-11-10'), espacement]
    expect(sansDoublonDesCases(v, cases)).toEqual([espacement])
  })

  it('garde une violation de couverture SANS case vide en face (désaccord des deux juges)', () => {
    const v = [r18('2026-12-01')]
    expect(sansDoublonDesCases(v, cases)).toEqual(v)
  })

  it('ne confond pas les rôles : un 1er manquant n’est pas le 2e listé', () => {
    const premier = { regle: 'COUVERTURE', date: '2026-10-20', type: 'semaine_soir', role: 'premier', detail: 'Aucun 1er' }
    expect(sansDoublonDesCases([premier], cases)).toEqual([premier])
  })

  it('ne retire jamais une règle de rythme, même à la même date', () => {
    const memeJour = { ...espacement, date: '2026-10-20', role: 'second' }
    expect(sansDoublonDesCases([memeJour], cases)).toEqual([memeJour])
  })

  it('sans case vide, rend tout', () => {
    const v = [r18('2026-10-20'), espacement]
    expect(sansDoublonDesCases(v, [])).toEqual(v)
  })

  it('est branché dans la route de publication, après la re-validation', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/publish/route.ts'), 'utf8')
    expect(route).toContain('violations = sansDoublonDesCases(violations, casesVides)')
    expect(route.indexOf('sansDoublonDesCases(violations')).toBeGreaterThan(route.indexOf('revaliderPlanning([periodeId])'))
  })
})
