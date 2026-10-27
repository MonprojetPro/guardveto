// ============================================================
// B-175 — le compteur des journées, rejoué sur les VRAIS chiffres
// ============================================================
// MiKL, 27/10 : « un compteur également pour les journées, puis revérifie
// qu'ils fonctionnent bien ces compteurs ».
//
// Les attendus ci-dessous ne sont pas inventés : ils sortent d'un comptage SQL
// fait le 27/10 sur le bac à sable (« Démo MonProjetPro », Hiver P2, du
// 19/10/2026 au 10/01/2027) — 223 présences, toutes sur un planning en
// brouillon. Le faux Supabase rejoue ces 223 lignes ; `queryCompteursJournee`
// doit retrouver EXACTEMENT les mêmes totaux.
//
// Deux pièges vérifiés en plus :
//   • la pagination (au-delà de 1000 lignes, une page de plus) — un compteur
//     qui s'arrêterait à la première page afficherait un chiffre plausible
//     et faux ;
//   • le périmètre « validées seulement » : un brouillon ne compte pas.
// ============================================================

import { describe, expect, it } from 'vitest'
import { queryCompteursJournee } from '@/hooks/useCompteurs'

type Ligne = {
  veterinaire_id: string
  blocs_journee: { creneau: string } | null
  periodes: { statut: string } | null
}

/** Mesure SQL du 27/10 : prénom → [matin, après-midi, journée entière]. */
const MESURE: Record<string, [number, number, number]> = {
  'Anne-Catherine': [0, 0, 43],
  'Anne-Sophie': [34, 0, 1],
  Antoine: [0, 0, 46],
  Fanny: [22, 22, 0],
  Jean: [0, 10, 44],
  Victor: [0, 0, 1],
}

function lignesDe(mesure: typeof MESURE, statut = 'brouillon'): Ligne[] {
  const out: Ligne[] = []
  for (const [id, [m, a, j]] of Object.entries(mesure)) {
    const poser = (n: number, creneau: string) => {
      for (let i = 0; i < n; i++) {
        out.push({ veterinaire_id: id, blocs_journee: { creneau }, periodes: { statut } })
      }
    }
    poser(m, 'matin')
    poser(a, 'apres-midi')
    poser(j, 'journee')
  }
  return out
}

/** Un faux client qui sert `lignes` par pages, comme PostgREST avec `.range()`. */
function fauxClient(lignes: Ligne[]) {
  const chaine: Record<string, unknown> = {}
  Object.assign(chaine, {
    from: () => chaine,
    select: () => chaine,
    gte: () => chaine,
    lte: () => chaine,
    order: () => chaine,
    range: async (de: number, a: number) => ({ data: lignes.slice(de, a + 1), error: null }),
  })
  return chaine as never
}

describe('Compteur des journées — Hiver P2 du bac à sable', () => {
  it('retrouve les 223 présences, personne par personne', async () => {
    const lignes = lignesDe(MESURE)
    expect(lignes).toHaveLength(223)

    const { parVeto, erreur } = await queryCompteursJournee(fauxClient(lignes), '2026-10-19', '2027-01-10')
    expect(erreur).toBeNull()
    for (const [id, [m, a, j]] of Object.entries(MESURE)) {
      expect(parVeto.get(id)).toEqual({ matin: m, apres_midi: a, entiere: j })
    }
  })

  it('« validées seulement » : un planning en brouillon ne compte rien', async () => {
    const { parVeto } = await queryCompteursJournee(
      fauxClient(lignesDe(MESURE)),
      '2026-10-19',
      '2027-01-10',
      true,
    )
    expect(parVeto.size).toBe(0)
  })

  it('« validées seulement » compte un planning publié', async () => {
    const { parVeto } = await queryCompteursJournee(
      fauxClient(lignesDe({ Jean: [1, 2, 3] }, 'publie')),
      '2026-10-19',
      '2027-01-10',
      true,
    )
    expect(parVeto.get('Jean')).toEqual({ matin: 1, apres_midi: 2, entiere: 3 })
  })

  it('ne s’arrête pas à la première page de 1000 lignes', async () => {
    const { parVeto } = await queryCompteursJournee(
      fauxClient(lignesDe({ Jean: [700, 600, 200] })),
      '2026-01-01',
      '2026-12-31',
    )
    expect(parVeto.get('Jean')).toEqual({ matin: 700, apres_midi: 600, entiere: 200 })
  })
})
