// ============================================================
// Le fil de conversation envoyé à Filou — mise en forme
// ============================================================
// Ce qui est testé ici n'est pas du confort : un fil mal formé est refusé par
// l'API (400), et un 400 met Filou entièrement à terre — la conversation ne
// répond plus du tout. Deux formes sont refusées : un fil qui commence par une
// phrase de l'assistant, et deux tours du même côté empilés.
//
// Le second cas arrive pour de bon : Filou répond (1 message), puis la décision
// prise sur le tableau vient s'annoncer dans le fil (2ᵉ message) — deux tours
// de Filou d'affilée, sans rien de la personne entre les deux.

import { describe, it, expect } from 'vitest'
import { assemblerMessages, type EchangeFilou } from '../agentFilou'

const texte = (m: { content: unknown }) => m.content as string

describe('assemblerMessages', () => {
  it('la conversation commence toujours par la personne', () => {
    const messages = assemblerMessages([{ role: 'assistant', texte: 'Bonjour' }], 'ma question')
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(texte(messages[0])).toBe('ma question')
  })

  it('fusionne deux tours de Filou qui se suivent', () => {
    const fil: EchangeFilou[] = [
      { role: 'user', texte: 'et Anne-Cat ?' },
      { role: 'assistant', texte: 'Elle est en dernier recours.' },
      { role: 'assistant', texte: 'Statut retiré : c’est fait.' },
    ]
    const messages = assemblerMessages(fil, 'et maintenant ?')
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(texte(messages[1])).toBe('Elle est en dernier recours.\n\nStatut retiré : c’est fait.')
  })

  it('fusionne la nouvelle demande avec un dernier tour déjà de la personne', () => {
    const messages = assemblerMessages([{ role: 'user', texte: 'première' }], 'seconde')
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(texte(messages[0])).toBe('première\n\nseconde')
  })

  it('ignore les tours vides — une panne affichée ne se raconte pas à Filou', () => {
    const fil: EchangeFilou[] = [
      { role: 'user', texte: 'ma question' },
      { role: 'assistant', texte: '   ' },
    ]
    const messages = assemblerMessages(fil, 'ma suite')
    expect(messages).toHaveLength(1)
    expect(texte(messages[0])).toBe('ma question\n\nma suite')
  })

  it('sans historique, il ne reste que la demande', () => {
    const messages = assemblerMessages([], 'ma question')
    expect(messages).toEqual([{ role: 'user', content: 'ma question' }])
  })

  it('alterne correctement sur un échange complet', () => {
    const fil: EchangeFilou[] = [
      { role: 'user', texte: 'q1' },
      { role: 'assistant', texte: 'r1' },
      { role: 'user', texte: 'q2' },
      { role: 'assistant', texte: 'r2' },
    ]
    const messages = assemblerMessages(fil, 'q3')
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
  })
})
