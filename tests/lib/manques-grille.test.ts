// ============================================================
// B-125 — les places qui manquent, telles que la grille doit les dessiner
// ============================================================
// Le piège central de ce module n'est pas de compter juste : c'est de SE TAIRE
// quand on ne sait pas. Une case « à pourvoir » affichée à tort envoie l'admin
// chercher un remplaçant pour une garde déjà complète — exactement le travail
// inutile que MiKL demande d'éviter.
// ============================================================
import { describe, it, expect } from 'vitest'
import { calculerManques } from '@/lib/planning/manquesGrille'
import { construireCatalogue, type PeriodeEffectif } from '@/lib/planning/placesAttendues'

const PERIODE: PeriodeEffectif = {
  date_debut: '2026-10-19',
  date_fin: '2027-01-10',
  saison: 'hiver',
  nb_vetos_semaine_soir: null,
}

const contexte = (catalogue: Parameters<typeof calculerManques>[1]['catalogue']) => ({
  catalogue,
  periodes: [PERIODE],
  profils: new Map(),
})

describe('construireCatalogue', () => {
  it('retient le nombre de places de chaque code', () => {
    const c = construireCatalogue([
      { code: 'weekend', nb_places: 2 },
      { code: 'semaine_soir', nb_places: 1 },
    ])
    expect(c.get('weekend')).toBe(2)
    expect(c.get('semaine_soir')).toBe(1)
  })

  it('rend « indetermine » quand deux profils ne sont pas d’accord sur un code', () => {
    // Le point qui compte : on ne tranche PAS en faveur du premier lu.
    const c = construireCatalogue([
      { code: 'weekend', nb_places: 2 },
      { code: 'weekend', nb_places: 3 },
    ])
    expect(c.get('weekend')).toBeNull()
  })

  it('ignore les lignes sans code', () => {
    expect(construireCatalogue([{ code: null, nb_places: 2 }]).size).toBe(0)
  })
})

describe('calculerManques', () => {
  it('signale le second manquant sur un week-end a deux places', () => {
    // Le cas réel du 17/09 : Manon seule sur le week-end du 6-8 novembre.
    const manques = calculerManques(
      [{ id: 'g1', date: '2026-11-07', type: 'weekend', pourvues: 1 }],
      contexte(construireCatalogue([{ code: 'weekend', nb_places: 2 }])),
    )
    expect(manques).toEqual({ g1: 1 })
  })

  it('ne dit RIEN d’une garde complete', () => {
    const manques = calculerManques(
      [{ id: 'g1', date: '2026-11-07', type: 'weekend', pourvues: 2 }],
      contexte(construireCatalogue([{ code: 'weekend', nb_places: 2 }])),
    )
    expect(manques).toEqual({})
  })

  it('ne dit RIEN quand le catalogue est muet — jamais de trou invente', () => {
    const manques = calculerManques(
      [{ id: 'g1', date: '2026-11-07', type: 'weekend', pourvues: 1 }],
      contexte(construireCatalogue([])),
    )
    expect(manques).toEqual({})
  })

  it('ne dit RIEN quand les profils se contredisent sur le code', () => {
    const manques = calculerManques(
      [{ id: 'g1', date: '2026-11-07', type: 'weekend', pourvues: 1 }],
      contexte(
        construireCatalogue([
          { code: 'weekend', nb_places: 2 },
          { code: 'weekend', nb_places: 3 },
        ]),
      ),
    )
    expect(manques).toEqual({})
  })

  it("n’invente pas de second sur un creneau qui n’attend qu’une personne", () => {
    // Le défaut que `placesAttendues` avait été écrit pour corriger : supposer
    // « toujours deux » faisait annoncer un manque sur chaque nuit de semaine.
    const manques = calculerManques(
      [{ id: 'g1', date: '2026-11-10', type: 'semaine', pourvues: 1 }],
      contexte(construireCatalogue([{ code: 'semaine_soir', nb_places: 1 }])),
    )
    expect(manques).toEqual({})
  })

  it('retient le PLUS PETIT entre le catalogue et l’effectif de la periode', () => {
    // Un cabinet réglé à 1 véto le soir, sur un créneau qui en déclare 2 :
    // le moteur ne pourvoit qu'une place, l'écran ne doit pas en réclamer deux.
    const manques = calculerManques(
      [{ id: 'g1', date: '2026-11-10', type: 'semaine', pourvues: 1 }],
      {
        catalogue: construireCatalogue([{ code: 'semaine_soir', nb_places: 2 }]),
        periodes: [{ ...PERIODE, nb_vetos_semaine_soir: 1 }],
        profils: new Map(),
      },
    )
    expect(manques).toEqual({})
  })

  it('compte plusieurs manques sur la meme garde', () => {
    const manques = calculerManques(
      [{ id: 'g1', date: '2026-11-07', type: 'weekend', pourvues: 1 }],
      contexte(construireCatalogue([{ code: 'weekend', nb_places: 3 }])),
    )
    expect(manques).toEqual({ g1: 2 })
  })

  it('ne rend que les gardes concernees, jamais une entree a zero', () => {
    const manques = calculerManques(
      [
        { id: 'plein', date: '2026-11-07', type: 'weekend', pourvues: 2 },
        { id: 'vide', date: '2026-11-14', type: 'weekend', pourvues: 0 },
      ],
      contexte(construireCatalogue([{ code: 'weekend', nb_places: 2 }])),
    )
    expect(Object.keys(manques)).toEqual(['vide'])
    expect(manques.vide).toBe(2)
  })
})
