// ============================================================
// GUARDVETO — Ce que Google reçoit comme dates (B-078)
// ============================================================
// Deux choses se jouent ici, et les deux ne se voyaient qu'en production.
//
// ① LE FUSEAU DU SERVEUR. La cliente a mesuré le 27/08 : `creneau_modele`
//    porte 18:00 → 08:00 (+1), son agenda affichait 20:00 → 10:00. Exactement
//    +2 h, le décalage UTC → Europe/Paris en heure d'été. On construisait des
//    `Date` locales puis un `.toISOString()` : instant ABSOLU, donc `timeZone`
//    ignoré par Google, donc juste en local (Paris) et faux sur Vercel (UTC).
//    Le premier test FORCE le fuseau du processus à UTC — sur une machine
//    française, il passerait sans rien prouver.
//
// ② LA FIN EXCLUSIVE des événements journée entière. Un événement d'un seul
//    jour le 29/09 s'écrit end 2026-09-30. L'erreur classique décale tout d'un
//    jour et ne se découvre que chez le client.
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  construirePeriodeEvenement,
  joursCouvertsParGarde,
  FUSEAU_PAR_DEFAUT,
} from '../google-calendar'

// Val d'Allier — semaine_soir 18:00 → 08:00 (+1 jour), tel que mesuré en base.
// On le passe en `structure` plutôt que d'utiliser le catalogue par défaut
// (18:30) : c'est le créneau réel derrière le constat de la cliente.
const VAL_DALLIER = {
  semaine_soir: { heureDebut: '18:00', heureFin: '08:00', offsetJoursFin: 1 },
}

describe('B-078 ① — le fuseau du SERVEUR ne doit rien changer', () => {
  const tzInitial = process.env.TZ

  beforeAll(() => {
    // Vercel tourne en UTC. Node ≥ 16 recharge son cache de fuseau à chaque
    // écriture de process.env.TZ, donc la bascule est effective ici.
    process.env.TZ = 'UTC'
  })
  afterAll(() => {
    if (tzInitial === undefined) delete process.env.TZ
    else process.env.TZ = tzInitial
  })

  it('le processus tourne bien en UTC (sinon ce fichier ne prouve rien)', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC')
  })

  it('18:00 en base reste 18:00 pour Google, et non 20:00', () => {
    const p = construirePeriodeEvenement('2026-09-29', 'semaine', VAL_DALLIER, {
      mode: 'horaire',
    })

    expect(p.start).toEqual({ dateTime: '2026-09-29T18:00:00', timeZone: 'Europe/Paris' })
    expect(p.end).toEqual({ dateTime: '2026-09-30T08:00:00', timeZone: 'Europe/Paris' })
  })

  it('aucun suffixe de fuseau : un instant absolu ferait IGNORER timeZone', () => {
    const p = construirePeriodeEvenement('2026-09-29', 'semaine', VAL_DALLIER, {
      mode: 'horaire',
    })

    // C'est précisément le `Z` produit par .toISOString() qui causait le bug.
    expect(p.start.dateTime).not.toMatch(/Z$|[+-]\d{2}:\d{2}$/)
    expect(p.end.dateTime).not.toMatch(/Z$|[+-]\d{2}:\d{2}$/)
  })

  it('le jour ne bascule pas : un week-end couvre bien vendredi → lundi', () => {
    // Le calcul des jours passait lui aussi par des `Date` locales. Près de
    // minuit, un décalage de fuseau y ferait sauter un jour entier.
    const p = construirePeriodeEvenement('2026-10-03', 'weekend', undefined, {
      mode: 'horaire',
    })

    expect(p.start.dateTime).toBe('2026-10-02T18:30:00') // vendredi soir
    expect(p.end.dateTime).toBe('2026-10-05T08:30:00')   // lundi matin
  })

  it('le fuseau est un PARAMÈTRE, Europe/Paris n’étant que le défaut', () => {
    const p = construirePeriodeEvenement('2026-09-29', 'semaine', VAL_DALLIER, {
      mode: 'horaire',
      fuseau: 'Indian/Reunion',
    })

    expect(FUSEAU_PAR_DEFAUT).toBe('Europe/Paris')
    expect(p.start.timeZone).toBe('Indian/Reunion')
    // L'heure écrite ne bouge PAS : c'est Google qui la situe.
    expect(p.start.dateTime).toBe('2026-09-29T18:00:00')
  })
})

describe('B-078 ② — journée entière : la fin est EXCLUSIVE', () => {
  it('garde de semaine : un seul jour, donc end = jour + 1', () => {
    const p = construirePeriodeEvenement('2026-09-29', 'semaine', VAL_DALLIER)

    // Le mardi matin 08:00 n'est pas un jour de garde : on rend la garde.
    expect(p).toEqual({
      start: { date: '2026-09-29' },
      end: { date: '2026-09-30' },
    })
    expect(p.start.dateTime).toBeUndefined()
  })

  it('journée entière est le DÉFAUT (des blocs de 14 h mangeaient la grille)', () => {
    const parDefaut = construirePeriodeEvenement('2026-09-29', 'semaine', VAL_DALLIER)
    const explicite = construirePeriodeEvenement('2026-09-29', 'semaine', VAL_DALLIER, {
      mode: 'journee',
    })
    expect(parDefaut).toEqual(explicite)
  })

  it('week-end : vendredi, samedi, dimanche — et end au lundi', () => {
    const p = construirePeriodeEvenement('2026-10-03', 'weekend')

    expect(p).toEqual({
      start: { date: '2026-10-02' },
      end: { date: '2026-10-05' }, // exclusif : le dimanche est le dernier jour
    })
  })

  it('férié : la nuit qui suit ne fait pas un deuxième jour', () => {
    const p = construirePeriodeEvenement('2026-11-11', 'ferie')

    expect(p).toEqual({
      start: { date: '2026-11-11' },
      end: { date: '2026-11-12' },
    })
  })
})

describe('B-078 ② — les jours réellement occupés', () => {
  it('garde de semaine : le lundi seul, pas le mardi matin', () => {
    expect(joursCouvertsParGarde('2026-09-29', 'semaine', VAL_DALLIER))
      .toEqual(['2026-09-29'])
  })

  it('week-end : les trois jours, dans l’ordre', () => {
    expect(joursCouvertsParGarde('2026-10-03', 'weekend'))
      .toEqual(['2026-10-02', '2026-10-03', '2026-10-04'])
  })

  it('créneau sur-mesure de JOURNÉE (08:30 → 18:30) : son jour, entier', () => {
    // La fin n'est pas matinale : rien à retirer. Le garde-fou ne doit pas
    // s'appliquer à tort à un créneau qui ne traverse aucune nuit.
    const structure = {
      consult_dimanche: { heureDebut: '08:30', heureFin: '18:30', offsetJoursFin: 0 },
    }
    expect(joursCouvertsParGarde('2026-10-04', 'consult_dimanche', structure))
      .toEqual(['2026-10-04'])
  })

  it('un mois change sans dérapage : 31/12 → 01/01', () => {
    // Les bascules de mois et d'année sont le terrain de jeu classique des
    // calculs de date approximatifs.
    expect(joursCouvertsParGarde('2026-12-31', 'ferie')).toEqual(['2026-12-31'])
    expect(construirePeriodeEvenement('2026-12-31', 'ferie').end.date).toBe('2027-01-01')
  })

  it('une garde occupe toujours au moins un jour', () => {
    // Créneau dégénéré (offset 0 et fin matinale) : le retrait passerait avant
    // le jour de début. Il ne doit produire ni liste vide, ni boucle folle.
    const structure = {
      bizarre: { heureDebut: '18:00', heureFin: '08:00', offsetJoursFin: 0 },
    }
    expect(joursCouvertsParGarde('2026-10-04', 'bizarre', structure))
      .toEqual(['2026-10-04'])
  })
})
