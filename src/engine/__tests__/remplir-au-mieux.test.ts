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
import { genererPlanningPur, remplirAuMieux, rattraperCasesVides, type SolverInput } from '../solver'
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

describe('B-060 — la passe de rattrapage', () => {
  /**
   * Idée de MiKL, le 26/08 : « une étape supplémentaire qui viendrait vérifier
   * ce qui a été produit et qui remplirait le reste des cases vides — ou en tout
   * cas qui vérifierait une dernière fois qu'aucune solution n'est possible ».
   *
   * Mesure sur Hiver P1 (vraies données) : 3 cases restantes → 1, en 1,5 s.
   */
  const CONGE_TOUT = [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' as const }]

  it('ne rend jamais un planning MOINS rempli qu au départ', () => {
    // La garantie qui compte : la reprise ne peut que gagner des places, jamais
    // en perdre. Un échange à somme nulle serait déjà refusé.
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob', CONGE_TOUT), vet('v3', 'Carol')]
    const depart = remplirAuMieux(input(vets))
    const apres = rattraperCasesVides(input(vets), depart, { budgetMs: 3000 })

    expect(placesPourvues(apres.planning)).toBeGreaterThanOrEqual(placesPourvues(depart.planning))
    expect(apres.gagnees).toBeGreaterThanOrEqual(0)
  })

  it('ne déclare « impossible » que ce qui l est quoi qu on réorganise', () => {
    // Deux personnes, une absente toute la période : les week-ends demandent
    // deux personnes distinctes, aucune réorganisation n'y changera rien —
    // mais ce n'est pas pour autant que TOUT le monde est indisponible.
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob', CONGE_TOUT)]
    const depart = remplirAuMieux(input(vets))
    const apres = rattraperCasesVides(input(vets), depart, { budgetMs: 3000 })

    expect(apres.creneauxVides.length).toBeGreaterThan(0)
    for (const c of apres.creneauxVides) {
      expect(c.statut).toBeDefined()
      // Alice reste disponible sur ces créneaux (c'est la 2e place qui manque) :
      // on ne doit donc PAS annoncer une impossibilité de principe.
      expect(c.statut).toBe('non_trouve')
    }
  })

  it('ne conclut RIEN quand le temps a manqué', () => {
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob', CONGE_TOUT)]
    const depart = remplirAuMieux(input(vets))
    // Budget nul : la reprise n'a pas pu chercher. Elle doit le dire, et ne
    // surtout pas conclure à l'impossible — la faute que ce projet corrige.
    const apres = rattraperCasesVides(input(vets), depart, { budgetMs: 0 })

    expect(apres.budgetEpuise).toBe(true)
    for (const c of apres.creneauxVides) expect(c.statut).toBe('non_trouve')
  })

  it('raconte ce qu elle fait', () => {
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob', CONGE_TOUT)]
    const messages: string[] = []
    const depart = remplirAuMieux(input(vets))
    rattraperCasesVides(input(vets), depart, { budgetMs: 3000, onProgres: (m) => messages.push(m) })

    // La progression affichée à l'écran doit venir du moteur, jamais d'un
    // décompte décoratif côté client.
    expect(messages.length).toBeGreaterThan(0)
  })
})

describe('B-061 — le partage des premiers de garde', () => {
  /**
   * MiKL : « pourquoi Fanny ne fait pas un WE 1re de garde ? Elle en fait 2 en
   * 2nde, ce qui déséquilibre en plus le compteur ». Le moteur comptait combien
   * de fois on a EU le rôle avantagé, jamais combien de fois on l'a RATÉ.
   *
   * ⚠️ Ce correctif a d'abord été tenté DANS LE SCORE. Mesure : il donnait bien
   * le rôle à Fanny, mais faisait passer le remplissage de 3 à 5 cases vides —
   * « remplir » se payait sur « répartir ». D'où une passe séparée, qui
   * n'échange que des rôles sur des week-ends déjà complets.
   *
   * Ces tests protègent les deux INVARIANTS de cette passe, pas un cas
   * particulier : elle ne perd jamais une garde, et elle n'aggrave jamais le
   * partage.
   */
  const CONGE = [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN, type: 'vacances' as const }]

  function bilanRoles(planning: { attributions: { type: string; placements?: { role: string; vetId: string | null }[] }[] }) {
    const we = new Map<string, number>()
    const premier = new Map<string, number>()
    for (const a of planning.attributions) {
      if (a.type !== 'weekend') continue
      for (const p of a.placements ?? []) {
        if (!p.vetId) continue
        we.set(p.vetId, (we.get(p.vetId) ?? 0) + 1)
        if (p.role === 'premier') premier.set(p.vetId, (premier.get(p.vetId) ?? 0) + 1)
      }
    }
    // Les week-ends tenus SANS le rôle avantagé — ce que MiKL regarde.
    const rates = [...we.entries()].map(([id, n]) => n - (premier.get(id) ?? 0))
    return rates.length === 0 ? 0 : Math.max(...rates) - Math.min(...rates)
  }

  it('ne perd JAMAIS une garde en rééquilibrant les rôles', () => {
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol'), vet('v4', 'David', CONGE)]
    const depart = remplirAuMieux(input(vets))
    const apres = rattraperCasesVides(input(vets), depart, { budgetMs: 5000 })

    // L'échange porte sur des week-ends DÉJÀ complets et ne fait que permuter
    // deux personnes : le total ne peut pas bouger. C'est une propriété de la
    // transformation, pas une précaution qu'on espère.
    expect(placesPourvues(apres.planning)).toBeGreaterThanOrEqual(placesPourvues(depart.planning))
  })

  it('n aggrave jamais le partage des premiers de garde', () => {
    const vets = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol'), vet('v4', 'David')]
    const depart = remplirAuMieux(input(vets))
    const apres = rattraperCasesVides(input(vets), depart, { budgetMs: 5000 })

    expect(bilanRoles(apres.planning)).toBeLessThanOrEqual(bilanRoles(depart.planning))
  })
})
