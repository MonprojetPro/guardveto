// ============================================================
// Le validateur juge le planning TEL QU'IL SERA VECU (B-155a)
// ============================================================
// LE DEFAUT, ET LE FAIT QU'IL EST ARRIVE DEUX FOIS.
//
// Le 08/10, la publication a ete refusee devant un client pour une garde qui
// n'etait pas vide (B-155) : `casesAPourvoir` lisait la table brute et ignorait
// `gardes_exceptions`. Corrige. Une heure plus tard, MiKL, capture a l'appui :
//
//   « pkoi il continue a dire qu'il y a personne le 14 ? »
//
// Le message venait d'un AUTRE juge — `monterValidationPeriode`, qui alimente
// `validerPlanning` — avec la meme cause exactement : la table brute du 14/11
// porte `premier = Victor, second = NULL`, et six exceptions couvrent les trois
// jours x deux roles (Jean et Antoine sont de garde).
//
// 🔑 LA LECON N'EST PAS « il restait un bug », C'EST QUE JE N'AI PAS RECENSE
//    LES CONSUMERS. J'ai corrige un lecteur et annonce le probleme regle, sans
//    chercher les autres juges. C'est l'INSPECTION DES CONSUMERS sautee — et
//    elle s'est payee devant MiKL, pour la deuxieme fois dans la journee.
//
// ⚠️ UN AVERTISSEMENT FAUX COUTE PLUS CHER QU'UN AVERTISSEMENT ABSENT : il
//    apprend a ne plus lire les avertissements. C'est le meme mecanisme que
//    B-154 sur les tests rouges.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  appliquerExceptionsAuxGardes,
  type ExceptionJour,
} from '../../src/data/monterValidationPeriode'
import type { GardeRow } from '../../src/engine/validation/gardesVersPlanning'

/** La garde reelle du 14/11 sur Val d'Allier : un titulaire, pas de second. */
const WEEKEND_14: GardeRow = {
  id: 'c9fca6f1',
  date: '2026-11-14',
  type: 'weekend',
  premier_id: 'victor',
  second_id: null,
}

describe('appliquerExceptionsAuxGardes', () => {
  it('🔴 LE CAS DU 08/10 — le week-end du 14/11 n’est PAS sans 2nd de garde', () => {
    // Les six exceptions reelles, telles qu'elles sont en base.
    const exceptions: ExceptionJour[] = [
      { garde_id: 'c9fca6f1', date: '2026-11-13', role: 'premier', veterinaire_id: 'anne-sophie' },
      { garde_id: 'c9fca6f1', date: '2026-11-13', role: 'second', veterinaire_id: 'jean' },
      { garde_id: 'c9fca6f1', date: '2026-11-14', role: 'premier', veterinaire_id: 'jean' },
      { garde_id: 'c9fca6f1', date: '2026-11-14', role: 'second', veterinaire_id: 'antoine' },
      { garde_id: 'c9fca6f1', date: '2026-11-15', role: 'premier', veterinaire_id: 'jean' },
      { garde_id: 'c9fca6f1', date: '2026-11-15', role: 'second', veterinaire_id: 'antoine' },
    ]
    const [garde] = appliquerExceptionsAuxGardes([WEEKEND_14], exceptions)
    expect(garde.premier_id).toBe('jean')
    expect(
      garde.second_id,
      'c’est CETTE valeur qui faisait dire « week-end sans 2nd de garde »',
    ).toBe('antoine')
  })

  it('ne retient que les exceptions du JOUR DE LA GARDE', () => {
    // Celles du 13 et du 15 concernent d'autres jours du meme week-end : elles
    // ne doivent pas ecraser le samedi.
    const exceptions: ExceptionJour[] = [
      { garde_id: 'c9fca6f1', date: '2026-11-13', role: 'premier', veterinaire_id: 'anne-sophie' },
      { garde_id: 'c9fca6f1', date: '2026-11-15', role: 'premier', veterinaire_id: 'manon' },
    ]
    const [garde] = appliquerExceptionsAuxGardes([WEEKEND_14], exceptions)
    expect(garde.premier_id).toBe('victor')
    expect(garde.second_id).toBeNull()
  })

  it('🔴 une exception a `null` VIDE la place — elle ne la rend pas au titulaire', () => {
    // Sens metier d'un remplacement non pourvu, et c'est ce que l'ecran montre
    // deja. Retomber sur le titulaire afficherait quelqu'un qui n'y sera pas.
    const exceptions: ExceptionJour[] = [
      { garde_id: 'c9fca6f1', date: '2026-11-14', role: 'premier', veterinaire_id: null },
    ]
    const [garde] = appliquerExceptionsAuxGardes([WEEKEND_14], exceptions)
    expect(garde.premier_id).toBeNull()
  })

  it('ne touche QUE le role vise', () => {
    const complete: GardeRow = { ...WEEKEND_14, second_id: 'manon' }
    const exceptions: ExceptionJour[] = [
      { garde_id: 'c9fca6f1', date: '2026-11-14', role: 'second', veterinaire_id: 'antoine' },
    ]
    const [garde] = appliquerExceptionsAuxGardes([complete], exceptions)
    expect(garde.premier_id).toBe('victor')
    expect(garde.second_id).toBe('antoine')
  })

  it('ne confond pas deux gardes differentes', () => {
    const autre: GardeRow = {
      id: 'autre', date: '2026-11-21', type: 'weekend',
      premier_id: 'manon', second_id: 'fanny',
    }
    const exceptions: ExceptionJour[] = [
      { garde_id: 'c9fca6f1', date: '2026-11-14', role: 'second', veterinaire_id: 'antoine' },
    ]
    const sortie = appliquerExceptionsAuxGardes([WEEKEND_14, autre], exceptions)
    expect(sortie[0].second_id).toBe('antoine')
    expect(sortie[1].second_id).toBe('fanny')
  })

  it('sans aucune exception, rend les gardes inchangees', () => {
    const sortie = appliquerExceptionsAuxGardes([WEEKEND_14], [])
    expect(sortie).toEqual([WEEKEND_14])
  })

  it('ne modifie PAS le tableau d’entree — le montage le reutilise', () => {
    const exceptions: ExceptionJour[] = [
      { garde_id: 'c9fca6f1', date: '2026-11-14', role: 'second', veterinaire_id: 'antoine' },
    ]
    appliquerExceptionsAuxGardes([WEEKEND_14], exceptions)
    expect(WEEKEND_14.second_id, 'la garde d’origine doit rester intacte').toBeNull()
  })
})
