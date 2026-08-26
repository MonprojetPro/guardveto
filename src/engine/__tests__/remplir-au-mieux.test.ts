// ============================================================
// B-053 — une génération ne rend JAMAIS les mains vides
// ============================================================
// MiKL, le 26/08 : « faut plus que le moteur réagisse comme ça, t'imagine un
// client qui tombe là-dessus, il panique ». Le moteur était en tout-ou-rien :
// un seul enchaînement impossible et l'admin perdait tout.
//
// Ce que ces tests protègent :
//   • sur un cas résoluble, le remplissage au mieux ne laisse AUCUN trou ;
//   • sur un cas impossible, il rend quand même le maximum ;
//   • il n'enfreint JAMAIS une règle dure pour boucher un trou (une case vide
//     est toujours préférable à une garde illégale) ;
//   • chaque case vide dit pourquoi, pour CHAQUE vétérinaire écarté — aucune
//     exclusion muette (« le tableau ne peut pas se taire ») ;
//   • la branche échec de `genererPlanningPur` ne renvoie plus un planning vide.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, remplirAuMieux, type SolverInput } from '../solver'
import { premierId, secondId } from '../attribution'
import type { VetEngine } from '../types'

const DATE_DEBUT = '2025-11-03' // lundi
const DATE_FIN = '2025-11-28'   // vendredi (4 semaines)

function vet(id: string, prenom: string, conges: VetEngine['conges'] = []): VetEngine {
  return { id, nom: prenom, prenom, statut: 'associe', dernier_recours: false, contraintes: [], conges }
}

function input(vets: VetEngine[]): SolverInput {
  return { dateDebut: DATE_DEBUT, dateFin: DATE_FIN, saison: 'hiver', vets, bonusMalus: {}, lnsTimeoutMs: 2000 }
}

const CONGE_TOTAL = [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' as const }]

/** Toutes les places pourvues d'un planning. */
function placesPourvues(planning: { attributions: { placements?: { vetId: string | null }[] }[] }): number {
  return planning.attributions.reduce(
    (n, a) => n + (a.placements ?? []).filter((p) => p.vetId).length,
    0,
  )
}

describe('remplirAuMieux', () => {
  it('ne laisse aucun trou quand la période est résoluble', () => {
    const r = remplirAuMieux(input([vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol')]))

    expect(r.creneauxVides).toEqual([])
    expect(placesPourvues(r.planning)).toBeGreaterThan(0)
  })

  it('remplit le maximum quand la période est impossible, au lieu de tout perdre', () => {
    // Deux personnes seulement, dont une absente toute la période : les nuits
    // à une place passent, les week-ends à deux places ne peuvent pas (R21).
    const r = remplirAuMieux(input([vet('v1', 'Alice'), vet('v2', 'Bob', CONGE_TOTAL)]))

    expect(r.creneauxVides.length).toBeGreaterThan(0)
    // LE point du chantier : on rend quand même du travail exploitable.
    expect(placesPourvues(r.planning)).toBeGreaterThan(0)
  })

  it('préfère une case vide à une garde illégale', () => {
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob', CONGE_TOTAL)]
    const r = remplirAuMieux(input(vets))

    for (const a of r.planning.attributions) {
      // R16 — personne n'est placé pendant son congé.
      for (const p of a.placements ?? []) {
        if (p.vetId === 'v2') {
          throw new Error(`Bob est en congé et se retrouve de garde le ${a.date}`)
        }
      }
      // R21 — 1er et 2nd ne sont jamais la même personne.
      const p1 = premierId(a)
      const p2 = secondId(a)
      if (p1 && p2) expect(p1).not.toBe(p2)
    }
  })

  it('dit pourquoi chaque case est vide, sans exclusion muette', () => {
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob', CONGE_TOTAL)]
    const r = remplirAuMieux(input(vets))

    expect(r.creneauxVides.length).toBeGreaterThan(0)
    for (const c of r.creneauxVides) {
      // Une case vide veut dire qu'AUCUN véto ne passait : chacun doit donc
      // avoir sa ligne. Une liste plus courte laisserait croire que les absents
      // étaient disponibles.
      expect(c.raisons).toHaveLength(vets.length)
      for (const raison of c.raisons) {
        expect(raison.raison.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

describe('B-059 — les créneaux liés se décident ENSEMBLE', () => {
  /**
   * Le défaut mesuré le 26/08 sur Hiver P1, réduit à sa forme minimale.
   *
   * En vrai : le moteur donnait le vendredi soir à Fanny + Antoine, puis le
   * week-end entier tombait — R9 impose au week-end le duo du vendredi, R8
   * l'inversion, et FREQ_WE interdisait à Antoine un second week-end. Victor et
   * Jean étaient libres. MiKL, en recette : « pourquoi Victor ne fait pas la
   * garde du week-end du 25 ? Il n'a aucun WE au compteur et n'est pas absent ».
   *
   * Ici : Bob peut faire les soirs de semaine, JAMAIS les week-ends. Décidé
   * seul, le vendredi soir peut échoir à Bob — et le week-end devient alors
   * impossible pour tout le monde, puisqu'il doit reprendre le duo du vendredi.
   *
   * ⚠️ Ce test a été écrit d'abord avec un simple duo interdit : il passait
   * AUSSI en remplissage place-par-place, donc il ne prouvait rien (vérifié par
   * mutation). Celui-ci échoue bien sans le regroupement.
   */
  const jamaisEnWeekEnd = (): VetEngine['contraintes'][number] =>
    ({
      id: 'pas-de-we',
      type: 'indisponibilite_cyclique',
      actif: true,
      config: {
        axes: {}, force: 2, brique: 'indisponibilite_cyclique',
        semaines: 'toutes', periodes: ['weekend'],
        params: { description: 'jamais de week-end' },
      },
    }) as VetEngine['contraintes'][number]

  const equipe = () => [
    vet('v1', 'Alice'),
    { ...vet('v2', 'Bob'), contraintes: [jamaisEnWeekEnd()] },
    vet('v3', 'Carol'),
    vet('v4', 'David'),
  ]

  it('ne condamne pas un week-end par le duo choisi la veille', () => {
    const r = remplirAuMieux(input(equipe()))

    // Chaque week-end doit être COMPLET : il y avait toujours une combinaison.
    for (const we of r.planning.attributions.filter((a) => a.type === 'weekend')) {
      const total = (we.placements ?? []).length
      const pourvues = (we.placements ?? []).filter((p) => p.vetId).length
      expect(`${we.date} ${pourvues}/${total}`).toBe(`${we.date} ${total}/${total}`)
    }
  })

  it('ne laisse aucune case vide alors qu une combinaison existait', () => {
    expect(remplirAuMieux(input(equipe())).creneauxVides).toEqual([])
  })
})

describe('B-053 — la branche échec de genererPlanningPur', () => {
  it('ne renvoie plus un planning vide', () => {
    const r = genererPlanningPur(input([vet('v1', 'Alice'), vet('v2', 'Bob', CONGE_TOTAL)]))

    expect(r.success).toBe(false)
    if (r.success) return

    // Avant B-053 : `planningPartiel: { attributions: [] }` en dur, jamais lu.
    expect(placesPourvues(r.planningPartiel)).toBeGreaterThan(0)
    expect(r.creneauxVides?.length ?? 0).toBeGreaterThan(0)

    // Et les vrais trous sont MOINS nombreux que l'ancien rapport, qui listait
    // tout ce qui suivait le point d'arrêt (B-049).
    expect(r.creneauxVides!.length).toBeLessThan(r.joursNonCouverts.length)
  })
})
