// B-198 — le tableau des fêtes, un soir par ligne. Rejoue les gardes RÉELLES
// du bac à sable (lues en base le 10/11), où Noël et le Jour de l'an 2026
// tombent un vendredi : ces soirs-là sont tenus par la garde du WEEK-END.
import { describe, expect, it } from 'vitest'
import { soirsDeFete, soirsDeLaSaison, type GardePubliee } from '@/lib/compteurs/fetesParSoir'
import { indexerExceptions } from '@/lib/gardes/exceptions-jour'

const GARDES: GardePubliee[] = [
  { id: 'g24', date: '2026-12-24', type: 'semaine', premier_id: 'fanny', second_id: 'anne-sophie' },
  { id: 'we26', date: '2026-12-26', type: 'weekend', premier_id: 'victor', second_id: 'manon' },
  { id: 'g31', date: '2026-12-31', type: 'semaine', premier_id: 'fanny', second_id: 'manon' },
  { id: 'we02', date: '2027-01-02', type: 'weekend', premier_id: 'jean', second_id: 'antoine' },
]

describe('soirsDeFete', () => {
  it('les quatre soirs d’une saison, dans l’ordre', () => {
    expect(soirsDeLaSaison(2026).map((s) => s.date)).toEqual(['2026-12-24', '2026-12-25', '2026-12-31', '2027-01-01'])
  })

  it('un soir par ligne : le 25 et le 1er sont tenus par la garde du week-end', () => {
    const soirs = soirsDeFete([2026], GARDES, new Map())
    expect(soirs.map((s) => [s.date, s.premierId, s.secondId])).toEqual([
      ['2026-12-24', 'fanny', 'anne-sophie'],
      ['2026-12-25', 'victor', 'manon'],
      ['2026-12-31', 'fanny', 'manon'],
      ['2027-01-01', 'jean', 'antoine'],
    ])
    expect(soirs.every((s) => s.publie)).toBe(true)
  })

  it('un remplacement d’un jour sur le vendredi férié est montré, pas le titulaire du week-end', () => {
    const remplacements = indexerExceptions([
      { garde_id: 'we26', date: '2026-12-25', role: 'premier', veterinaire_id: 'anne-sophie' },
    ])
    const noel25 = soirsDeFete([2026], GARDES, remplacements).find((s) => s.date === '2026-12-25')
    expect(noel25).toMatchObject({ premierId: 'anne-sophie', secondId: 'manon' })
    // Le samedi du même week-end garde son titulaire.
  })

  it('un soir sans garde publiée est dit, pas inventé', () => {
    const soirs = soirsDeFete([2026], GARDES.filter((g) => g.id !== 'g31'), new Map())
    expect(soirs.find((s) => s.date === '2026-12-31')).toMatchObject({ publie: false, premierId: null, secondId: null })
  })

  it('plusieurs saisons : la plus récente d’abord, sans doublon', () => {
    const soirs = soirsDeFete([2025, 2026, 2026], GARDES, new Map())
    expect(soirs).toHaveLength(8)
    expect(soirs[0].annee).toBe(2026)
    expect(soirs[4].annee).toBe(2025)
  })
})
