// ============================================================
// Les huit juges de B-156 jugent le planning TEL QU'IL SERA VECU
// ============================================================
// LE CAS REEL, celui qui a tout declenche — Val d'Allier, week-end du 14/11 :
//
//   · la table `gardes` porte `premier = Victor, second = NULL` ;
//   · six lignes de `gardes_exceptions` couvrent les 3 jours x 2 roles ;
//   · ce sont Jean et Antoine qui sont de garde.
//
// Tout juge qui lit les titulaires annonce donc un trou la ou deux personnes
// veillent, et tait la garde de ceux qui veillent vraiment.
//
// CE QUE CE FICHIER TESTE, ET POURQUOI CES REGLES-LA : les deux fonctions qui
// portaient les defauts les plus couteux de l'audit du 08/10, extraites PURES
// pour pouvoir etre sondees sans base —
//
//   · `conflitsDepuisGardes`           — le seul trou qui pouvait laisser un soir
//                                        SANS PERSONNE (un conge accorde a un
//                                        remplacant de garde) ;
//   · `calculerEntreesHistoriqueFete`  — le seul trou MUET ET A RETARDEMENT (le
//                                        registre de Noel, relu un an plus tard).
//
// ⚠️ UN AVERTISSEMENT FAUX COUTE PLUS CHER QU'UN AVERTISSEMENT ABSENT : il
//    apprend a ne plus lire les avertissements. Les deux sens sont donc testes —
//    ne plus rien dire au remplace, ET dire enfin quelque chose au remplacant.
// ============================================================

import { describe, expect, it } from 'vitest'
import {
  avertissementRemplacementPonctuel,
  indexerExceptions,
  occupantReel,
  rolesTenusParVeto,
  type ExceptionJour,
} from '../../src/lib/gardes/exceptions-jour'
import {
  conflitsDepuisGardes,
  type LigneGardeConflit,
} from '../../src/lib/conges/detection-conflit'
import { calculerEntreesHistoriqueFete } from '../../src/data/historiqueFetes'

/** Le week-end du 14/11 : Victor titulaire, pas de second. */
const WEEKEND_14: LigneGardeConflit = {
  id: 'c9fca6f1',
  date: '2026-11-14',
  type: 'weekend',
  premier_id: 'victor',
  second_id: null,
  periode_id: 'hiver-p2',
}

/** Les six remplacements reels : Jean 1er, Antoine 2nd, sur les trois jours. */
const SIX_REMPLACEMENTS: ExceptionJour[] = [
  { garde_id: 'c9fca6f1', date: '2026-11-13', role: 'premier', veterinaire_id: 'jean' },
  { garde_id: 'c9fca6f1', date: '2026-11-13', role: 'second', veterinaire_id: 'antoine' },
  { garde_id: 'c9fca6f1', date: '2026-11-14', role: 'premier', veterinaire_id: 'jean' },
  { garde_id: 'c9fca6f1', date: '2026-11-14', role: 'second', veterinaire_id: 'antoine' },
  { garde_id: 'c9fca6f1', date: '2026-11-15', role: 'premier', veterinaire_id: 'jean' },
  { garde_id: 'c9fca6f1', date: '2026-11-15', role: 'second', veterinaire_id: 'antoine' },
]

const PLAGE = { borneBasse: '2026-11-01', dateFin: '2026-11-30' }

describe('Qui tient reellement une place', () => {
  it('rend le remplacant, pas le titulaire', () => {
    const index = indexerExceptions(SIX_REMPLACEMENTS)
    expect(occupantReel(WEEKEND_14, index, '2026-11-14', 'premier')).toBe('jean')
    expect(occupantReel(WEEKEND_14, index, '2026-11-14', 'second')).toBe('antoine')
  })

  it('rend le titulaire sur un jour SANS remplacement — le samedi seul ne vide pas le dimanche', () => {
    const index = indexerExceptions([SIX_REMPLACEMENTS[2]]) // samedi, 1er, seul
    expect(occupantReel(WEEKEND_14, index, '2026-11-14', 'premier')).toBe('jean')
    expect(occupantReel(WEEKEND_14, index, '2026-11-15', 'premier')).toBe('victor')
  })

  it('une exception a `null` VIDE la place, elle ne la rend pas au titulaire', () => {
    const index = indexerExceptions([
      { garde_id: 'c9fca6f1', date: '2026-11-14', role: 'premier', veterinaire_id: null },
    ])
    expect(occupantReel(WEEKEND_14, index, '2026-11-14', 'premier')).toBeNull()
  })

  it('dit les roles qu’un veto tient — et ceux qu’il ne tient plus', () => {
    const index = indexerExceptions(SIX_REMPLACEMENTS)
    expect(rolesTenusParVeto(WEEKEND_14, index, '2026-11-14', 'jean')).toEqual(['premier'])
    expect(rolesTenusParVeto(WEEKEND_14, index, '2026-11-14', 'victor')).toEqual([])
  })
})

describe('Le conflit conge / garde (le trou qui laissait un soir sans personne)', () => {
  it('voit le conflit du REMPLACANT — c’est le defaut qui pouvait vider un soir', () => {
    const conflits = conflitsDepuisGardes({
      gardes: [WEEKEND_14],
      exceptions: SIX_REMPLACEMENTS,
      veterinaireId: 'jean',
      ...PLAGE,
    })
    expect(conflits).toEqual([
      { periodeId: 'hiver-p2', date: '2026-11-13', role: 'premier' },
    ])
  })

  it('ne reproche plus rien au titulaire ENTIEREMENT remplace', () => {
    const conflits = conflitsDepuisGardes({
      gardes: [WEEKEND_14],
      exceptions: SIX_REMPLACEMENTS,
      veterinaireId: 'victor',
      ...PLAGE,
    })
    expect(conflits).toEqual([])
  })

  it('maintient le conflit du titulaire remplace UN SEUL JOUR — il veille encore les autres', () => {
    const conflits = conflitsDepuisGardes({
      gardes: [WEEKEND_14],
      exceptions: [SIX_REMPLACEMENTS[2]], // samedi, 1er role
      veterinaireId: 'victor',
      ...PLAGE,
    })
    // Le vendredi lui reste : le conflit se dit, et il se dit a la bonne date.
    expect(conflits).toEqual([
      { periodeId: 'hiver-p2', date: '2026-11-13', role: 'premier' },
    ])
  })

  it('voit le VENDREDI et le DIMANCHE d’un week-end — second angle mort repare au passage', () => {
    // La ligne vit sur le samedi ; un souhait pose le seul dimanche ne percutait
    // rien auparavant.
    const conflits = conflitsDepuisGardes({
      gardes: [WEEKEND_14],
      exceptions: [],
      veterinaireId: 'victor',
      borneBasse: '2026-11-15',
      dateFin: '2026-11-15',
    })
    expect(conflits).toEqual([
      { periodeId: 'hiver-p2', date: '2026-11-15', role: 'premier' },
    ])
  })

  it('ne dit rien hors de la plage demandee', () => {
    const conflits = conflitsDepuisGardes({
      gardes: [WEEKEND_14],
      exceptions: SIX_REMPLACEMENTS,
      veterinaireId: 'jean',
      borneBasse: '2026-12-01',
      dateFin: '2026-12-31',
    })
    expect(conflits).toEqual([])
  })
})

describe('Le registre des fetes (le trou muet, a retardement d’un an)', () => {
  /** Noel 2026 : le week-end du samedi 26/12 couvre les 25, 26, 27. */
  const WEEKEND_NOEL = {
    id: 'g-noel',
    date: '2026-12-26',
    type: 'weekend',
    premier_id: 'victor',
    second_id: 'fanny',
  }

  it('inscrit celui qui a TENU Noel, pas celui qui devait le tenir', () => {
    const entrees = calculerEntreesHistoriqueFete([WEEKEND_NOEL], 'cab', 'per', [
      { garde_id: 'g-noel', date: '2026-12-25', role: 'premier', veterinaire_id: 'jean' },
    ])
    const noel = entrees.filter((e) => e.fete === 'noel').map((e) => e.veterinaire_id)
    // Jean a tenu le 25 (jour de Noel) ; Victor n'a veille que le 26 et le 27,
    // qui ne sont pas des fetes. Il ne doit donc PAS porter la penalite l'an
    // prochain — c'est tout l'enjeu, et il est invisible pendant un an.
    expect(noel).toContain('jean')
    expect(noel).not.toContain('victor')
    // Fanny, 2nde non remplacee ce jour-la, a bien tenu Noel.
    expect(noel).toContain('fanny')
  })

  it('sans remplacement, le comportement d’origine est intact', () => {
    const entrees = calculerEntreesHistoriqueFete([WEEKEND_NOEL], 'cab', 'per')
    const noel = entrees.filter((e) => e.fete === 'noel').map((e) => e.veterinaire_id).sort()
    expect(noel).toEqual(['fanny', 'victor'])
  })

  it('une place VIDEE le jour de la fete n’inscrit personne', () => {
    const entrees = calculerEntreesHistoriqueFete([WEEKEND_NOEL], 'cab', 'per', [
      { garde_id: 'g-noel', date: '2026-12-25', role: 'premier', veterinaire_id: null },
      { garde_id: 'g-noel', date: '2026-12-25', role: 'second', veterinaire_id: null },
    ])
    expect(entrees.filter((e) => e.fete === 'noel')).toEqual([])
  })
})

describe('La phrase unique des chemins de reparation', () => {
  it('previent qu’un remplacement ponctuel primera sur la personne qu’on place', () => {
    const phrase = avertissementRemplacementPonctuel(
      WEEKEND_14,
      [SIX_REMPLACEMENTS[2]],
      'premier',
    )
    expect(phrase).toContain('14/11')
    expect(phrase).toContain('remplacement ponctuel')
  })

  it('se tait quand il n’y a rien a dire — un avertissement systematique ne se lit plus', () => {
    expect(avertissementRemplacementPonctuel(WEEKEND_14, [], 'premier')).toBeNull()
    expect(
      avertissementRemplacementPonctuel(WEEKEND_14, SIX_REMPLACEMENTS, 'troisieme'),
    ).toBeNull()
  })

  it('accorde la phrase au pluriel quand plusieurs jours sont remplaces', () => {
    const phrase = avertissementRemplacementPonctuel(
      WEEKEND_14,
      SIX_REMPLACEMENTS,
      'premier',
    )
    expect(phrase).toContain('13/11')
    expect(phrase).toContain('15/11')
    expect(phrase).toContain('remplacements ponctuels')
  })
})
