// ============================================================
// Combien de personnes une garde attend-elle ? — les deux pièges figés
// ============================================================
// Ces tests remplacent, pour cette règle, le banc payant : ils sont gratuits,
// rejoués à chaque build, et couvrent exactement les deux défauts partis en
// production le 29 juillet. Le banc IA, lui, était passé 5/5 pendant que le
// système était troué — il ne regardait pas ça.
//
// Chaque cas nommé ci-dessous a été observé sur les données réelles du cabinet
// (28 nuits d'été à 1 place, 29 nuits d'hiver à 2, 42 week-ends, 1 férié
// incomplet le 14 juillet 2026), pas imaginé.

import { describe, it, expect } from 'vitest'
import {
  codeCatalogue,
  effectifNuitSemaine,
  manqueSurGarde,
  placesAttendues,
  type PeriodeEffectif,
  type ProfilEffectif,
} from '../placesAttendues'

const CATALOGUE = new Map<string, number | null>([
  ['semaine_soir', 2], // ⚠️ le catalogue dit 2, la période dira souvent 1
  ['vendredi_soir', 2],
  ['weekend', 2],
  ['ferie', 2],
])

const ETE: PeriodeEffectif = {
  date_debut: '2026-06-01',
  date_fin: '2026-08-31',
  saison: 'ete',
  nb_vetos_semaine_soir: null,
}
const HIVER: PeriodeEffectif = {
  date_debut: '2026-09-01',
  date_fin: '2026-12-31',
  saison: 'hiver',
  nb_vetos_semaine_soir: null,
}
/**
 * L'été TEL QU'IL EST EN BASE chez le cabinet : « ete 2026 » porte bien
 * `nb_vetos_semaine_soir = 1`. Les deux pièges de production ci-dessous ont été
 * payés avec CETTE donnée-là — c'est donc avec elle qu'il faut les rejouer.
 *
 * Avant le 2026-08-04, le test les rejouait sans surcharge, en s'appuyant sur le
 * repli saison pour retomber sur 1. Ce repli ayant disparu, s'appuyer dessus
 * aurait fait passer le test pour une mauvaise raison — ou l'aurait fait
 * supprimer comme « obsolète » alors que le piège, lui, existe toujours.
 */
const ETE_REGLE: PeriodeEffectif = { ...ETE, nb_vetos_semaine_soir: 1 }

const SANS_PROFIL = new Map<string, ProfilEffectif>()

describe('Traduction des deux vocabulaires', () => {
  it('« semaine » du planning = « semaine_soir » du catalogue', () => {
    expect(codeCatalogue('semaine')).toBe('semaine_soir')
  })

  it('« weekend » porte le même code des deux côtés', () => {
    expect(codeCatalogue('weekend')).toBe('weekend')
  })

  it('« ferie » suit « semaine_soir » — comme le moteur, pas comme le catalogue', () => {
    // Le catalogue déclare 2 places pour le créneau « Jour ferie », mais le
    // moteur traite un férié comme un soir de semaine. Filou doit refléter ce
    // qui EST : sinon il annonce un manque sur chaque férié d'été.
    expect(codeCatalogue('ferie')).toBe('semaine_soir')
  })

  it('un créneau sur-mesure passe tel quel', () => {
    expect(codeCatalogue('garde_de_jour')).toBe('garde_de_jour')
  })
})

// ⚠️ CONTRAT CHANGÉ LE 2026-08-04. La précédence était période > période type >
// saison. Les deux derniers maillons ont sauté : la période type réglait
// l'effectif de la seule nuit de semaine alors que sa structure de gardes règle
// déjà celui de toutes les gardes, et le repli saison décidait en dur à la
// place du cabinet. Reste la surcharge du planning — sinon `null`, qui veut
// dire « je ne tranche pas, c'est le créneau qui décide ».
describe('Effectif d’une nuit de semaine — la surcharge du planning, ou rien', () => {
  it('la surcharge du planning gagne sur tout', () => {
    expect(
      effectifNuitSemaine({ ...HIVER, nb_vetos_semaine_soir: 1 }, SANS_PROFIL),
    ).toBe(1)
  })

  it('la période type n’est plus consultée, même quand elle porte un effectif', () => {
    const profils = new Map([['p1', { id: 'p1', nb_vetos_semaine_soir: 2 }]])
    expect(effectifNuitSemaine({ ...ETE, profil_id: 'p1' }, profils)).toBeNull()
  })

  it('sans surcharge, aucun verdict : ni été = 1 ni hiver = 2', () => {
    expect(effectifNuitSemaine(ETE, SANS_PROFIL)).toBeNull()
    expect(effectifNuitSemaine(HIVER, SANS_PROFIL)).toBeNull()
  })
})

describe('Places attendues — les deux pièges de production', () => {
  it('PIÈGE 1 : une nuit d’été attend UNE personne, pas les 2 du catalogue', () => {
    // C'est le bug d'origine : « il manque un second » annoncé chaque nuit.
    const n = placesAttendues({
      typePlanning: 'semaine',
      date: '2026-07-30',
      catalogue: CATALOGUE,
      periodes: [ETE_REGLE, HIVER],
      profils: SANS_PROFIL,
    })
    expect(n).toBe(1)
    expect(manqueSurGarde(n, 1)).toBe(0)
  })

  it('sans surcharge, une nuit suit simplement son créneau — comme toute autre garde', () => {
    // Le pendant du piège 1 depuis le 2026-08-04 : plus de repli saison, donc
    // plus d'écart possible entre ce que le moteur pose et ce qu'on annonce —
    // les deux lisent le même catalogue.
    expect(
      placesAttendues({
        typePlanning: 'semaine',
        date: '2026-07-30',
        catalogue: CATALOGUE,
        periodes: [ETE, HIVER],
        profils: SANS_PROFIL,
      }),
    ).toBe(CATALOGUE.get('semaine_soir'))
  })

  it('une nuit d’hiver en attend deux — le détecteur n’est pas devenu aveugle', () => {
    const n = placesAttendues({
      typePlanning: 'semaine',
      date: '2026-10-15',
      catalogue: CATALOGUE,
      periodes: [ETE, HIVER],
      profils: SANS_PROFIL,
    })
    expect(n).toBe(2)
    expect(manqueSurGarde(n, 1)).toBe(1)
  })

  it('PIÈGE 2 : « semaine » trouve sa réponse malgré le code différent', () => {
    // Rapprocher par égalité de code laissait 57 lignes sur 100 sans réponse.
    const catalogueSansAlias = new Map<string, number | null>([['semaine_soir', 2]])
    expect(
      placesAttendues({
        typePlanning: 'semaine',
        date: '2026-10-15',
        catalogue: catalogueSansAlias,
        periodes: [HIVER],
        profils: SANS_PROFIL,
      }),
    ).toBe(2)
  })

  it('un week-end suit le catalogue, pas l’effectif de nuit de semaine', () => {
    expect(
      placesAttendues({
        typePlanning: 'weekend',
        date: '2026-07-31', // en été, où les nuits n'attendent qu'une personne
        catalogue: CATALOGUE,
        periodes: [ETE],
        profils: SANS_PROFIL,
      }),
    ).toBe(2)
  })

  it('PIÈGE 3 : un férié d’été n’attend qu’une personne, malgré ses 2 places au catalogue', () => {
    // Cas réel : mardi 14 juillet 2026, période « ete 2026 » réglée à 1 véto la
    // nuit de semaine. Le moteur a généré une seule personne — c'est conforme.
    // Juger avec le catalogue ferait crier au manque sur chaque férié d'été.
    const n = placesAttendues({
      typePlanning: 'ferie',
      date: '2026-07-14',
      catalogue: CATALOGUE,
      periodes: [ETE_REGLE],
      profils: SANS_PROFIL,
    })
    expect(n).toBe(1)
    expect(manqueSurGarde(n, 1)).toBe(0)
  })

  it('un férié d’hiver en attend deux, par l’effectif de la période', () => {
    const n = placesAttendues({
      typePlanning: 'ferie',
      date: '2026-12-25',
      catalogue: CATALOGUE,
      periodes: [HIVER],
      profils: SANS_PROFIL,
    })
    expect(n).toBe(2)
    expect(manqueSurGarde(n, 1)).toBe(1)
  })
})

describe('Ce qu’on ne sait pas, on ne l’invente pas', () => {
  it('hors de toute période, une nuit de semaine reste indéterminée', () => {
    const n = placesAttendues({
      typePlanning: 'semaine',
      date: '2030-01-01',
      catalogue: CATALOGUE,
      periodes: [ETE, HIVER],
      profils: SANS_PROFIL,
    })
    expect(n).toBeNull()
    expect(manqueSurGarde(n, 0)).toBeNull()
  })

  it('un code inconnu du catalogue reste indéterminé', () => {
    expect(
      placesAttendues({
        typePlanning: 'garde_de_jour',
        date: '2026-07-30',
        catalogue: CATALOGUE,
        periodes: [ETE],
        profils: SANS_PROFIL,
      }),
    ).toBeNull()
  })

  it('deux profils en désaccord sur un code : indéterminé plutôt que faux', () => {
    const enConflit = new Map<string, number | null>([['weekend', null]])
    expect(
      placesAttendues({
        typePlanning: 'weekend',
        date: '2026-07-31',
        catalogue: enConflit,
        periodes: [ETE],
        profils: SANS_PROFIL,
      }),
    ).toBeNull()
  })
})
