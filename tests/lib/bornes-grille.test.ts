import { describe, it, expect } from 'vitest'
import { bornesMois, bornesGrille, genererGrille } from '@/lib/planning/bornes-grille'

/**
 * CE QUE CE TEST PROTÈGE.
 *
 * La vue planning dessine des semaines pleines (`genererGrille`) et charge ses
 * données sur une fenêtre (`bornesGrille`). Tant que les deux vivaient dans deux
 * fichiers séparés, elles ont divergé sans bruit : la semaine à cheval sur deux
 * mois était dessinée mais VIDE, et une case vide se lit « pas de garde ce
 * jour-là », jamais « pas chargé ».
 *
 * Le test ne vérifie donc pas une formule de calendrier : il vérifie que ce qui
 * est DESSINÉ et ce qui est CHARGÉ couvrent exactement le même intervalle.
 *
 * ⚠️ Honnêteté sur sa portée : depuis que `genererGrille` DÉRIVE de
 * `bornesGrille`, le premier cas est presque tautologique — c'est la fusion des
 * deux calculs qui protège, pas lui. Il n'attrape qu'une chose, mais elle
 * compte : quelqu'un qui réintroduirait un calcul de grille indépendant. Les
 * cas suivants, eux, tiennent sur des valeurs en dur et restent mordants.
 */
describe('bornes de la vue planning', () => {
  const tousLesMois: string[] = []
  for (let annee = 2024; annee <= 2030; annee++) {
    for (let mois = 1; mois <= 12; mois++) {
      tousLesMois.push(`${annee}-${String(mois).padStart(2, '0')}`)
    }
  }

  it('la fenêtre de chargement couvre exactement la grille dessinée', () => {
    for (const anneeMois of tousLesMois) {
      const [annee, mois] = anneeMois.split('-').map(Number)
      const cases = genererGrille(annee, mois)
      const fenetre = bornesGrille(anneeMois)
      expect(cases[0], `premier jour dessiné — ${anneeMois}`).toBe(fenetre.debut)
      expect(cases[cases.length - 1], `dernier jour dessiné — ${anneeMois}`).toBe(fenetre.fin)
    }
  })

  it('la grille ne contient que des semaines pleines, du lundi au dimanche', () => {
    for (const anneeMois of tousLesMois) {
      const [annee, mois] = anneeMois.split('-').map(Number)
      const cases = genererGrille(annee, mois)
      expect(cases.length % 7, `nombre de cases — ${anneeMois}`).toBe(0)
      const premier = new Date(cases[0] + 'T12:00:00Z').getUTCDay()
      const dernier = new Date(cases[cases.length - 1] + 'T12:00:00Z').getUTCDay()
      expect(premier, `${anneeMois} doit commencer un lundi`).toBe(1)
      expect(dernier, `${anneeMois} doit finir un dimanche`).toBe(0)
    }
  })

  it('la grille contient tout le mois, sans trou ni doublon', () => {
    for (const anneeMois of tousLesMois) {
      const [annee, mois] = anneeMois.split('-').map(Number)
      const cases = genererGrille(annee, mois)
      const { debut, fin } = bornesMois(anneeMois)
      expect(cases, `${anneeMois} doit contenir son 1er`).toContain(debut)
      expect(cases, `${anneeMois} doit contenir son dernier jour`).toContain(fin)
      expect(new Set(cases).size, `dates dupliquées — ${anneeMois}`).toBe(cases.length)
      // Suite continue : chaque case suit la précédente d'un jour, jamais plus.
      for (let i = 1; i < cases.length; i++) {
        const veille = new Date(cases[i - 1] + 'T12:00:00Z')
        veille.setUTCDate(veille.getUTCDate() + 1)
        expect(cases[i], `trou dans la grille — ${anneeMois}`).toBe(
          veille.toISOString().slice(0, 10),
        )
      }
    }
  })

  it('déborde bien des deux côtés quand le mois ne tombe pas sur des semaines pleines', () => {
    // Septembre 2026 : le 1er est un mardi, le 30 un mercredi.
    expect(bornesGrille('2026-09')).toEqual({ debut: '2026-08-31', fin: '2026-10-04' })
    // Février 2027 : commence un lundi et finit un dimanche — aucun débordement,
    // la fenêtre doit alors coller exactement au mois.
    expect(bornesGrille('2027-02')).toEqual(bornesMois('2027-02'))
  })

  it('bornesMois reste sur le mois strict — c’est elle qui porte l’identité de la période', () => {
    expect(bornesMois('2026-09')).toEqual({ debut: '2026-09-01', fin: '2026-09-30' })
    expect(bornesMois('2026-02')).toEqual({ debut: '2026-02-01', fin: '2026-02-28' })
    expect(bornesMois('2028-02')).toEqual({ debut: '2028-02-01', fin: '2028-02-29' })
    expect(bornesMois('2026-12')).toEqual({ debut: '2026-12-01', fin: '2026-12-31' })
  })
})
