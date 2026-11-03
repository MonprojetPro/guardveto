// B-186 — le cadenas d'une place fixée doit pouvoir se dessiner sur la case
// REPLIÉE. Pour ça, chaque nom de la ligne « Nuit » doit dire à QUI il
// appartient et de QUELLE garde : sans ces deux identifiants, la case repliée
// ne peut pas interroger les places fixées, et le cadenas reste invisible.
import { describe, expect, it } from 'vitest'
import { lignesCaseRepliee } from '../../src/lib/planning/grilleSemaines'

describe('B-186 — case repliée, ligne de nuit', () => {
  it('chaque nom porte sa garde et sa personne', () => {
    const lignes = lignesCaseRepliee(
      {
        gardes: [
          {
            id: 'g1',
            type: 'semaine',
            manque: 0,
            places: [
              { vetId: 'v-antoine', prenom: 'Antoine', couleur: '#0a0', role: '1er' },
              { vetId: 'v-anneso', prenom: 'Anne-Sophie', couleur: '#f9c', role: '2e' },
            ],
          },
        ],
        absences: [],
      } as never,
      { gardesVisibles: true, journeeVisible: false },
    )
    const nuit = lignes.find((l) => l.genre === 'nuit')
    expect(nuit?.pastilles.map((p) => [p.texte, p.gardeId, p.vetId])).toEqual([
      ['Antoine', 'g1', 'v-antoine'],
      ['Anne-Sophie', 'g1', 'v-anneso'],
    ])
  })
})
