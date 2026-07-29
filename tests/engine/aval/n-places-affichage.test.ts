// ============================================================
// GUARDVETO — Les 3e et 4e vétérinaires arrivent-ils À L'ÉCRAN ?
// ============================================================
// `p3a2-n-places.test.ts` prouve que le MOTEUR sait pourvoir 3 places. Ce
// banc-ci prouve la suite du trajet : de ce que le moteur produit jusqu'à ce
// que la grille, le PDF et l'agenda affichent — c'est-à-dire la chaîne
// branchée le 2026-07-29.
//
// Le piège qu'on garde sous surveillance : les places 0 et 1 ne doivent
// JAMAIS être relues depuis le miroir `garde_placements`. Ce sont les
// colonnes `premier_`/`second_` qui portent l'inversion du vendredi ; les
// relire du miroir rouvrirait le bug de la couche aval du 2026-06-17.
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { construireGardePlacements } from '@/data/gardePlacements'
import { placesDeGarde, vetsDeGarde, aDesPlacesSupplementaires } from '@/lib/gardes/places'
import type { VetEngine } from '@/engine/types'
import type { CreneauModele } from '@/engine/creneau-modele'

// ── Un catalogue à 4 places, le maximum autorisé par l'écran Structure ──

const creneauWE4: CreneauModele = {
  id: 'cr-we-4',
  code: 'weekend',
  nom: 'Week-end à 4 places',
  joursSemaine: [6],
  surFeries: false,
  heureDebut: '08:30',
  heureFin: '08:30',
  offsetJoursFin: 2,
  nbPlaces: 4,
  roles: ['premier', 'second', 'troisieme', 'quatrieme'],
  actif: true,
  ordre: 1,
}

const vets: VetEngine[] = Array.from({ length: 6 }, (_, i) => ({
  id: `v${i + 1}`,
  nom: `Nom${i + 1}`,
  prenom: `Prenom${i + 1}`,
  statut: 'associe',
  dernier_recours: false,
  contraintes: [],
  conges: [],
}))

const SAMEDI = '2026-01-10'
const solverInput: SolverInput = {
  dateDebut: '2026-01-05',
  dateFin: '2026-01-11',
  saison: 'hiver',
  vets,
  bonusMalus: {},
  creneaux: [creneauWE4],
}

describe('N places — du moteur jusqu’à la case du planning', () => {
  const result = genererPlanningPur(solverInput)

  it('le moteur pourvoit les 4 places sans se planter', () => {
    expect(result.success).toBe(true)
    if (!result.success) return
    const we = result.planning.attributions.find((a) => a.date === SAMEDI)!
    expect(we.placements).toHaveLength(4)
    expect(we.placements.every((p) => p.vetId !== null)).toBe(true)
  })

  it('les 4 places sont persistées : 2 en colonnes, 2 dans le miroir', () => {
    if (!result.success) return
    const we = result.planning.attributions.find((a) => a.date === SAMEDI)!

    // Ce que le générateur écrit dans `gardes` : les deux premières places.
    const premierId = we.placements[0].vetId
    const secondId = we.placements[1].vetId
    expect(premierId).toBeTruthy()
    expect(secondId).toBeTruthy()

    // Ce qu'il écrit dans le miroir : les QUATRE, dont les deux qui n'ont
    // aucune colonne pour les accueillir.
    const rows = construireGardePlacements(
      [{ date: SAMEDI, dbType: 'weekend', placements: we.placements }],
      new Map([[`${SAMEDI}|weekend`, 'garde-1']]),
      'cab-1',
    )
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.place_index)).toEqual([0, 1, 2, 3])
    expect(rows.filter((r) => r.place_index >= 2)).toHaveLength(2)
  })

  it('la case du planning affiche les 4 vétérinaires, dans l’ordre', () => {
    if (!result.success) return
    const we = result.planning.attributions.find((a) => a.date === SAMEDI)!
    const parId = new Map(vets.map((v) => [v.id, v]))

    // Ce que la vue `planning_semaine` renvoie : colonnes V1 + places_sup.
    const ligneVue = {
      premier_id: we.placements[0].vetId,
      premier_prenom: parId.get(we.placements[0].vetId!)!.prenom,
      premier_nom: parId.get(we.placements[0].vetId!)!.nom,
      premier_couleur: '#111',
      second_id: we.placements[1].vetId,
      second_prenom: parId.get(we.placements[1].vetId!)!.prenom,
      second_nom: parId.get(we.placements[1].vetId!)!.nom,
      second_couleur: '#222',
      places_sup: we.placements.slice(2).map((p, i) => ({
        place_index: i + 2,
        role: p.role,
        id: p.vetId!,
        prenom: parId.get(p.vetId!)!.prenom,
        nom: parId.get(p.vetId!)!.nom,
        couleur: '#333',
      })),
    }

    const places = placesDeGarde(ligneVue)
    expect(places).toHaveLength(4)
    expect(places.map((p) => p.index)).toEqual([0, 1, 2, 3])
    // Chacune est affichable : un prénom, jamais un identifiant nu.
    expect(places.every((p) => Boolean(p.prenom))).toBe(true)
    // Et ce sont bien les 4 vétérinaires du moteur, dans le même ordre.
    expect(places.map((p) => p.vetId)).toEqual(we.placements.map((p) => p.vetId))
  })

  it('les 4 sont notifiables et comptables (aucun oublié)', () => {
    if (!result.success) return
    const we = result.planning.attributions.find((a) => a.date === SAMEDI)!
    const parId = new Map(vets.map((v) => [v.id, v]))
    const ligneVue = {
      premier_id: we.placements[0].vetId,
      premier_prenom: parId.get(we.placements[0].vetId!)!.prenom,
      second_id: we.placements[1].vetId,
      second_prenom: parId.get(we.placements[1].vetId!)!.prenom,
      places_sup: we.placements.slice(2).map((p, i) => ({
        place_index: i + 2,
        role: p.role,
        id: p.vetId!,
        prenom: parId.get(p.vetId!)!.prenom,
        nom: 'X',
        couleur: '#333',
      })),
    }
    const ids = vetsDeGarde(ligneVue)
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4) // 4 vétérinaires DISTINCTS
  })
})

// ── Le garde-fou : l'inversion du vendredi ne doit pas être contournée ──

describe('N places — les deux premières places restent celles de la vue', () => {
  // Le vendredi, la vue échange premier et second (inversion R8). Si le miroir
  // contenait aussi les places 0 et 1, les relire écraserait cette inversion
  // et réafficherait l'ordre du samedi — le bug de 2026-06-17.
  const ligneVendrediInverse = {
    premier_id: 'v-second', // inversé par la vue
    premier_prenom: 'Second',
    premier_nom: 'Deux',
    premier_couleur: '#222',
    second_id: 'v-premier',
    second_prenom: 'Premier',
    second_nom: 'Un',
    second_couleur: '#111',
    places_sup: [
      // Le miroir porte l'ordre NATIF (non inversé) pour les places 0 et 1 :
      // il ne doit pas être écouté sur ces deux-là.
      { place_index: 0, role: 'premier', id: 'v-premier', prenom: 'Premier', nom: 'Un', couleur: '#111' },
      { place_index: 1, role: 'second', id: 'v-second', prenom: 'Second', nom: 'Deux', couleur: '#222' },
      { place_index: 2, role: 'troisieme', id: 'v-trois', prenom: 'Trois', nom: 'Trois', couleur: '#333' },
    ],
  }

  const places = placesDeGarde(ligneVendrediInverse)

  it('n’affiche pas de doublon (le miroir ne rajoute pas les places 0 et 1)', () => {
    expect(places).toHaveLength(3)
    expect(new Set(places.map((p) => p.vetId)).size).toBe(3)
  })

  it('conserve l’ordre INVERSÉ de la vue, pas celui du miroir', () => {
    expect(places[0].vetId).toBe('v-second')
    expect(places[1].vetId).toBe('v-premier')
  })

  it('ajoute quand même la 3e place, qui n’existe que dans le miroir', () => {
    expect(places[2].vetId).toBe('v-trois')
    expect(places[2].role).toBe('troisieme')
  })
})

// ── Le cas ordinaire ne bouge pas ──

describe('N places — une garde à 1 ou 2 places reste inchangée', () => {
  it('une garde à deux places donne deux lignes, sans miroir', () => {
    const places = placesDeGarde({
      premier_id: 'a', premier_prenom: 'Anne', premier_nom: 'A', premier_couleur: '#1',
      second_id: 'b', second_prenom: 'Bob', second_nom: 'B', second_couleur: '#2',
    })
    expect(places).toHaveLength(2)
    expect(places.map((p) => p.role)).toEqual(['1er', '2e'])
  })

  it('une garde à une seule place ne fabrique pas de deuxième ligne', () => {
    const places = placesDeGarde({
      premier_id: 'a', premier_prenom: 'Anne', premier_nom: 'A', premier_couleur: '#1',
      second_id: null, second_prenom: null,
    })
    expect(places).toHaveLength(1)
  })

  it('sait dire si une garde cache des places que les colonnes ne portent pas', () => {
    expect(aDesPlacesSupplementaires({ places_sup: [] })).toBe(false)
    expect(aDesPlacesSupplementaires({})).toBe(false)
    expect(
      aDesPlacesSupplementaires({
        places_sup: [{ place_index: 2, role: 'x', id: 'v', prenom: 'V', nom: 'V', couleur: '#1' }],
      }),
    ).toBe(true)
  })
})
