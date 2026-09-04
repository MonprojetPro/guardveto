// ============================================================
// B-111 — LES PLACES CADENASSÉES PAR L'ADMIN
// ============================================================
// MiKL, le 04/09 : « quand le moteur regénère il doit tenir compte de ce qui a
// été déjà fixé ».
//
// ── CE QUE CES TESTS PROTÈGENT, ET POURQUOI EUX ────────────────────────────
//
// Un verrou existait déjà à l'écriture (`ecrirePlanningV1` ne recouvre pas une
// garde verrouillée) : le cadenas TENAIT donc à l'affichage, alors même que le
// moteur composait sans le voir. C'est la pire forme de défaut sur ce projet —
// visible nulle part, faux partout.
//
// Ces tests ne se contentent donc PAS de vérifier que la place figée est encore
// là à l'arrivée. Ils vérifient que le moteur l'a VUE en composant : qu'une
// règle de rythme s'applique à travers elle, et que les compteurs la comptent.
//
// Ils passent en revue les quatre chemins qui défont des attributions pour les
// reconstruire — seed, LNS, remplissage au mieux, rattrapage — plus le
// rééquilibrage des rôles, qui échangerait un 1er cadenassé avec son 2nd. La
// leçon du 26/08 est la raison de cette exhaustivité : « une exclusion posée en
// amont ne protège que les chemins existant ce jour-là ».
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  genererPlanningPur, remplirAuMieux, rattraperCasesVides, type SolverInput,
} from '../solver'
import { attributionsDesFigees, indexerFigees, reposerFigees, stepsHorsFigees } from '../figees'
import { premierId, secondId, vetPourRole } from '../attribution'
import type { AttributionGarde, ContrainteEngine, PlanningPartiel, VetEngine } from '../types'

const DATE_DEBUT = '2025-11-03' // lundi
const DATE_FIN = '2025-11-28'   // vendredi (4 semaines)

function vet(id: string, prenom: string, contraintes: ContrainteEngine[] = []): VetEngine {
  return { id, nom: prenom, prenom, statut: 'associe', dernier_recours: false, contraintes, conges: [] }
}

const EQUIPE = () => [
  vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol'),
  vet('v4', 'David'), vet('v5', 'Eve'),
]

function input(vets: VetEngine[], placesFigees?: SolverInput['placesFigees']): SolverInput {
  return {
    dateDebut: DATE_DEBUT, dateFin: DATE_FIN, saison: 'hiver',
    vets, bonusMalus: {}, lnsTimeoutMs: 2000, placesFigees,
  }
}

/** La place `role` du créneau (date, type) dans un planning rendu. */
function placeDe(
  planning: PlanningPartiel, date: string, type: string, role: string,
): string | null {
  const attr = planning.attributions.find((a) => a.date === date && a.type === type)
  return attr ? vetPourRole(attr, role) : null
}

/** Nombre de gardes tenues par une personne, toutes places confondues. */
function nbGardes(planning: PlanningPartiel, vetId: string): number {
  return planning.attributions.reduce(
    (n, a) => n + a.placements.filter((p) => p.vetId === vetId).length, 0,
  )
}

const LUNDI = '2025-11-03'
const MARDI = '2025-11-04'
const WEEKEND = '2025-11-08' // samedi

describe('les primitives de figees.ts', () => {
  const steps = [
    { date: LUNDI, type: 'semaine_soir', role: 'premier', rolesCreneau: ['premier', 'second'] },
    { date: LUNDI, type: 'semaine_soir', role: 'second', rolesCreneau: ['premier', 'second'] },
  ]

  it('retire de ce qu\'il reste à pourvoir exactement la place cadenassée', () => {
    const index = indexerFigees([{ date: LUNDI, type: 'semaine_soir', role: 'premier', vetId: 'v1' }])
    const restants = stepsHorsFigees(steps, index)

    expect(restants).toHaveLength(1)
    expect(restants[0].role).toBe('second')
  })

  it('range les places dans l\'ORDRE DU CATALOGUE, même quand seul le 2nd est figé', () => {
    // Ce n'est pas cosmétique : `ecrirePlanningV1` lit les places par POSITION
    // (placements[0] → premier_id). Une attribution qui ne contiendrait que la
    // place figée écrirait le 2nd dans la colonne du 1er, en silence.
    const index = indexerFigees([{ date: LUNDI, type: 'semaine_soir', role: 'second', vetId: 'v2' }])
    const [attr] = attributionsDesFigees(index, steps)

    expect(attr.placements.map((p) => p.role)).toEqual(['premier', 'second'])
    expect(premierId(attr)).toBeNull()
    expect(secondId(attr)).toBe('v2')
  })

  it('ignore une figée qui ne correspond à aucune place de la période', () => {
    // Créneau retiré du catalogue, date hors bornes, rôle renommé : la réinjecter
    // créerait une garde que plus aucun écran ne sait décrire, mais qui pèserait
    // dans les compteurs. Mieux vaut qu'elle disparaisse visiblement.
    const index = indexerFigees([{ date: '2030-01-01', type: 'creneau_inconnu', role: 'premier', vetId: 'v1' }])

    expect(attributionsDesFigees(index, steps)).toEqual([])
    expect(reposerFigees({ attributions: [] }, index, steps).attributions).toEqual([])
  })

  it('est idempotente : la reposer deux fois ne change rien', () => {
    const index = indexerFigees([{ date: LUNDI, type: 'semaine_soir', role: 'premier', vetId: 'v1' }])
    const une = reposerFigees({ attributions: [] }, index, steps)
    const deux = reposerFigees(une, index, steps)

    expect(deux).toEqual(une)
  })

  it('ne met jamais la même personne sur deux places de la même garde', () => {
    // Si le moteur avait posé la personne cadenassée sur l'AUTRE place, la
    // reposer ici la mettrait deux fois sur la même garde — une aberration
    // qu'aucun écran ne rattrape et qui partirait dans les agendas.
    const index = indexerFigees([{ date: LUNDI, type: 'semaine_soir', role: 'premier', vetId: 'v1' }])
    const deja: PlanningPartiel = {
      attributions: [{
        date: LUNDI, type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: 'v9' }, { role: 'second', vetId: 'v1' }],
      }],
    }

    const apres = reposerFigees(deja, index, steps)
    const attr = apres.attributions[0]

    expect(premierId(attr)).toBe('v1')
    expect(secondId(attr)).toBeNull()
  })
})

describe('la génération compose AUTOUR des places cadenassées', () => {
  it('rend la place cadenassée intacte, seed et LNS compris', () => {
    const figees = [{ date: LUNDI, type: 'semaine_soir', role: 'premier', vetId: 'v3' }]
    const r = genererPlanningPur(input(EQUIPE(), figees))

    expect(r.success).toBe(true)
    if (!r.success) return
    expect(placeDe(r.planning, LUNDI, 'semaine_soir', 'premier')).toBe('v3')
  })

  it('complète les places libres de la même garde (case incomplète autorisée)', () => {
    const figees = [{ date: LUNDI, type: 'semaine_soir', role: 'premier', vetId: 'v3' }]
    const r = genererPlanningPur(input(EQUIPE(), figees))

    expect(r.success).toBe(true)
    if (!r.success) return
    const second = placeDe(r.planning, LUNDI, 'semaine_soir', 'second')
    expect(second).not.toBeNull()
    expect(second).not.toBe('v3') // jamais deux fois la même personne
  })

  it('VOIT la garde cadenassée : une règle de rythme s\'applique à travers elle', () => {
    // LE point du chantier. Avant B-111, le moteur composait comme si la case
    // figée était libre : il pouvait donc poser la même personne le lendemain,
    // en violation d'un espacement qu'il croyait respecter.
    const espacement: ContrainteEngine = {
      id: 'esp', type: 'espacement_min', actif: true,
      config: { brique: 'espacement_min', force: 2, params: { ecart_min_jours: 2 } },
    }
    const equipe = [
      vet('v1', 'Alice', [espacement]), vet('v2', 'Bob'), vet('v3', 'Carol'),
      vet('v4', 'David'), vet('v5', 'Eve'),
    ]
    const figees = [{ date: LUNDI, type: 'semaine_soir', role: 'premier', vetId: 'v1' }]

    const r = genererPlanningPur(input(equipe, figees))

    expect(r.success).toBe(true)
    if (!r.success) return
    expect(placeDe(r.planning, LUNDI, 'semaine_soir', 'premier')).toBe('v1')
    // Alice est de garde le lundi : le mardi lui est interdit. Sans la figée
    // dans le planning de départ, rien ne l'empêchait d'y être posée.
    expect(placeDe(r.planning, MARDI, 'semaine_soir', 'premier')).not.toBe('v1')
    expect(placeDe(r.planning, MARDI, 'semaine_soir', 'second')).not.toBe('v1')
  })

  it('COMPTE les gardes cadenassées dans l\'équité', () => {
    // Quatre week-ends d'affilée donnés à la même personne : si le moteur les
    // comptait, il doit lui en donner nettement moins que la moyenne ailleurs.
    // S'il ne les voyait pas, il la traiterait comme n'ayant rien fait.
    const samedis = ['2025-11-08', '2025-11-15', '2025-11-22']
    const figees = samedis.map((date) => ({ date, type: 'weekend', role: 'premier', vetId: 'v1' }))

    const avec = genererPlanningPur(input(EQUIPE(), figees))
    expect(avec.success).toBe(true)
    if (!avec.success) return

    const gardesV1 = nbGardes(avec.planning, 'v1')
    const autres = ['v2', 'v3', 'v4', 'v5'].map((id) => nbGardes(avec.planning, id))
    const moyenneAutres = autres.reduce((a, b) => a + b, 0) / autres.length

    // Elle a déjà trois week-ends d'avance : le moteur doit l'avoir freinée.
    // Sans prise en compte, elle serait servie comme tout le monde EN PLUS.
    expect(gardesV1).toBeLessThan(moyenneAutres + 3)
  })

  it('n\'échange pas les rôles d\'un week-end dont une place est cadenassée', () => {
    // Le rééquilibrage des rôles (R11c) intervertit 1er et 2nd d'un week-end.
    // Le cadenas porte sur la PLACE : l'échange déplacerait ce que l'admin a fixé.
    const figees = [{ date: WEEKEND, type: 'weekend', role: 'premier', vetId: 'v2' }]
    const r = genererPlanningPur({ ...input(EQUIPE(), figees), rattrapage: { budgetMs: 3000 } })

    expect(r.success).toBe(true)
    if (!r.success) return
    expect(placeDe(r.planning, WEEKEND, 'weekend', 'premier')).toBe('v2')
  })
})

describe('les chemins de secours respectent les cadenas', () => {
  it('remplirAuMieux pose la figée et ne la recense pas comme case vide', () => {
    const figees = [{ date: LUNDI, type: 'semaine_soir', role: 'premier', vetId: 'v4' }]
    const r = remplirAuMieux(input(EQUIPE(), figees))

    expect(placeDe(r.planning, LUNDI, 'semaine_soir', 'premier')).toBe('v4')
    expect(
      r.creneauxVides.some((c) => c.date === LUNDI && c.type === 'semaine_soir' && c.role === 'premier'),
    ).toBe(false)
  })

  it('remplirAuMieux tient aussi sur un WEEK-END cadenassé (bloc lié au vendredi)', () => {
    // Le cas qui a fait tomber la première version : un week-end à moitié figé
    // rendait le vendredi lié impossible (R9 contre une équipe incomplète).
    // Ici le remplissage décide le bloc d'un seul tenant — il doit y arriver.
    const figees = [{ date: WEEKEND, type: 'weekend', role: 'premier', vetId: 'v2' }]
    const r = remplirAuMieux(input(EQUIPE(), figees))

    expect(placeDe(r.planning, WEEKEND, 'weekend', 'premier')).toBe('v2')
    // Le vendredi lié doit être pourvu, et par le duo du week-end (R9).
    const vendrediPremier = placeDe(r.planning, '2025-11-07', 'vendredi_soir', 'premier')
    const vendrediSecond = placeDe(r.planning, '2025-11-07', 'vendredi_soir', 'second')
    expect(vendrediPremier).not.toBeNull()
    expect(vendrediSecond).not.toBeNull()
    expect([vendrediPremier, vendrediSecond]).toContain('v2')
  })

  it('la reprise des cases vides ne défait pas une garde cadenassée voisine', () => {
    // La reprise libère TOUT l'entourage d'un trou pour le reconstruire. Sans
    // protection, combler une case du mardi effacerait le lundi fixé par l'admin.
    const indisponible: ContrainteEngine = {
      id: 'repos', type: 'jour_repos_fixe', actif: true,
      config: { brique: 'jour_repos_fixe', force: 1, params: { jour: 'mardi' } },
    }
    const equipe = [
      vet('v1', 'Alice'), vet('v2', 'Bob', [indisponible]), vet('v3', 'Carol', [indisponible]),
      vet('v4', 'David', [indisponible]), vet('v5', 'Eve', [indisponible]),
    ]
    const figees = [{ date: LUNDI, type: 'semaine_soir', role: 'premier', vetId: 'v3' }]

    const depart = remplirAuMieux(input(equipe, figees))
    const apres = rattraperCasesVides(input(equipe, figees), depart, { budgetMs: 3000 })

    expect(placeDe(apres.planning, LUNDI, 'semaine_soir', 'premier')).toBe('v3')
  })
})

describe('sans cadenas, rien ne change', () => {
  it('rend exactement le même planning avec placesFigees absent ou vide', () => {
    const sans = genererPlanningPur(input(EQUIPE()))
    const vide = genererPlanningPur(input(EQUIPE(), []))

    expect(sans.success).toBe(true)
    expect(vide.success).toBe(true)
    if (!sans.success || !vide.success) return
    expect(vide.planning).toEqual(sans.planning)
  })
})

describe('la forme rendue reste celle qu\'attend l\'écriture en base', () => {
  it('garde les places en position canonique quand seul le 2nd est cadenassé', () => {
    // `ecrirePlanningV1` écrit placements[0] dans premier_id. Une inversion ici
    // enverrait le 2nd dans la colonne du 1er — invisible à la relecture du code.
    const figees = [{ date: LUNDI, type: 'semaine_soir', role: 'second', vetId: 'v5' }]
    const r = genererPlanningPur(input(EQUIPE(), figees))

    expect(r.success).toBe(true)
    if (!r.success) return
    const attr = r.planning.attributions.find(
      (a: AttributionGarde) => a.date === LUNDI && a.type === 'semaine_soir',
    )
    expect(attr?.placements[0].role).toBe('premier')
    expect(attr?.placements[1].role).toBe('second')
    expect(attr?.placements[1].vetId).toBe('v5')
  })
})
