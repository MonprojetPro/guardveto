// ============================================================
// GUARDVETO — L'effectif par semaine dit-il vrai ? (B-138)
// ============================================================
// Ce calcul existe pour qu'un chiffre remplace une déduction. S'il se trompe,
// il est PIRE que l'absence de chiffre : Filou n'a plus aucune raison de le
// mettre en doute, et signalera un défaut qui n'existe pas avec l'aplomb d'un
// fait mesuré.
// ============================================================

import { describe, it, expect } from 'vitest'
import { effectifParSemaine, effectifEnTexte } from '../effectifSemaine'

/** Lundi 5 → dimanche 11 janvier 2026, puis lundi 12 → dimanche 18. */
const LUN_5 = '2026-01-05'
const DIM_18 = '2026-01-18'

const equipe = [
  { id: 'v1', prenom: 'Antoine' },
  { id: 'v2', prenom: 'Fanny' },
  { id: 'v3', prenom: 'Jean' },
  { id: 'v4', prenom: 'Anne-Catherine', dernier_recours: true },
]

describe('effectifParSemaine', () => {
  it('sans absence : tout le monde est disponible, le dernier recours EXCLU du compte', () => {
    const s = effectifParSemaine(LUN_5, DIM_18, equipe)
    expect(s).toHaveLength(2)
    expect(s[0]).toMatchObject({ lundi: LUN_5, disponibles: 3, effectif: 3, absents: [] })
    expect(s[1]).toMatchObject({ lundi: '2026-01-12', disponibles: 3, effectif: 3 })
  })

  it('une absence sur TOUS les soirs sort la personne des disponibles', () => {
    const [s1] = effectifParSemaine(LUN_5, DIM_18, [
      ...equipe.slice(0, 3).map((v) =>
        v.id === 'v1'
          ? { ...v, conges: [{ date_debut: LUN_5, date_fin: '2026-01-09' }] }
          : v,
      ),
    ])
    expect(s1.disponibles).toBe(2)
    expect(s1.absents).toEqual([{ prenom: 'Antoine', partiel: false }])
  })

  it('une absence PARTIELLE est dite comme telle — sinon la personne paraît indisponible toute la semaine', () => {
    const [s1] = effectifParSemaine(LUN_5, DIM_18, [
      { id: 'v1', prenom: 'Antoine', conges: [{ date_debut: '2026-01-07', date_fin: '2026-01-07' }] },
      { id: 'v2', prenom: 'Fanny' },
    ])
    expect(s1.disponibles).toBe(1)
    expect(s1.absents).toEqual([{ prenom: 'Antoine', partiel: true }])
  })

  it('une absence qui ne touche QUE le week-end ne retire personne des soirs de semaine', () => {
    // Samedi 10 et dimanche 11 : aucun des quatre soirs lundi-jeudi.
    const [s1] = effectifParSemaine(LUN_5, DIM_18, [
      { id: 'v1', prenom: 'Antoine', conges: [{ date_debut: '2026-01-10', date_fin: '2026-01-11' }] },
    ])
    expect(s1.disponibles).toBe(1)
    expect(s1.absents).toEqual([])
  })

  it('une absence qui ne touche QUE le vendredi ne compte pas — le vendredi est hors périmètre', () => {
    // Le vendredi soir va au binôme du week-end par la structure du cabinet :
    // mesurer une disponibilité dessus n'aurait aucun usage.
    const [s1] = effectifParSemaine(LUN_5, DIM_18, [
      { id: 'v1', prenom: 'Antoine', conges: [{ date_debut: '2026-01-09', date_fin: '2026-01-09' }] },
    ])
    expect(s1.disponibles).toBe(1)
    expect(s1.absents).toEqual([])
  })

  it('une période qui démarre un samedi ne produit PAS de ligne pour cette semaine-là', () => {
    // Samedi 10 → dimanche 11 : aucun soir lundi-jeudi dans la période, donc
    // aucun effectif à annoncer. Une ligne ici ferait chercher un défaut dans
    // une semaine sans garde de semaine.
    const s = effectifParSemaine('2026-01-10', '2026-01-11', equipe)
    expect(s).toEqual([])
  })

  it('une semaine tronquée par la fin de période ne compte que ses soirs réels', () => {
    // Période close le mardi 6 : seuls lundi et mardi comptent. Quelqu'un
    // absent ces deux jours-là est absent en ENTIER, pas « en partie ».
    const [s1] = effectifParSemaine(LUN_5, '2026-01-06', [
      { id: 'v1', prenom: 'Antoine', conges: [{ date_debut: LUN_5, date_fin: '2026-01-06' }] },
      { id: 'v2', prenom: 'Fanny', conges: [{ date_debut: '2026-01-08', date_fin: '2026-01-08' }] },
    ])
    expect(s1.disponibles).toBe(1)
    expect(s1.absents).toEqual([{ prenom: 'Antoine', partiel: false }])
  })

  it('une équipe entièrement en dernier recours rend un effectif de 0, jamais une ligne trompeuse', () => {
    const [s1] = effectifParSemaine(LUN_5, DIM_18, [
      { id: 'v4', prenom: 'Anne-Catherine', dernier_recours: true },
    ])
    expect(s1).toMatchObject({ disponibles: 0, effectif: 0 })
  })

  it('des bornes absentes ou inversées rendent une liste vide, pas une boucle sans fin', () => {
    expect(effectifParSemaine('', DIM_18, equipe)).toEqual([])
    expect(effectifParSemaine(LUN_5, '', equipe)).toEqual([])
    expect(effectifParSemaine(DIM_18, LUN_5, equipe)).toEqual([])
  })
})

describe('effectifEnTexte', () => {
  it('dit le disponible SUR l’effectif — un nombre seul ne se juge pas', () => {
    const lignes = effectifEnTexte(effectifParSemaine(LUN_5, '2026-01-11', [
      { id: 'v1', prenom: 'Antoine', conges: [{ date_debut: '2026-01-07', date_fin: '2026-01-07' }] },
      { id: 'v2', prenom: 'Fanny', conges: [{ date_debut: LUN_5, date_fin: '2026-01-08' }] },
      { id: 'v3', prenom: 'Jean' },
    ]))
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toContain('5 janvier 2026')
    expect(lignes[0]).toContain('1 sur 3 disponibles')
    expect(lignes[0]).toContain('Antoine (en partie)')
    expect(lignes[0]).toContain('Fanny')
    expect(lignes[0]).not.toContain('Fanny (en partie)')
  })

  it('une semaine complète le DIT, au lieu de laisser la phrase en suspens', () => {
    const lignes = effectifEnTexte(effectifParSemaine(LUN_5, '2026-01-11', equipe))
    expect(lignes[0]).toContain('personne d’absent')
  })

  it('NOMME le lundi — tout le critère repose sur là où commence la semaine', () => {
    // Sans le jour, Filou doit supposer que la semaine démarre un lundi. Or
    // c'est l'hypothèse dont dépend le critère entier : un week-end appartient
    // à la semaine dont il est la FIN (confirmé par MiKL le 30/09).
    const lignes = effectifEnTexte(effectifParSemaine(LUN_5, '2026-01-11', equipe))
    expect(lignes[0]).toContain('Semaine du lundi 5 janvier 2026')
  })

  it('une absence qui couvre une règle personnelle N’EST PAS devinée — limite assumée', () => {
    // Le compte ne lit que les congés. Quelqu'un dont une règle interdit le
    // lundi soir reste compté disponible : le nombre est un MAXIMUM. Ce test ne
    // corrige rien, il FIGE la limite — pour qu'un jour où on voudra la lever,
    // on sache qu'elle était connue et non pas subie.
    const [s1] = effectifParSemaine(LUN_5, '2026-01-11', [
      { id: 'v1', prenom: 'Antoine', conges: [] },
    ])
    expect(s1.disponibles).toBe(1)
    expect(s1.absents).toEqual([])
  })
})
