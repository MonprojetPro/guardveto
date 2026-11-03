// B-187 — un remplacement d'un jour FIXÉ doit survivre à la génération.
// Cas réel rejoué : le 25/12 d'Hiver P3 au Val d'Allier (Manon 1re + Anne-Sophie
// 2e, à la place des titulaires du week-end du 26/12), vendredi inversé.
import { describe, expect, it } from 'vitest'
import {
  planReposeRemplacements,
  type RemplacementFige,
} from '../../src/lib/gardes/remplacements-figes'

const CAB = 'cab'
const base = {
  gardeDate: '2026-12-26',
  gardeType: 'weekend',
  date: '2026-12-25',
  motif: 'exception',
  absence_id: null,
  cree_par: 'anneso',
  cabinet_id: CAB,
}
const MANON: RemplacementFige = { ...base, role: 'premier', veterinaire_id: 'manon', compte_1er_we: true }
const ANNESO: RemplacementFige = { ...base, role: 'second', veterinaire_id: 'anneso', compte_1er_we: false }

const idParCle = new Map([['2026-12-26|weekend', 'g-neuve']])

describe('B-187 — remise en place des remplacements fixés', () => {
  it('rattache le 25/12 à la NOUVELLE garde, et désigne le titulaire de la ligne du jour', () => {
    // Après génération, la ligne du vendredi (inversée) porte Jean 1er, Victor 2e.
    const plan = planReposeRemplacements([MANON, ANNESO], idParCle, [
      { id: 'g-neuve', date: '2026-12-25', premier_id: 'jean', second_id: 'victor' },
      { id: 'g-neuve', date: '2026-12-26', premier_id: 'victor', second_id: 'jean' },
    ])
    expect(plan.aInserer).toEqual([
      expect.objectContaining({ garde_id: 'g-neuve', date: '2026-12-25', role: 'premier', veterinaire_id: 'manon', remplace_id: 'jean', compte_1er_we: true, fige: true }),
      expect.objectContaining({ garde_id: 'g-neuve', date: '2026-12-25', role: 'second', veterinaire_id: 'anneso', remplace_id: 'victor', compte_1er_we: false, fige: true }),
    ])
    expect(plan.sansGarde).toEqual([])
    expect(plan.enConflit).toEqual([])
  })

  it('ne remplace pas quelqu’un par lui-même : la génération l’a déjà mis là', () => {
    const plan = planReposeRemplacements([MANON], idParCle, [
      { id: 'g-neuve', date: '2026-12-25', premier_id: 'manon', second_id: 'victor' },
    ])
    expect(plan.aInserer).toEqual([])
    expect(plan.dejaEnPlace).toEqual([MANON])
  })

  it('accepte une personne sur l’autre place si cette place est elle-même remplacée', () => {
    // La génération met Anne-Sophie 1re du week-end ; le 25, Manon la remplace
    // en 1re et Anne-Sophie passe 2e : les deux remplacements tiennent ensemble.
    const plan = planReposeRemplacements([MANON, ANNESO], idParCle, [
      { id: 'g-neuve', date: '2026-12-25', premier_id: 'anneso', second_id: 'victor' },
    ])
    expect(plan.aInserer.map((r) => r.veterinaire_id)).toEqual(['manon', 'anneso'])
    expect(plan.enConflit).toEqual([])
  })

  it('signale un conflit plutôt que de faire tenir deux places à la même personne', () => {
    const plan = planReposeRemplacements([MANON], idParCle, [
      { id: 'g-neuve', date: '2026-12-25', premier_id: 'jean', second_id: 'manon' },
    ])
    expect(plan.aInserer).toEqual([])
    expect(plan.enConflit).toEqual([MANON])
  })

  it('signale un remplacement dont la garde n’existe plus après la génération', () => {
    const plan = planReposeRemplacements([MANON], new Map(), [])
    expect(plan.sansGarde).toEqual([MANON])
  })

  it('n’accorde jamais l’avantage financier à la 2e place (contrainte de la base)', () => {
    const plan = planReposeRemplacements([{ ...ANNESO, compte_1er_we: true }], idParCle, [
      { id: 'g-neuve', date: '2026-12-25', premier_id: 'jean', second_id: 'victor' },
    ])
    expect(plan.aInserer[0].compte_1er_we).toBe(false)
  })
})
