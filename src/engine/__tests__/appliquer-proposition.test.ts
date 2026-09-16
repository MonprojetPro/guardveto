// ============================================================
// B-122 lot 2 — rejouer une proposition EN ATTENTE au moment du clic
// ============================================================
// La proposition stockée a le verdict `refuse` : la règle qu'elle enfreint
// n'a pas changé. Ce module ne doit donc PAS la refuser une seconde fois —
// c'est précisément la décision que l'admin vient de prendre en cliquant.
// Ce qu'il doit vraiment attraper, c'est un planning qui a bougé DEPUIS.
// ============================================================

import { describe, it, expect } from 'vitest'
import { reappliquerProposition, reappliquerLot } from '../relecture/appliquerProposition'
import type { ChangementPropose } from '../relecture/arbitrer'
import type { PlanningPartiel, VetEngine } from '../types'

const DATE_DEBUT = '2025-11-03'
const DATE_FIN = '2025-11-28'

function vet(id: string, prenom: string, conges: VetEngine['conges'] = []): VetEngine {
  return { id, nom: prenom, prenom, statut: 'associe', dernier_recours: false, contraintes: [], conges }
}

function planningDeux(): PlanningPartiel {
  return {
    attributions: [
      {
        date: '2025-11-03', type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v2' }],
      },
      {
        date: '2025-11-05', type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: 'v3' }, { role: 'second', vetId: 'v4' }],
      },
    ],
  }
}

function options(vets: VetEngine[]) {
  return { vets, dateDebut: DATE_DEBUT, dateFin: DATE_FIN, saison: 'hiver' as const, nbVetosSemaineSoir: 2 }
}

function changement(id: string, affectations: ChangementPropose['affectations']): ChangementPropose {
  return { id, motif: `motif ${id}`, critere: 'epuisement', affectations }
}

const EQUIPE = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol'), vet('v4', 'David')]

describe('reappliquerProposition — le cas attendu : forcer un « refuse »', () => {
  it('applique quand même une proposition que le moteur refuse — la doctrine « informe, n’interdit pas »', () => {
    // Carol est en congé : le moteur refuserait de la poser. C'est exactement
    // le genre de proposition qui finit « en attente » sur le planning.
    const equipe = [
      vet('v1', 'Alice'), vet('v2', 'Bob'),
      vet('v3', 'Carol', [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' }]),
      vet('v4', 'David'),
    ]
    const proposition = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v3' },
    ])

    const r = reappliquerProposition(planningDeux(), proposition, options(equipe))

    expect(r.issue).toBe('appliquee')
    const lundi = r.planning!.attributions.find((a) => a.date === '2025-11-03')!
    expect(lundi.placements.find((p) => p.role === 'premier')!.vetId).toBe('v3')
  })

  it('applique directement une proposition que le moteur accepterait de lui-même', () => {
    const legal = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v1' },
    ])

    const r = reappliquerProposition(planningDeux(), legal, options(EQUIPE))

    expect(r.issue).toBe('appliquee')
    const lundi = r.planning!.attributions.find((a) => a.date === '2025-11-03')!
    expect(lundi.placements.find((p) => p.role === 'premier')!.vetId).toBe('v2')
  })
})

describe('reappliquerProposition — le planning a bougé depuis la relecture', () => {
  it('bloque quand un cadenas protège désormais une des places visées', () => {
    const proposition = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v1' },
    ])

    const r = reappliquerProposition(planningDeux(), proposition, {
      ...options(EQUIPE),
      placesFigees: [{ date: '2025-11-03', type: 'semaine_soir', role: 'premier' }],
    })

    expect(r.issue).toBe('bloquee_cadenas')
    expect(r.planning).toBeUndefined()
    expect(r.raison).toMatch(/cadenas/i)
  })

  it('bloque quand la place n’existe plus dans le planning actuel', () => {
    const proposition = changement('F1', [
      { date: '2026-01-01', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
    ])

    const r = reappliquerProposition(planningDeux(), proposition, options(EQUIPE))

    expect(r.issue).toBe('bloquee_sans_objet')
    expect(r.planning).toBeUndefined()
  })
})

describe('reappliquerLot — appliquer tout le lot, en bloc', () => {
  it('applique chaque proposition sur le planning déjà modifié par la précédente (cumulatif)', () => {
    const premiere = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v1' },
    ])
    const seconde = changement('F2', [
      { date: '2025-11-05', type: 'semaine_soir', role: 'premier', vetId: 'v4' },
      { date: '2025-11-05', type: 'semaine_soir', role: 'second', vetId: 'v3' },
    ])

    const r = reappliquerLot(planningDeux(), [premiere, seconde], options(EQUIPE))

    expect(r.appliquees).toEqual(['F1', 'F2'])
    expect(r.bloquees).toEqual([])
    const lundi = r.planning.attributions.find((a) => a.date === '2025-11-03')!
    const mercredi = r.planning.attributions.find((a) => a.date === '2025-11-05')!
    expect(lundi.placements.find((p) => p.role === 'premier')!.vetId).toBe('v2')
    expect(mercredi.placements.find((p) => p.role === 'premier')!.vetId).toBe('v4')
  })

  it('continue le lot même quand une proposition est bloquée, et le dit', () => {
    const bloquee = changement('F1', [
      { date: '2026-01-01', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
    ])
    const suivante = changement('F2', [
      { date: '2025-11-05', type: 'semaine_soir', role: 'premier', vetId: 'v4' },
      { date: '2025-11-05', type: 'semaine_soir', role: 'second', vetId: 'v3' },
    ])

    const r = reappliquerLot(planningDeux(), [bloquee, suivante], options(EQUIPE))

    expect(r.appliquees).toEqual(['F2'])
    expect(r.bloquees).toEqual([{ id: 'F1', issue: 'bloquee_sans_objet', raison: expect.any(String) }])
  })

  it('ne mute jamais le planning initial', () => {
    const origine = planningDeux()
    const copieAvant = JSON.stringify(origine)
    const proposition = changement('F1', [
      { date: '2025-11-03', type: 'semaine_soir', role: 'premier', vetId: 'v2' },
      { date: '2025-11-03', type: 'semaine_soir', role: 'second', vetId: 'v1' },
    ])

    reappliquerLot(origine, [proposition], options(EQUIPE))

    expect(JSON.stringify(origine)).toBe(copieAvant)
  })
})
