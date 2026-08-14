// ============================================================
// GUARDVETO — L'import d'un ancien planning ne doit RIEN inventer
// ============================================================
// Ce que ces tests protègent n'est pas une fonctionnalité, c'est une
// promesse : un nom que le modèle a mal lu doit ressortir en TROU, jamais en
// garde attribuée à quelqu'un. Une garde inventée le jour d'une démonstration
// est le pire scénario possible — pire qu'une case vide, parce qu'elle se
// croit vraie.
//
// Le reste vérifie les trois pièges d'écriture qui ne se voient pas à l'œil :
// le samedi d'ancrage d'un week-end, le lundi obligatoire d'une période, et
// la fin de semaine qui doit couvrir le dernier week-end.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  ancrerSamedi,
  dimancheDeLaSemaine,
  lundiDeLaSemaine,
  normaliser,
  rattacher,
  resoudreVeto,
  saisonDe,
} from '@/lib/ia/lirePlanningImporte'
import type { VetoConnu } from '@/lib/ia/importTypes'

/** Le cabinet pilote : deux prénoms qui commencent pareil, un nom composé.
 *  C'est exactement là que la résolution se casse quand elle est laxiste. */
const VETS: VetoConnu[] = [
  { id: 'v-fanny', prenom: 'Fanny', nom: 'Altieri' },
  { id: 'v-ac', prenom: 'Anne-Catherine', nom: 'Bernard' },
  { id: 'v-as', prenom: 'Anne-Sophie', nom: 'Blanchard' },
  { id: 'v-victor', prenom: 'Victor', nom: 'Coelho' },
  { id: 'v-jean', prenom: 'Jean', nom: 'De Thoisy' },
  { id: 'v-antoine', prenom: 'Antoine', nom: 'Lafarge' },
  { id: 'v-manon', prenom: 'Manon', nom: 'Renaud' },
]

describe('normaliser', () => {
  it('efface accents, casse et ponctuation', () => {
    expect(normaliser('Anne-Sophie')).toBe('anne sophie')
    expect(normaliser('  ANNE   SOPHIE ')).toBe('anne sophie')
    expect(normaliser('Coelho')).toBe('coelho')
  })
})

describe('resoudreVeto', () => {
  it('reconnaît un prénom écrit tel quel, quelle que soit la casse', () => {
    expect(resoudreVeto('Manon', VETS)?.id).toBe('v-manon')
    expect(resoudreVeto('manon', VETS)?.id).toBe('v-manon')
    expect(resoudreVeto('  MANON  ', VETS)?.id).toBe('v-manon')
  })

  it('reconnaît « prénom nom » et le nom seul', () => {
    expect(resoudreVeto('Anne-Sophie Blanchard', VETS)?.id).toBe('v-as')
    expect(resoudreVeto('Lafarge', VETS)?.id).toBe('v-antoine')
  })

  it('reconnaît une abréviation courante du prénom', () => {
    expect(resoudreVeto('Anne-Cath', VETS)?.id).toBe('v-ac')
    expect(resoudreVeto('Vic', VETS)?.id).toBe('v-victor')
  })

  it('reconnaît des initiales', () => {
    expect(resoudreVeto('AS', VETS)?.id).toBe('v-as')
    expect(resoudreVeto('AC', VETS)?.id).toBe('v-ac')
    expect(resoudreVeto('JDT', VETS)?.id).toBe('v-jean')
  })

  it('REFUSE quand c’est ambigu — deux Anne, personne', () => {
    // « Anne » désigne aussi bien Anne-Catherine qu'Anne-Sophie. Trancher au
    // hasard donnerait une garde attribuée à la mauvaise personne, et rien
    // à l'écran ne le signalerait.
    expect(resoudreVeto('Anne', VETS)).toBeNull()
    expect(resoudreVeto('An', VETS)).toBeNull()
  })

  it('REFUSE un nom que le cabinet ne connaît pas', () => {
    expect(resoudreVeto('Dupont', VETS)).toBeNull()
    expect(resoudreVeto('Sophie Marceau', VETS)).toBeNull()
    expect(resoudreVeto('', VETS)).toBeNull()
    expect(resoudreVeto('   ', VETS)).toBeNull()
  })
})

describe('rattacher — ce qui n’est pas reconnu devient un trou, jamais une garde', () => {
  it('rattache ce qu’il reconnaît et signale le reste', () => {
    const r = rattacher(
      {
        gardes: [
          { date: '2026-04-11', type: 'weekend', premier: 'Manon', second: 'Dupont' },
          { date: '2026-04-14', type: 'semaine', premier: 'Anne', second: '' },
        ],
        illisibles: [],
        remarque: 'Deux semaines lues.',
      },
      VETS,
    )

    expect(r.lignes).toHaveLength(2)

    const weekend = r.lignes[0]
    expect(weekend.premierId).toBe('v-manon')
    // « Dupont » n'existe pas : la case reste VIDE et le nom lu est signalé.
    expect(weekend.secondId).toBeNull()
    expect(weekend.inconnus).toEqual(['Dupont'])
    expect(weekend.secondLu).toBe('Dupont')

    // « Anne » est ambigu : rien n'est attribué.
    expect(r.lignes[1].premierId).toBeNull()
    expect(r.lignes[1].inconnus).toEqual(['Anne'])
  })

  it('n’invente pas une date : une date illisible sort de la liste et se déclare', () => {
    const r = rattacher(
      {
        gardes: [
          { date: 'samedi 12 avril', type: 'weekend', premier: 'Manon', second: '' },
          { date: '2026-13-45', type: 'weekend', premier: 'Victor', second: '' },
          { date: '2026-04-11', type: 'weekend', premier: 'Victor', second: '' },
        ],
        illisibles: ['La colonne de droite est coupée.'],
        remarque: '',
      },
      VETS,
    )

    expect(r.lignes).toHaveLength(1)
    expect(r.lignes[0].date).toBe('2026-04-11')
    // Le trou déclaré d'origine ET les deux dates refusées.
    expect(r.illisibles).toHaveLength(3)
    expect(r.illisibles[0]).toContain('coupée')
  })

  it('une case vide reste vide — elle ne se devine pas', () => {
    const r = rattacher(
      {
        gardes: [{ date: '2026-04-11', type: 'weekend', premier: 'Manon', second: '' }],
        illisibles: [],
        remarque: '',
      },
      VETS,
    )
    expect(r.lignes[0].secondId).toBeNull()
    // Une case laissée blanche par le cabinet n'est pas une anomalie : rien
    // à signaler, juste personne.
    expect(r.lignes[0].inconnus).toEqual([])
  })

  it('range les lignes dans l’ordre du calendrier', () => {
    const r = rattacher(
      {
        gardes: [
          { date: '2026-05-02', type: 'weekend', premier: 'Manon', second: '' },
          { date: '2026-04-11', type: 'weekend', premier: 'Victor', second: '' },
          { date: '2026-04-14', type: 'semaine', premier: 'Jean', second: '' },
        ],
        illisibles: [],
        remarque: '',
      },
      VETS,
    )
    expect(r.lignes.map((l) => l.date)).toEqual(['2026-04-11', '2026-04-14', '2026-05-02'])
  })
})

describe('ancrerSamedi — le week-end tient sur une seule ligne, à sa date de samedi', () => {
  // La vue `planning_semaine` déduit le vendredi (date − 1) et le dimanche
  // (date + 1) de cette unique ligne : un week-end posé sur le dimanche
  // décale tout le week-end d'un jour à l'affichage, sans erreur visible.
  it('ramène un dimanche et un vendredi sur leur samedi', () => {
    expect(ancrerSamedi('2026-04-12', 'weekend')).toBe('2026-04-11') // dimanche
    expect(ancrerSamedi('2026-04-10', 'weekend')).toBe('2026-04-11') // vendredi
    expect(ancrerSamedi('2026-04-11', 'weekend')).toBe('2026-04-11') // déjà samedi
  })

  it('ne touche jamais à une garde de semaine ni à un férié', () => {
    expect(ancrerSamedi('2026-04-14', 'semaine')).toBe('2026-04-14')
    expect(ancrerSamedi('2026-05-01', 'ferie')).toBe('2026-05-01')
  })

  it('laisse tel quel un week-end daté en plein milieu de semaine (on ne devine pas)', () => {
    expect(ancrerSamedi('2026-04-14', 'weekend')).toBe('2026-04-14')
  })
})

describe('bornes de la période importée', () => {
  it('commence toujours un lundi — la base l’exige', () => {
    // `periodes` porte la contrainte `debut_lundi` : une période qui
    // commencerait un jeudi est refusée par PostgreSQL, et l'import
    // échouerait à la dernière seconde.
    expect(lundiDeLaSemaine('2026-04-11')).toBe('2026-04-06') // samedi → lundi
    expect(lundiDeLaSemaine('2026-04-12')).toBe('2026-04-06') // dimanche → lundi
    expect(lundiDeLaSemaine('2026-04-06')).toBe('2026-04-06') // déjà lundi
  })

  it('se termine au dimanche de la dernière semaine — sinon elle coupe un week-end en deux', () => {
    expect(dimancheDeLaSemaine('2026-04-11')).toBe('2026-04-12')
    expect(dimancheDeLaSemaine('2026-04-06')).toBe('2026-04-12')
  })

  it('la fin reste strictement après le début, même sur une seule garde', () => {
    const debut = lundiDeLaSemaine('2026-04-11')
    const fin = dimancheDeLaSemaine('2026-04-11')
    expect(fin > debut).toBe(true)
  })
})

describe('saisonDe — colonne héritée, mais NOT NULL', () => {
  it('mai à septembre = été, le reste = hiver', () => {
    expect(saisonDe('2026-05-04')).toBe('ete')
    expect(saisonDe('2026-09-28')).toBe('ete')
    expect(saisonDe('2026-10-05')).toBe('hiver')
    expect(saisonDe('2026-01-05')).toBe('hiver')
  })
})
