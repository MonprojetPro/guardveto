// ============================================================
// GUARDVETO — L'effectif du soir en semaine monte à 4
// ============================================================
// CE QUI NE MARCHAIT PAS. Le catalogue accepte 1 à 4 places par créneau, mais
// le solver plafonnait « soir de semaine » par l'effectif configurable — et
// perdait le nombre exact en route :
//
//     besoinSecondSemaine = effectif >= 2      // 3 → true
//     effectifSemaine     = besoinSecond ? 2 : 1  // true → 2   ⚠️ le 3 est mort ici
//     nbAEmettre          = Math.min(nbPlaces, effectifSemaine)
//
// Un cabinet qui déclarait 3 ou 4 vétérinaires le soir n'en voyait donc
// pourvoir que 2, SANS AUCUNE ALERTE : le planning sortait simplement plus
// petit que demandé. L'effectif circule maintenant comme un NOMBRE.
//
// Ces tests gâtent les deux moitiés du contrat :
//   • ce qui doit CHANGER  — 3 et 4 places sont réellement pourvues ;
//   • ce qui ne doit PAS changer — le plafond reste un plafond, et les
//     valeurs 1 et 2 se comportent exactement comme avant (c'est ce que
//     vérifient aussi les golden tests, qui doivent rester verts).
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur } from '@/engine/solver'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { CreneauModele } from '@/engine/creneau-modele'
import type { VetEngineNormalise } from '@/engine/types'

function vet(id: string): VetEngineNormalise {
  return normaliserContraintesVets([
    {
      id,
      nom: id,
      prenom: id,
      statut: 'salarie',
      dernier_recours: false,
      contraintes: [],
      conges: [],
    },
  ])[0]
}

const ROLES = ['premier', 'second', 'troisieme', 'quatrieme']

/**
 * Un catalogue minimal : le seul créneau « soir de semaine », du lundi au
 * jeudi, avec `nbPlaces` places. Pas de week-end ni de vendredi — on isole ce
 * qui est mesuré.
 */
function catalogueSoirSemaine(nbPlaces: number): CreneauModele[] {
  return [
    {
      id: 'c-semaine',
      code: 'semaine_soir',
      nom: 'Soir de semaine',
      joursSemaine: [1, 2, 3, 4],
      surFeries: false,
      heureDebut: '18:30',
      heureFin: '08:30',
      offsetJoursFin: 1,
      nbPlaces,
      roles: ROLES.slice(0, nbPlaces),
      actif: true,
      ordre: 1,
    },
  ]
}

/** Une semaine pleine : lundi 2026-07-06 → dimanche 2026-07-12. */
const SEMAINE = { dateDebut: '2026-07-06', dateFin: '2026-07-12' }

/** Assez de monde pour pourvoir 4 places par nuit sans se marcher dessus. */
const VETS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(vet)

/** Combien de places sont réellement pourvues sur chaque nuit de semaine. */
function placesPourvuesParNuit(nbPlaces: number, nbVetosSemaineSoir?: number): number[] {
  const res = genererPlanningPur({
    ...SEMAINE,
    saison: 'ete',
    vets: VETS,
    bonusMalus: {},
    lnsTimeoutMs: 0,
    creneaux: catalogueSoirSemaine(nbPlaces),
    nbVetosSemaineSoir,
  })
  expect(res.success).toBe(true)
  if (!res.success) return []

  return res.planning.attributions
    .filter((a) => a.type === 'semaine_soir')
    .map((a) => a.placements.filter((p) => p.vetId !== null).length)
}

describe("L'effectif du soir en semaine accepte 3 et 4", () => {
  it('3 places demandées et effectif réglé à 3 → 3 vétérinaires par nuit', () => {
    const nuits = placesPourvuesParNuit(3, 3)
    expect(nuits.length).toBe(4) // lundi → jeudi
    expect(nuits.every((n) => n === 3)).toBe(true)
  })

  it('4 places demandées et effectif réglé à 4 → 4 vétérinaires par nuit', () => {
    const nuits = placesPourvuesParNuit(4, 4)
    expect(nuits.length).toBe(4)
    expect(nuits.every((n) => n === 4)).toBe(true)
  })

  it('jamais rabattu à 2 : c\'est la valeur exacte que produisait l\'ancien booléen', () => {
    // Écrit à part et en toutes lettres parce que 2 est LA valeur du bug :
    // tant que l'effectif transitait en booléen, tout réglage ≥ 2 retombait
    // ici. Si quelqu'un remet un booléen sur ce chemin, c'est ce test qui le
    // dira, et il dira aussi pourquoi.
    expect(placesPourvuesParNuit(3, 3)).not.toContain(2)
    expect(placesPourvuesParNuit(4, 4)).not.toContain(2)
  })
})

describe('Le plafond reste un plafond', () => {
  it('4 places au catalogue mais effectif réglé à 2 → 2 par nuit (la période surcharge)', () => {
    const nuits = placesPourvuesParNuit(4, 2)
    expect(nuits.every((n) => n === 2)).toBe(true)
  })

  it('1 place au catalogue et effectif réglé à 4 → 1 par nuit (le catalogue borne aussi)', () => {
    const nuits = placesPourvuesParNuit(1, 4)
    expect(nuits.every((n) => n === 1)).toBe(true)
  })
})

// ============================================================
// CE BLOC A CHANGÉ DE SENS LE 2026-08-04 — et c'est le cœur de la décision.
//
// Il vérifiait : « sans réglage explicite, le repli saison s'applique — été = 1,
// hiver = 2 — MÊME SI le catalogue en déclare 4 ». Autrement dit, deux lignes en
// dur dans le moteur pouvaient contredire la structure de gardes que le cabinet
// avait lui-même écrite, sur le seul créneau du soir.
//
// MiKL, 2026-08-04 : « pourquoi on ne définit que le nb de véto pour les soirs
// de la semaine et pas les week-ends ? ». Parce que les week-ends, eux, ont
// toujours suivi leur créneau. La nuit de semaine était l'exception, et c'est
// l'exception qui part : sans surcharge portée par le planning lui-même, la
// structure des gardes décide — pour toutes les gardes, saison comprise.
//
// La saison ne disparaît pas de l'application : elle ne décide simplement plus
// à la place du cabinet. Un cabinet qui veut 1 véto l'été règle son créneau à 1
// dans sa période type « Été » — ce qui se voit, se lit et s'explique.
// ============================================================
describe('Sans surcharge de planning, la structure des gardes décide', () => {
  it('été, 4 places au catalogue et aucun effectif réglé → 4 par nuit', () => {
    const nuits = placesPourvuesParNuit(4, undefined)
    expect(nuits.every((n) => n === 4)).toBe(true)
  })

  it('hiver, 4 places au catalogue et aucun effectif réglé → 4 par nuit', () => {
    const res = genererPlanningPur({
      ...SEMAINE,
      saison: 'hiver',
      vets: VETS,
      bonusMalus: {},
      lnsTimeoutMs: 0,
      creneaux: catalogueSoirSemaine(4),
    })
    expect(res.success).toBe(true)
    if (!res.success) return
    const nuits = res.planning.attributions
      .filter((a) => a.type === 'semaine_soir')
      .map((a) => a.placements.filter((p) => p.vetId !== null).length)
    expect(nuits.every((n) => n === 4)).toBe(true)
  })

  it('un créneau à 1 place suffit à n’avoir qu’un véto la nuit, en hiver comme en été', () => {
    // La contrepartie du changement : ce qui se réglait par la saison se règle
    // maintenant par le créneau — donc ce réglage doit vraiment fonctionner,
    // sinon on aurait retiré un levier sans en donner un autre.
    expect(placesPourvuesParNuit(1, undefined).every((n) => n === 1)).toBe(true)
  })

  it('la surcharge du planning garde le dernier mot sur le créneau', () => {
    // Le seul maillon conservé : « cet été-là, on n'était que cinq ».
    expect(placesPourvuesParNuit(4, 1).every((n) => n === 1)).toBe(true)
  })
})

describe('Sans AUCUNE structure de gardes, le repli saison reste', () => {
  // Contextes legacy et tests hors-structure : aucun créneau ne porte de nombre
  // de places, il faut bien un chiffre. C'est le seul endroit où « hiver = 2,
  // été = 1 » survit — et il ne concerne aucun cabinet réel.
  it('été sans catalogue → 1 par nuit', () => {
    const res = genererPlanningPur({
      ...SEMAINE, saison: 'ete', vets: VETS, bonusMalus: {}, lnsTimeoutMs: 0,
    })
    expect(res.success).toBe(true)
    if (!res.success) return
    const nuits = res.planning.attributions
      .filter((a) => a.type === 'semaine_soir')
      .map((a) => a.placements.filter((p) => p.vetId !== null).length)
    expect(nuits.every((n) => n === 1)).toBe(true)
  })

  it('hiver sans catalogue → 2 par nuit', () => {
    const res = genererPlanningPur({
      ...SEMAINE, saison: 'hiver', vets: VETS, bonusMalus: {}, lnsTimeoutMs: 0,
    })
    expect(res.success).toBe(true)
    if (!res.success) return
    const nuits = res.planning.attributions
      .filter((a) => a.type === 'semaine_soir')
      .map((a) => a.placements.filter((p) => p.vetId !== null).length)
    expect(nuits.every((n) => n === 2)).toBe(true)
  })
})
