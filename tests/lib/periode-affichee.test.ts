import { describe, expect, it } from 'vitest'
import { choisirPeriodeAffichee } from '@/lib/planning/periode-affichee'

// Le cas réel du bac à sable, le 23/10 : triées par début DÉCROISSANT, comme
// la page les reçoit.
const journees = { id: 'j', date_debut: '2026-11-09', date_fin: '2026-11-16', usage: 'journees' as const }
const hiverP2 = { id: 'g2', date_debut: '2026-10-19', date_fin: '2027-01-10', usage: 'gardes' as const }
const hiverP1 = { id: 'g1', date_debut: '2026-09-21', date_fin: '2026-10-18', usage: 'gardes' as const }
const periodes = [journees, hiverP2, hiverP1]

describe('choisirPeriodeAffichee (B-172)', () => {
  it('préfère le planning de gardes à une période journées qui démarre après lui', () => {
    expect(choisirPeriodeAffichee(periodes, '2026-11-01', '2026-11-30')?.id).toBe('g2')
  })

  it('rend le planning demandé quand il chevauche le mois', () => {
    expect(choisirPeriodeAffichee(periodes, '2026-11-01', '2026-11-30', 'j')?.id).toBe('j')
  })

  it('ignore une demande qui ne chevauche pas le mois', () => {
    expect(choisirPeriodeAffichee(periodes, '2026-12-01', '2026-12-31', 'j')?.id).toBe('g2')
  })

  it('se rabat sur une période journées quand le mois n’a aucun planning de gardes', () => {
    const seule = [{ id: 'j2', date_debut: '2027-03-01', date_fin: '2027-03-31', usage: 'journees' as const }]
    expect(choisirPeriodeAffichee(seule, '2027-03-01', '2027-03-31')?.id).toBe('j2')
  })

  it('rend null hors de tout planning', () => {
    expect(choisirPeriodeAffichee(periodes, '2027-06-01', '2027-06-30')).toBeNull()
  })

  it('traite un usage absent comme un planning qui porte des gardes (défaut en base)', () => {
    const anciennes = [journees, { id: 'x', date_debut: '2026-10-19', date_fin: '2027-01-10' }]
    expect(choisirPeriodeAffichee(anciennes, '2026-11-01', '2026-11-30')?.id).toBe('x')
  })
})
