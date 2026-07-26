// ============================================================
// Horaires des créneaux — les libellés affichés à l'écran
// ============================================================
// Ce sont des calculs de DATES : le genre de code qui se casse sans rien dire
// et qui affiche alors un horaire faux avec aplomb. Les cas testés viennent des
// données réelles du cabinet (profils « Configuration standard » et « hiver
// periode 1 », vérifiés en base le 2026-07-26).
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  catalogueDuProfil,
  codeCreneau,
  heureLisible,
  horaireLisible,
  natureCreneau,
  type HorairesDuCabinet,
} from '../../src/data/v2/horairesCreneaux'

const STANDARD = 'profil-standard'
const HIVER = 'profil-hiver'

/** Le catalogue réel du cabinet, tel que lu en base. */
const HORAIRES: HorairesDuCabinet = {
  profilDefaut: STANDARD,
  parProfil: {
    [STANDARD]: {
      semaine_soir: { heureDebut: '18:30:00', heureFin: '08:30:00', offsetJoursFin: 1 },
      vendredi_soir: { heureDebut: '18:30:00', heureFin: '08:30:00', offsetJoursFin: 1 },
      weekend: { heureDebut: '08:30:00', heureFin: '08:30:00', offsetJoursFin: 2 },
      ferie: { heureDebut: '08:30:00', heureFin: '08:30:00', offsetJoursFin: 1 },
    },
    [HIVER]: {
      semaine_soir: { heureDebut: '19:30:00', heureFin: '08:30:00', offsetJoursFin: 1 },
      vendredi_soir: { heureDebut: '18:30:00', heureFin: '08:30:00', offsetJoursFin: 1 },
      weekend: { heureDebut: '08:30:00', heureFin: '08:30:00', offsetJoursFin: 2 },
      ferie: { heureDebut: '08:30:00', heureFin: '08:30:00', offsetJoursFin: 1 },
    },
  },
}

const standard = catalogueDuProfil(HORAIRES, null) // période sans profil → défaut
const hiver = catalogueDuProfil(HORAIRES, HIVER)

// Semaine du 24 au 27 juillet 2026 : ven 24, sam 25, dim 26, lun 27.
const VENDREDI = '2026-07-24'
const SAMEDI = '2026-07-25'
const DIMANCHE = '2026-07-26'
const LUNDI = '2026-07-27'

describe('heureLisible', () => {
  it('omet les minutes à zéro', () => {
    expect(heureLisible('08:00:00')).toBe('8 h')
    expect(heureLisible('19:00:00')).toBe('19 h')
  })

  it('garde les minutes réelles', () => {
    expect(heureLisible('18:30:00')).toBe('18 h 30')
    expect(heureLisible('08:05:00')).toBe('8 h 05')
  })
})

describe('codeCreneau — traduction du vocabulaire de la vue', () => {
  it("range le vendredi typé « weekend » sous le créneau du vendredi soir", () => {
    // Piège réel : la vue planning_semaine type le vendredi « weekend », alors
    // que c'est un créneau distinct avec sa propre attribution.
    expect(codeCreneau('weekend', VENDREDI)).toBe('vendredi_soir')
  })

  it('garde samedi et dimanche sur le créneau week-end', () => {
    expect(codeCreneau('weekend', SAMEDI)).toBe('weekend')
    expect(codeCreneau('weekend', DIMANCHE)).toBe('weekend')
  })

  it('mappe la semaine et les fériés', () => {
    expect(codeCreneau('semaine', LUNDI)).toBe('semaine_soir')
    expect(codeCreneau('ferie', LUNDI)).toBe('ferie')
  })
})

describe('horaireLisible', () => {
  it('rend la nuit de semaine du profil par défaut (18 h 30, pas 19 h)', () => {
    // C'est le bug corrigé : l'écran affichait « 19 h 00 → 8 h 00 » en dur.
    expect(horaireLisible(standard, 'semaine', LUNDI)).toBe('18 h 30 → 8 h 30')
  })

  it("suit le profil de la période : « hiver periode 1 » décale à 19 h 30", () => {
    expect(horaireLisible(hiver, 'semaine', LUNDI)).toBe('19 h 30 → 8 h 30')
  })

  it('ancre le week-end sur SON samedi, même vu depuis le dimanche', () => {
    // Sans ancrage, la ligne du dimanche annoncerait « du dimanche au mardi ».
    expect(horaireLisible(standard, 'weekend', SAMEDI)).toBe(
      'du samedi 8 h 30 au lundi 8 h 30',
    )
    expect(horaireLisible(standard, 'weekend', DIMANCHE)).toBe(
      'du samedi 8 h 30 au lundi 8 h 30',
    )
  })

  it('donne au vendredi son horaire de soirée, pas celui du week-end', () => {
    expect(horaireLisible(standard, 'weekend', VENDREDI)).toBe('18 h 30 → 8 h 30')
  })

  it('nomme les jours quand début et fin tombent à la même heure (férié)', () => {
    // « 8 h 30 → 8 h 30 » ne veut rien dire : il faut les jours.
    expect(horaireLisible(standard, 'ferie', LUNDI)).toBe('du lundi 8 h 30 au mardi 8 h 30')
  })

  it("renvoie null plutôt qu'un horaire inventé quand le créneau est inconnu", () => {
    expect(horaireLisible({}, 'semaine', LUNDI)).toBeNull()
  })
})

describe('natureCreneau', () => {
  it('distingue le vendredi soir du week-end', () => {
    expect(natureCreneau('weekend', VENDREDI)).toBe('vendredi soir')
    expect(natureCreneau('weekend', SAMEDI)).toBe('week-end')
  })

  it('nomme la nuit de semaine et le férié', () => {
    expect(natureCreneau('semaine', LUNDI)).toBe('nuit de semaine')
    expect(natureCreneau('ferie', LUNDI)).toBe('jour férié')
  })
})

describe('catalogueDuProfil', () => {
  it('retombe sur le profil par défaut quand la période n’en déclare aucun', () => {
    expect(catalogueDuProfil(HORAIRES, null).semaine_soir.heureDebut).toBe('18:30:00')
  })

  it('rend un catalogue vide quand rien ne correspond (pas de devinette)', () => {
    expect(catalogueDuProfil({ parProfil: {}, profilDefaut: null }, null)).toEqual({})
  })
})
