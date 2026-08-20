// ============================================================
// GUARDVETO — L'agenda et le jour remplacé (backlog 8 bis)
// ============================================================
// Beaucoup de vétérinaires ne consultent QUE leur agenda : ce que Google
// affiche est, pour eux, le planning. Un bloc de week-end dont un jour a
// changé de titulaire doit donc le dire — dans le titre, parce qu'on lit les
// titres sans ouvrir les événements, et dans la description, parce que c'est
// là qu'on va vérifier qui fait quoi.
//
// Le premier test est le garde-fou de non-régression : sans exception, le
// texte doit rester EXACTEMENT celui d'avant. Il est le plus important des
// trois — les exceptions sont rares, les week-ends ordinaires sont la norme.
// ============================================================

import { describe, it, expect } from 'vitest'
import { construireApercuEvenement } from '../google-calendar'

const weekEnd = {
  date: '2026-10-03', // samedi — la ligne `gardes` vit ici
  type: 'weekend',
  prenomPremier: 'Anne-Sophie',
  prenomSecond: 'Antoine',
}

describe('agenda Google — remplacement d’un seul jour', () => {
  it('sans exception : samedi et dimanche restent groupés, titre inchangé', () => {
    const { titre, description } = construireApercuEvenement(weekEnd)

    expect(titre).toBe('Garde — Anne-Sophie (1er) + Antoine (2nd)')
    // Le vendredi porte les rôles inversés : c'est le comportement historique.
    expect(description).toContain('Vendredi soir : Antoine (1er) + Anne-Sophie (2nd)')
    expect(description).toContain('Samedi & dimanche : Anne-Sophie (1er) + Antoine (2nd)')
  })

  it('exception le dimanche : les deux jours se séparent et le titre alerte', () => {
    const { titre, description } = construireApercuEvenement({
      ...weekEnd,
      exceptions: [{ date: '2026-10-04', role: 'second', prenom: 'Manon' }],
    })

    expect(titre).toContain('⚠️ 1 jour modifié')
    // Les garder groupés serait un mensonge : ils ne portent plus la même équipe.
    expect(description).not.toContain('Samedi & dimanche')
    expect(description).toContain('Samedi : Anne-Sophie (1er) + Antoine (2nd)')
    expect(description).toContain('Dimanche : Anne-Sophie (1er) + Manon (2nd)')
    expect(description).toContain('exceptionnel')
  })

  it('exception le vendredi : elle s’applique au rôle AFFICHÉ, pas au rôle natif', () => {
    // Anne-Sophie est 1ʳᵉ du week-end, donc 2nde le vendredi (rôles inversés).
    // Une exception posée sur le « 1er » du vendredi vise donc la place
    // d'Antoine — l'appliquer au rôle natif aurait remplacé Anne-Sophie.
    const { description } = construireApercuEvenement({
      ...weekEnd,
      exceptions: [{ date: '2026-10-02', role: 'premier', prenom: 'Manon' }],
    })

    expect(description).toContain('Vendredi soir : Manon (1er) + Anne-Sophie (2nd)')
    // Le week-end lui-même n'a pas bougé.
    expect(description).toContain('Samedi & dimanche : Anne-Sophie (1er) + Antoine (2nd)')
  })

  it('place laissée vacante : elle se DIT, elle ne se devine pas', () => {
    const { description } = construireApercuEvenement({
      ...weekEnd,
      exceptions: [{ date: '2026-10-04', role: 'second', prenom: null }],
    })

    // Un blanc se lirait comme un défaut d'affichage, pas comme un trou réel.
    expect(description).toContain('Dimanche : Anne-Sophie (1er) + personne (place à pourvoir) (2nd)')
  })

  it('deux jours modifiés : le titre les compte', () => {
    const { titre } = construireApercuEvenement({
      ...weekEnd,
      exceptions: [
        { date: '2026-10-03', role: 'premier', prenom: 'Manon' },
        { date: '2026-10-04', role: 'second', prenom: 'Jean' },
      ],
    })

    expect(titre).toContain('⚠️ 2 jours modifiés')
  })
})
