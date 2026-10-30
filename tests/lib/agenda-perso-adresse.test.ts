import { describe, it, expect } from 'vitest'
import { adresseDePartage, lienAjoutAgenda } from '@/lib/agenda-perso/adresse'
import { emailInvitationAgenda } from '@/lib/emails/agenda-perso'

describe('B-178 — adresseDePartage', () => {
  it('retire l’alias « + » d’une adresse Gmail : Google ne relie pas l’alias au compte', () => {
    expect(adresseDePartage('culus.osteo+manon@gmail.com')).toBe('culus.osteo@gmail.com')
    expect(adresseDePartage(' Culus.Osteo+Manon@GMAIL.com ')).toBe('culus.osteo@gmail.com')
    expect(adresseDePartage('a+b@googlemail.com')).toBe('a@googlemail.com')
  })

  it('laisse intacte une adresse Gmail sans alias', () => {
    expect(adresseDePartage('anne.so@gmail.com')).toBe('anne.so@gmail.com')
  })

  it('ne touche pas au « + » hors Gmail (un autre fournisseur peut en faire une vraie adresse)', () => {
    expect(adresseDePartage('veto+cabinet@exemple.fr')).toBe('veto+cabinet@exemple.fr')
  })

  it('rend null pour une adresse inutilisable', () => {
    expect(adresseDePartage(null)).toBeNull()
    expect(adresseDePartage('')).toBeNull()
    expect(adresseDePartage('sans-arobase')).toBeNull()
    expect(adresseDePartage('a@')).toBeNull()
    expect(adresseDePartage('@gmail.com')).toBeNull()
  })

  it('garde l’adresse telle quelle si l’alias est tout ce qu’il y a', () => {
    expect(adresseDePartage('+x@gmail.com')).toBe('+x@gmail.com')
  })
})

describe('B-178 — lien et e-mail d’invitation', () => {
  const id = '55790524eb05f17dd44836494c3fdf20c1364aaf02ee1635f43d6dcad60785b7@group.calendar.google.com'

  it('le lien ouvre Google Agenda sur l’agenda, identifiant encodé', () => {
    expect(lienAjoutAgenda(id)).toBe(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(id)}`)
  })

  it('l’e-mail porte le bouton, le lien en clair et le compte à utiliser', () => {
    const html = emailInvitationAgenda({ prenom: 'Manon', compte: 'culus.osteo@gmail.com', lien: lienAjoutAgenda(id), nomAgenda: 'GuardVeto — Manon' })
    expect(html).toContain('Bonjour Manon,')
    expect(html).toContain('Ajouter à mon Google Agenda')
    expect(html).toContain('culus.osteo@gmail.com')
    expect(html.split(encodeURIComponent(id)).length - 1).toBe(2)
    expect(html).not.toMatch(/gserviceaccount/)
  })

  it('échappe un prénom saisi avec du HTML', () => {
    const html = emailInvitationAgenda({ prenom: '<b>x</b>', compte: 'a@gmail.com', lien: 'https://x', nomAgenda: 'n' })
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})
