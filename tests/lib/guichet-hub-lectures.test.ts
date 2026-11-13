// ============================================================
// B-207 lot 1 — Ce que le guichet du Hub lit : états de compte, périodes
// ============================================================

import { describe, it, expect } from 'vitest'
import { etatCompte, jourAParis, periodesDuCabinet, plusRecente, type RangeePeriode } from '@/lib/guichet-hub/lectures'

describe('etatCompte', () => {
  const confirme = { id: 'u', confirmed_at: '2026-11-01T10:00:00Z' }

  it('sans fiche liée ni compte → sans compte', () => {
    expect(etatCompte(null, undefined)).toBe('sans_compte')
    expect(etatCompte('u', undefined)).toBe('sans_compte')
  })

  it('compte non confirmé → invitation en attente', () => {
    expect(etatCompte('u', { id: 'u', confirmed_at: null })).toBe('invitation_en_attente')
  })

  it('compte confirmé → actif', () => {
    expect(etatCompte('u', confirme)).toBe('actif')
  })

  it('secrétariat confirmé SANS mot de passe → mot de passe à choisir (jamais « invitation en attente »)', () => {
    expect(etatCompte('u', confirme, { motDePasseExige: true, motDePasseLe: null })).toBe('mot_de_passe_a_choisir')
    expect(etatCompte('u', confirme, { motDePasseExige: true, motDePasseLe: '2026-11-02T08:00:00Z' })).toBe('actif')
  })
})

describe('periodesDuCabinet', () => {
  const p = (id: string, debut: string, fin: string, statut = 'publie'): RangeePeriode => ({
    id,
    cabinet_id: 'c',
    libelle: id,
    date_debut: debut,
    date_fin: fin,
    statut,
    publie_at: null,
  })
  const liste = [p('B', '2026-12-01', '2027-02-28', 'brouillon'), p('A', '2026-09-01', '2026-11-30')]

  it('trouve la période qui couvre le jour, et la suivante', () => {
    const r = periodesDuCabinet(liste, '2026-11-13')
    expect(r.enCours?.id).toBe('A')
    expect(r.prochaine?.id).toBe('B')
    expect(r.derniereFin).toBe('2027-02-28')
  })

  it('inclut les bornes (premier et dernier jour)', () => {
    expect(periodesDuCabinet(liste, '2026-09-01').enCours?.id).toBe('A')
    expect(periodesDuCabinet(liste, '2026-11-30').enCours?.id).toBe('A')
    expect(periodesDuCabinet(liste, '2026-12-01').enCours?.id).toBe('B')
  })

  it('aucune période → tout à null', () => {
    expect(periodesDuCabinet([], '2026-11-13')).toEqual({ enCours: null, prochaine: null, derniereFin: null })
  })
})

describe('utilitaires', () => {
  it('jourAParis rend le jour à Paris, pas en UTC', () => {
    // 23h30 UTC le 31/12 = déjà le 1er janvier à Paris.
    expect(jourAParis(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
  })

  it('plusRecente ignore les vides', () => {
    expect(plusRecente([null, '2026-11-01T00:00:00Z', undefined, '2026-11-05T00:00:00Z'])).toBe('2026-11-05T00:00:00Z')
    expect(plusRecente([null, undefined])).toBeNull()
  })
})
