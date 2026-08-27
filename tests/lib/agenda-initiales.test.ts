import { describe, it, expect } from 'vitest'
import { initialesVeto, initialesUniques } from '@/lib/agenda/initiales'

// ============================================================
// Les sept vétos réels de Val d'Allier — cas obligatoires, tels quels.
// ============================================================

describe('initialesVeto — les 7 cas réels de Val d\'Allier', () => {
  it('Anne-Catherine Bernard → ACB', () => {
    expect(initialesVeto('Anne-Catherine', 'Bernard')).toBe('ACB')
  })

  it('Anne-Sophie Blanchard → ASB', () => {
    expect(initialesVeto('Anne-Sophie', 'Blanchard')).toBe('ASB')
  })

  it('Antoine Lafarge → AL', () => {
    expect(initialesVeto('Antoine', 'Lafarge')).toBe('AL')
  })

  it('Fanny Altieri → FA', () => {
    expect(initialesVeto('Fanny', 'Altieri')).toBe('FA')
  })

  it('Jean De Thoisy → JD (première lettre du nom ENTIER, pas JDT)', () => {
    expect(initialesVeto('Jean', 'De Thoisy')).toBe('JD')
  })

  it('Manon Renaud → MR', () => {
    expect(initialesVeto('Manon', 'Renaud')).toBe('MR')
  })

  it('Victor Coelho → VC', () => {
    expect(initialesVeto('Victor', 'Coelho')).toBe('VC')
  })
})

describe('initialesVeto — accents, casse, séparateurs', () => {
  it('garde l\'accent du prénom (Élodie → É, pas E)', () => {
    expect(initialesVeto('Élodie', 'Faure')).toBe('ÉF')
  })

  it('un prénom composé séparé par espace compte comme deux initiales', () => {
    expect(initialesVeto('Marie Claire', 'Dubois')).toBe('MCD')
  })

  it('rend toujours des majuscules, même sur une saisie en minuscules', () => {
    expect(initialesVeto('anne-catherine', 'bernard')).toBe('ACB')
  })

  it('tolère les espaces parasites en début/fin', () => {
    expect(initialesVeto('  Victor  ', '  Coelho  ')).toBe('VC')
  })
})

describe('initialesUniques — départage stable et déterministe', () => {
  it('sans collision, renvoie les initiales simples', () => {
    const r = initialesUniques([
      { id: 'v1', prenom: 'Antoine', nom: 'Lafarge' },
      { id: 'v2', prenom: 'Manon', nom: 'Renaud' },
    ])
    expect(r.get('v1')).toBe('AL')
    expect(r.get('v2')).toBe('MR')
  })

  it('départage deux collisions en rallongeant le nom', () => {
    // Anne Blanc → AB, Antoine Blot → AB : collision sur la base.
    const r = initialesUniques([
      { id: 'v1', prenom: 'Anne', nom: 'Blanc' },
      { id: 'v2', prenom: 'Antoine', nom: 'Blot' },
    ])
    expect(r.get('v1')).not.toBe(r.get('v2'))
    expect(new Set(r.values()).size).toBe(2)
  })

  it('le résultat ne dépend PAS de l\'ordre d\'entrée', () => {
    const liste1 = [
      { id: 'v1', prenom: 'Anne', nom: 'Blanc' },
      { id: 'v2', prenom: 'Antoine', nom: 'Blot' },
    ]
    const liste2 = [liste1[1], liste1[0]]

    const r1 = initialesUniques(liste1)
    const r2 = initialesUniques(liste2)

    expect(r1.get('v1')).toBe(r2.get('v1'))
    expect(r1.get('v2')).toBe(r2.get('v2'))
  })

  it('homonymes stricts (même prénom, même nom) se départagent par id, jamais au hasard', () => {
    const r = initialesUniques([
      { id: 'zebre', prenom: 'Jean', nom: 'Dupont' },
      { id: 'alpha', prenom: 'Jean', nom: 'Dupont' },
    ])
    expect(r.get('zebre')).not.toBe(r.get('alpha'))
    // Rejoué, même résultat : c'est ça, déterministe.
    const r2 = initialesUniques([
      { id: 'zebre', prenom: 'Jean', nom: 'Dupont' },
      { id: 'alpha', prenom: 'Jean', nom: 'Dupont' },
    ])
    expect(r.get('zebre')).toBe(r2.get('zebre'))
    expect(r.get('alpha')).toBe(r2.get('alpha'))
  })
})
