// ============================================================
// GUARDVETO — Un événement par personne et par jour (B-079)
// ============================================================
// Décision de MiKL : Victor 1er en bleu et Fanny 2nde en orange, c'est deux
// événements côte à côte — un événement Google ne porte qu'UNE couleur. Et
// chaque jour est individuel, samedi et dimanche compris, parce que le vendredi
// a les rôles inversés et qu'un remplacement peut ne valoir qu'un jour du bloc.
//
// Ce que ces tests protègent, dans l'ordre de ce que ça coûterait à la cliente :
//   ① un événement au nom de quelqu'un qui ne sera PAS là (place vacante) ;
//   ② une exception appliquée à la mauvaise personne le vendredi (rôles
//      inversés — piège déjà payé, cf. google-calendar-exceptions) ;
//   ③ la couleur du titulaire sur un jour tenu par son remplaçant ;
//   ④ un jour de trop, ou un jour manquant.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  planifierEvenementsGarde,
  type GardeAPlanifier,
  type OptionsPlanification,
} from '../google-calendar'

const ANNE = { vetId: 'v-anne', libelle: 'ASB', couleurGoogle: '7' }
const ANTOINE = { vetId: 'v-antoine', libelle: 'AD', couleurGoogle: '6' }
const MANON = { vetId: 'v-manon', libelle: 'MP', couleurGoogle: '11' }

/** Samedi — la ligne `gardes` d'un week-end vit sur le samedi. */
const WEEKEND: GardeAPlanifier = {
  date: '2026-10-03',
  type: 'weekend',
  places: [ANNE, ANTOINE],
  base: 'garde',
}

const options: OptionsPlanification = { afficherHoraires: false }

/** Vue compacte : ce que la grille Google montrera, jour par jour. */
const apercu = (g: GardeAPlanifier, o: OptionsPlanification = options) =>
  planifierEvenementsGarde(g, o).map((e) => `${e.jour} #${e.placeIndex} ${e.titre} [${e.colorId ?? '-'}]`)

describe('B-079 — le bloc éclate en un événement par personne et par jour', () => {
  it('un week-end ordinaire : 3 jours × 2 places = 6 événements', () => {
    expect(apercu(WEEKEND)).toEqual([
      // Vendredi : rôles INVERSÉS. Antoine, 2nd du week-end, est 1er ce soir-là.
      '2026-10-02 #0 garde-AD-1er [6]',
      '2026-10-02 #1 garde-ASB-2nd [7]',
      '2026-10-03 #0 garde-ASB-1er [7]',
      '2026-10-03 #1 garde-AD-2nd [6]',
      '2026-10-04 #0 garde-ASB-1er [7]',
      '2026-10-04 #1 garde-AD-2nd [6]',
    ])
  })

  it('une garde de semaine : un seul jour, deux places', () => {
    expect(apercu({ date: '2026-09-29', type: 'semaine', places: [ANNE, ANTOINE], base: 'garde' }))
      .toEqual([
        '2026-09-29 #0 garde-ASB-1er [7]',
        '2026-09-29 #1 garde-AD-2nd [6]',
      ])
  })

  it('une place jamais pourvue ne produit aucun événement', () => {
    // Un créneau à une seule place ne doit pas inventer un second de garde.
    expect(apercu({ date: '2026-09-29', type: 'semaine', places: [ANNE, null], base: 'garde' }))
      .toEqual(['2026-09-29 #0 garde-ASB-1er [7]'])
  })

  it('le rôle apparaît TOUJOURS : sans lui les deux événements du jour se confondent', () => {
    for (const ligne of apercu(WEEKEND)) {
      expect(ligne).toMatch(/-(1er|2nd)\s/)
    }
  })
})

describe('B-079 — les exceptions décident du nom ET de la couleur du jour', () => {
  it('un dimanche remplacé : ce jour-là seulement, et la couleur suit le remplaçant', () => {
    const lignes = apercu({
      ...WEEKEND,
      exceptions: [{ date: '2026-10-04', role: 'second', occupant: MANON }],
    })

    // La couleur est l'usage même de la fonctionnalité : un œil qui balaie
    // l'agenda verrait celle d'Antoine sur un jour qu'il ne tient pas.
    expect(lignes).toContain('2026-10-04 #1 garde-MP-2nd [11]')
    // Le samedi n'a pas bougé — un remplacement d'un jour ne déteint pas.
    expect(lignes).toContain('2026-10-03 #1 garde-AD-2nd [6]')
  })

  it('⚠️ le vendredi : l’exception vise le rôle AFFICHÉ, pas le rôle natif', () => {
    // Anne est 1re du week-end donc 2nde le vendredi. Une exception sur le
    // « 1er » du vendredi vise donc la place d'ANTOINE. L'appliquer au rôle
    // natif remplacerait Anne — silencieusement, et avec l'air d'être juste.
    const lignes = apercu({
      ...WEEKEND,
      exceptions: [{ date: '2026-10-02', role: 'premier', occupant: MANON }],
    })

    expect(lignes).toContain('2026-10-02 #0 garde-MP-1er [11]')
    expect(lignes).toContain('2026-10-02 #1 garde-ASB-2nd [7]') // Anne intacte
    expect(lignes).not.toContain('2026-10-02 #1 garde-MP-2nd [11]')
  })

  it('une place laissée VACANTE ne produit aucun événement', () => {
    const lignes = apercu({
      ...WEEKEND,
      exceptions: [{ date: '2026-10-04', role: 'second', occupant: null }],
    })

    // Le dimanche n'a plus qu'un événement. Mettre le nom du titulaire sur un
    // jour qu'on lui a retiré le ferait organiser sa journée sur une garde qui
    // ne lui appartient plus : un trou visible vaut mieux.
    expect(lignes.filter((l) => l.startsWith('2026-10-04'))).toEqual([
      '2026-10-04 #0 garde-ASB-1er [7]',
    ])
  })
})

describe('B-079 — les réglages du cabinet, jamais de défaut en dur', () => {
  it('journée entière : bornes en `date`, fin EXCLUSIVE', () => {
    const [premier] = planifierEvenementsGarde(WEEKEND, options)
    expect(premier.start).toEqual({ date: '2026-10-02' })
    expect(premier.end).toEqual({ date: '2026-10-03' }) // exclusive : le vendredi seul
  })

  it('mode horaire : chaque jour porte les horaires de SON créneau', () => {
    const evs = planifierEvenementsGarde(WEEKEND, { ...options, mode: 'horaire' })
    const vendredi = evs.find((e) => e.jour === '2026-10-02')!
    const samedi = evs.find((e) => e.jour === '2026-10-03')!

    // Vendredi = vendredi_soir (18h30 → 08h30 le lendemain). Coller les
    // horaires du week-end sur le vendredi serait faux.
    expect(vendredi.start.dateTime).toBe('2026-10-02T18:30:00')
    expect(vendredi.end.dateTime).toBe('2026-10-03T08:30:00')
    // Samedi = weekend (08h30). Chaque jour est un événement à lui seul :
    // plus de bloc de 48 h qui écraserait la grille.
    expect(samedi.start.dateTime).toBe('2026-10-03T08:30:00')
    // Le fuseau ne vient jamais du processus (B-078).
    expect(vendredi.start.timeZone).toBe('Europe/Paris')
    expect(vendredi.start.dateTime).not.toMatch(/Z$/)
  })

  it('afficherHoraires : le titre les porte, sans jamais les recalculer', () => {
    const lignes = apercu(WEEKEND, { afficherHoraires: true })
    expect(lignes[0]).toContain('garde-AD-1er-18h30/08h30')
    expect(lignes[2]).toContain('garde-ASB-1er-08h30/08h30')
  })

  it('le vendredi porte le nom de SON créneau, pas celui du week-end', () => {
    const lignes = apercu(WEEKEND, {
      ...options,
      baseParCode: (code) => (code === 'vendredi_soir' ? 'Vendredi' : 'WE'),
    })
    expect(lignes[0]).toBe('2026-10-02 #0 Vendredi-AD-1er [6]')
    expect(lignes[2]).toBe('2026-10-03 #0 WE-ASB-1er [7]')
  })

  it('⚠️ B-080 — le catalogue réel de Val d’Allier : premier/second s’abrègent', () => {
    // C'EST LE CAS QUI A ÉCHOUÉ EN RECETTE. `creneau_modele.roles` vaut
    // littéralement ['premier','second'] : le repli sur la place n'était donc
    // jamais atteint, et le titre affichait « Garde-JD-premier ».
    const lignes = apercu(WEEKEND, {
      ...options,
      rolesParCode: () => ['premier', 'second'],
    })
    expect(lignes[2]).toBe('2026-10-03 #0 garde-ASB-1er [7]')
    expect(lignes[3]).toBe('2026-10-03 #1 garde-AD-2nd [6]')
  })

  it('les rôles nommés par le cabinet priment sur ceux de l’application', () => {
    const lignes = apercu(WEEKEND, {
      ...options,
      rolesParCode: () => ['titulaire', 'renfort'],
    })
    expect(lignes[2]).toBe('2026-10-03 #0 garde-ASB-titulaire [7]')
    expect(lignes[3]).toBe('2026-10-03 #1 garde-AD-renfort [6]')
  })

  it('une couleur hors palette est ignorée, la garde reste affichée', () => {
    // Google refuserait l'appel entier pour un colorId invalide : une garde ne
    // doit pas disparaître de l'agenda à cause d'une couleur mal saisie.
    const lignes = apercu({
      date: '2026-09-29',
      type: 'semaine',
      places: [{ vetId: 'v-x', libelle: 'XX', couleurGoogle: '42' }],
      base: 'garde',
    })
    expect(lignes).toEqual(['2026-09-29 #0 garde-XX-1er [-]'])
  })
})

describe('B-079 — le cabinet qui a découplé ses créneaux', () => {
  it('sans `meme_binome`, le vendredi n’est PAS déduit du week-end', () => {
    // Le vendredi a alors sa propre garde en base ; le déduire ici inventerait
    // des occupants et ferait deux fois la même soirée dans l'agenda.
    const lignes = apercu(WEEKEND, { ...options, relations: [] })
    expect(lignes.some((l) => l.startsWith('2026-10-02'))).toBe(false)
    expect(lignes).toHaveLength(4) // samedi + dimanche seulement
  })
})
