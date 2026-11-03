// B-180a — la fenêtre de publication ne dit plus « les journées restent dans
// l'application » là où l'agenda perso les emporte dans Google.
import { describe, expect, it } from 'vitest'
import { phraseAgendas } from '@/components/chantier/DialogPublicationChantier'

describe('phraseAgendas (B-180a)', () => {
  it('agenda perso ouvert : les journées partent aussi', () => {
    expect(phraseAgendas(true, true)).toBe('avec les gardes et les journées, dans l’agenda GuardVeto de chacun')
  })
  it('agenda perso fermé : les journées restent dans l’application', () => {
    expect(phraseAgendas(true, false)).toBe('avec les gardes (les journées restent dans l’application)')
  })
  it('on ne sait pas : rien d’affirmé sur les journées', () => {
    expect(phraseAgendas(true, null)).toBe('avec les gardes')
    expect(phraseAgendas(true, undefined)).toBe('avec les gardes')
  })
  it('cabinet sans module journées : on n’en parle pas', () => {
    expect(phraseAgendas(false, true)).toBe('avec les gardes')
  })
})
