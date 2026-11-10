// B-197 — Le mail « Nouveau planning » doit annoncer les JOURS tenus, pas la
// ligne entière. Données rejouées telles qu'en base le 10/11/2026 (Val
// d'Allier, hiver publié le 08/11) : les deux week-ends de fêtes.
import { describe, it, expect } from 'vitest'
import { lignesGardesDuVeto, ligneEstPartielle, nomsDesJours } from '@/lib/emails/gardes-par-jour'
import { indexerExceptions } from '@/lib/gardes/exceptions-jour'
import { buildPlanningPublieHtml } from '@/lib/notifications'

const AS = 'anne-sophie', FANNY = 'fanny', JEAN = 'jean', MANON = 'manon', ANTOINE = 'antoine', VICTOR = 'victor'

const gardes = [
  { id: 'we-noel', date: '2026-12-26', type: 'weekend', premier_id: VICTOR, second_id: JEAN },
  { id: 'we-an', date: '2027-01-02', type: 'weekend', premier_id: FANNY, second_id: AS },
  { id: 'sem-31', date: '2026-12-31', type: 'semaine', premier_id: JEAN, second_id: ANTOINE },
]
const index = indexerExceptions([
  { garde_id: 'we-noel', date: '2026-12-25', role: 'premier', veterinaire_id: MANON },
  { garde_id: 'we-noel', date: '2026-12-25', role: 'second', veterinaire_id: AS },
  { garde_id: 'we-an', date: '2027-01-01', role: 'premier', veterinaire_id: ANTOINE },
  { garde_id: 'we-an', date: '2027-01-01', role: 'second', veterinaire_id: JEAN },
])

const noms: Record<string, string> = {
  [AS]: 'Anne-Sophie Blanchard', [FANNY]: 'Fanny Altieri', [JEAN]: 'Jean De Thoisy',
  [MANON]: 'Manon Renaud', [ANTOINE]: 'Antoine Lafarge', [VICTOR]: 'Victor Coelho',
}
const periode = { saison: 'hiver', numero: null, date_debut: '2026-11-30', date_fin: '2027-01-10' }

describe('B-197 — le mail liste les jours réellement tenus', () => {
  it('Manon tient le seul 25/12, avec Anne-Sophie — pas le week-end avec Victor', () => {
    const lignes = lignesGardesDuVeto(gardes, index, MANON)
    expect(lignes).toHaveLength(1)
    expect(lignes[0].jours).toEqual(['2026-12-25'])
    expect(lignes[0].binomeId).toBe(AS)
    expect(ligneEstPartielle(lignes[0])).toBe(true)
  })

  it('Antoine tient le 01/01 avec Jean, plus sa semaine du 31/12 — pas les 2 et 3 janvier', () => {
    const lignes = lignesGardesDuVeto(gardes, index, ANTOINE)
    expect(lignes.map((l) => l.jours)).toEqual([['2026-12-31'], ['2027-01-01']])
    expect(lignes[1].binomeId).toBe(JEAN)
  })

  it('Victor (titulaire) ne tient que samedi et dimanche, avec Jean', () => {
    const lignes = lignesGardesDuVeto(gardes, index, VICTOR)
    expect(lignes).toHaveLength(1)
    expect(lignes[0].jours).toEqual(['2026-12-26', '2026-12-27'])
    expect(lignes[0].binomeId).toBe(JEAN)
    expect(nomsDesJours(lignes[0].jours)).toBe('samedi et dimanche')
  })

  it('Jean a trois lignes distinctes : 26-27/12, 31/12, 01/01', () => {
    const lignes = lignesGardesDuVeto(gardes, index, JEAN)
    expect(lignes.map((l) => l.jours)).toEqual([
      ['2026-12-26', '2026-12-27'], ['2026-12-31'], ['2027-01-01'],
    ])
    expect(lignes.map((l) => l.binomeId)).toEqual([VICTOR, ANTOINE, ANTOINE])
  })

  it('un week-end sans remplacement reste une seule ligne complète', () => {
    const lignes = lignesGardesDuVeto(
      [{ id: 'we', date: '2026-12-19', type: 'weekend', premier_id: ANTOINE, second_id: FANNY }],
      new Map(), ANTOINE,
    )
    expect(lignes).toHaveLength(1)
    expect(lignes[0].jours).toEqual(['2026-12-18', '2026-12-19', '2026-12-20'])
    expect(ligneEstPartielle(lignes[0])).toBe(false)
  })

  it('le HTML de Manon dit « vendredi 25 décembre », jamais « 26 décembre »', () => {
    const html = buildPlanningPublieHtml(
      { prenom: 'Manon' }, periode, lignesGardesDuVeto(gardes, index, MANON), (id) => noms[id] ?? null,
    )
    expect(html).toContain('vendredi 25 décembre 2026')
    expect(html).toContain('vendredi seulement')
    expect(html).toContain('avec Anne-Sophie Blanchard')
    expect(html).not.toContain('26 décembre')
    expect(html).not.toContain('Victor')
    expect(html).not.toContain('excuses') // le mail normal ne s'excuse pas
  })

  it('le HTML d’Antoine ne mentionne ni le 2 ni le 3 janvier', () => {
    const html = buildPlanningPublieHtml(
      { prenom: 'Antoine' }, periode, lignesGardesDuVeto(gardes, index, ANTOINE), (id) => noms[id] ?? null,
    )
    expect(html).toContain('vendredi 1 janvier 2027')
    expect(html).not.toMatch(/\b2 janvier|\b3 janvier/)
  })

  it('le rectificatif annonce la correction et cite la date du mail faux', () => {
    const html = buildPlanningPublieHtml(
      { prenom: 'Manon' }, periode, lignesGardesDuVeto(gardes, index, MANON), (id) => noms[id] ?? null,
      '2026-11-08',
    )
    expect(html).toContain('Correction de notre précédent e-mail')
    expect(html).toContain('dimanche 8 novembre 2026')
    expect(html).toContain('Planning corrigé')
    expect(html).toContain('toutes nos excuses pour la gêne occasionnée')
    expect(html).toContain('logiciel de référence')
    expect(html).toContain("comportait une erreur. Le planning affiché")
    expect(html).not.toContain("assuré par d'autres personnes")
    expect(html).not.toContain("qu'un seul jour")
  })
})

// Le mail « garde modifiée » : un faux client Supabase qui rend les
// remplacements réels du week-end de Noël et les noms des remplaçants.
import { joursTenusParDautresQueLesTitulaires } from '@/lib/notifications'

function fauxSupabase(exceptions: unknown[], vets: unknown[]) {
  return {
    from: (table: string) => ({
      select: () => ({
        in: async () => ({ data: table === 'gardes_exceptions' ? exceptions : vets, error: null }),
      }),
    }),
  } as never
}

describe('B-197 — le mail « garde modifiée » signale les jours tenus par d’autres', () => {
  const garde = {
    id: 'we-noel', date: '2026-12-26', type: 'weekend',
    premier: { id: VICTOR, prenom: 'Victor', nom: 'Coelho', email: null },
    second: { id: JEAN, prenom: 'Jean', nom: 'De Thoisy', email: null },
  }

  it('week-end de Noël : seul le 25/12 est signalé, avec Manon et Anne-Sophie', async () => {
    const jours = await joursTenusParDautresQueLesTitulaires(fauxSupabase(
      [
        { garde_id: 'we-noel', date: '2026-12-25', role: 'premier', veterinaire_id: MANON },
        { garde_id: 'we-noel', date: '2026-12-25', role: 'second', veterinaire_id: AS },
      ],
      [{ id: MANON, prenom: 'Manon', nom: 'Renaud' }, { id: AS, prenom: 'Anne-Sophie', nom: 'Blanchard' }],
    ), garde)
    expect(jours).toEqual([{ jour: '2026-12-25', occupants: 'Manon Renaud + Anne-Sophie Blanchard' }])
  })

  it('sans remplacement : rien à signaler', async () => {
    expect(await joursTenusParDautresQueLesTitulaires(fauxSupabase([], []), garde)).toEqual([])
  })
})
