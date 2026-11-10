import { describe, expect, it } from 'vitest'
import { cheminOuvertSansMotDePasse, sessionSansMotDePasse } from '@/lib/auth/session-par-lien'

// B-201 — Les valeurs ci-dessous sont celles lues en base le 10/11
// (`auth.mfa_amr_claims`) : « otp » pour les sessions ouvertes par
// l'invitation (Victor, Fanny, Antoine, secrétariat), « recovery » pour le
// lien « mot de passe oublié » (Anne-Catherine), « password » pour les autres.

describe('sessionSansMotDePasse', () => {
  it('une session ouverte par le lien d’invitation doit choisir son mot de passe', () => {
    expect(sessionSansMotDePasse([{ method: 'otp' }])).toBe(true)
  })

  it('une session ouverte par « mot de passe oublié » aussi', () => {
    expect(sessionSansMotDePasse([{ method: 'recovery' }])).toBe(true)
  })

  it('une vraie connexion par mot de passe passe', () => {
    expect(sessionSansMotDePasse([{ method: 'password' }])).toBe(false)
  })

  it('un mot de passe dans la liste suffit, même à côté d’un lien', () => {
    expect(sessionSansMotDePasse([{ method: 'otp' }, { method: 'password' }])).toBe(false)
  })

  it('accepte aussi le format texte (RFC 8176)', () => {
    expect(sessionSansMotDePasse(['otp'])).toBe(true)
    expect(sessionSansMotDePasse(['password'])).toBe(false)
  })

  it('dans le doute, ne ferme la porte à personne', () => {
    expect(sessionSansMotDePasse([])).toBe(false)
    expect(sessionSansMotDePasse(null)).toBe(false)
    expect(sessionSansMotDePasse(undefined)).toBe(false)
    expect(sessionSansMotDePasse([{ method: 'oauth' }])).toBe(false)
    expect(sessionSansMotDePasse([{ method: null }])).toBe(false)
  })
})

describe('cheminOuvertSansMotDePasse', () => {
  it('laisse passer la page du mot de passe, les liens, la connexion et les API', () => {
    for (const p of ['/set-password', '/login', '/auth/callback', '/auth/confirm', '/api/chat', '/_next/data']) {
      expect(cheminOuvertSansMotDePasse(p)).toBe(true)
    }
  })

  it('ferme toutes les pages de l’application', () => {
    for (const p of ['/', '/accueil', '/planning', '/equipe', '/reglages', '/set-password-bis', '/authentification']) {
      expect(cheminOuvertSansMotDePasse(p)).toBe(false)
    }
  })
})
