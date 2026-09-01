// ============================================================
// B-093 — quelles places peuvent s'échanger
// ============================================================
// MiKL, le 2026-09-01, devant SEPT constats de Filou tous marqués « il ne voit
// pas de correction automatique » : « pourquoi il n'agit pas ? »
//
// Parce qu'on ne lui donnait que les remplacements SIMPLES — qui pourrait
// prendre cette place si on ne libère que celle-là. Sur le planning que le
// moteur venait d'optimiser, 53 places sur 118 n'en avaient aucun, et là où il
// y en avait, 1,18 en moyenne. Ce qui reste à améliorer dans un planning
// optimisé, ce sont les ÉCHANGES.
//
// Comme pour les remplaçants, la réponse de ce module décide de ce que Filou
// osera proposer. Elle doit donc être juste DANS LES DEUX SENS :
//
//   • trop LARGE  → il propose des échanges que le moteur refusera ;
//   • trop ÉTROIT → il se tait, et on revient au « ça ne sert à rien ».
//
// Les tests ci-dessous couvrent les deux, et surtout le piège qui a déjà été
// commis à la main le 2026-09-01 : ne vérifier qu'un côté du déplacement.
// ============================================================

import { describe, it, expect } from 'vitest'
import { echangesPossibles, clePlace } from '../relecture/echanges'
import type { PlanningPartiel, VetEngine, ContrainteEngine } from '../types'

const LUN = '2025-11-03', MAR = '2025-11-04', MER = '2025-11-05', JEU = '2025-11-06'

function vet(id: string, prenom: string, extra: Partial<VetEngine> = {}): VetEngine {
  return {
    id, nom: prenom, prenom, statut: 'associe',
    dernier_recours: false, contraintes: [], conges: [],
    ...extra,
  }
}

const EQUIPE = [vet('v1', 'Alice'), vet('v2', 'Bob'), vet('v3', 'Carol'), vet('v4', 'David')]

function options(vets: VetEngine[] = EQUIPE, cibles?: string[]) {
  return {
    vets,
    dateDebut: LUN,
    dateFin: '2025-11-07',
    saison: 'hiver' as const,
    nbVetosSemaineSoir: 2,
    vetsCibles: cibles,
  }
}

/** Deux soirs pourvus : lundi (Alice + Bob), mercredi (Carol + David). */
function planningDeuxSoirs(): PlanningPartiel {
  return {
    attributions: [
      {
        date: LUN, type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v2' }],
      },
      {
        date: MER, type: 'semaine_soir',
        placements: [{ role: 'premier', vetId: 'v3' }, { role: 'second', vetId: 'v4' }],
      },
    ],
  }
}

function contient(
  echanges: ReturnType<typeof echangesPossibles>,
  cleA: string, cleB: string,
): boolean {
  return echanges.some((e) => {
    const ka = clePlace(e.a.date, e.a.type, e.a.role)
    const kb = clePlace(e.b.date, e.b.type, e.b.role)
    return (ka === cleA && kb === cleB) || (ka === cleB && kb === cleA)
  })
}

describe('echangesPossibles — le cas nominal', () => {
  it('trouve l’échange entre le premier du lundi et le premier du mercredi', () => {
    const e = echangesPossibles(planningDeuxSoirs(), options())
    expect(
      contient(e,
        clePlace(LUN, 'semaine_soir', 'premier'),
        clePlace(MER, 'semaine_soir', 'premier')),
    ).toBe(true)
  })

  it('trouve aussi les échanges de RÔLE au sein du même soir', () => {
    // Alice et Bob permutent premier ↔ second le même lundi : c'est un échange
    // légitime, et c'est le levier du critère « le rôle qui rapporte doit tourner ».
    const e = echangesPossibles(planningDeuxSoirs(), options())
    expect(
      contient(e,
        clePlace(LUN, 'semaine_soir', 'premier'),
        clePlace(LUN, 'semaine_soir', 'second')),
    ).toBe(true)
  })

  it('ne propose jamais d’échanger quelqu’un avec lui-même', () => {
    const planning: PlanningPartiel = {
      attributions: [
        { date: LUN, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v2' }] },
        { date: MER, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v1' }, { role: 'second', vetId: 'v3' }] },
      ],
    }
    const e = echangesPossibles(planning, options())
    expect(e.every((x) => x.a.vetId !== x.b.vetId)).toBe(true)
  })
})

describe('echangesPossibles — ce qu’il doit REFUSER', () => {
  it('refuse un échange qui violerait une règle de la personne qui ARRIVE', () => {
    // Carol ne fait jamais le lundi (règle dure). L'échange lundi ↔ mercredi
    // l'y enverrait : il doit être écarté.
    const carolPasLundi: ContrainteEngine = {
      id: 'c1', type: 'jour_repos_fixe', actif: true,
      config: { brique: 'interdire_creneau', force: 2, params: { jour: 'lundi' } },
    } as ContrainteEngine
    const equipe = [
      vet('v1', 'Alice'), vet('v2', 'Bob'),
      vet('v3', 'Carol', { contraintes: [carolPasLundi] }), vet('v4', 'David'),
    ]
    const e = echangesPossibles(planningDeuxSoirs(), options(equipe))
    expect(
      contient(e,
        clePlace(LUN, 'semaine_soir', 'premier'),
        clePlace(MER, 'semaine_soir', 'premier')),
    ).toBe(false)
  })

  it('LE PIÈGE : vérifier un seul côté du déplacement', () => {
    // Erreur commise à la main par l'assistant le 2026-09-01, et repérée par
    // MiKL : on déplace quelqu'un en regardant l'écart avec sa garde
    // PRÉCÉDENTE, sans voir la SUIVANTE.
    //
    // Ici Bob est de garde le mardi. L'échanger vers le jeudi paraît anodin si
    // l'on ne regarde que le lundi qui précède — mais Bob est aussi de garde le
    // mercredi, et jeudi le mettrait à un jour d'écart.
    const espacement2: ContrainteEngine = {
      id: 'e1', type: 'espacement_min', actif: true,
      config: { brique: 'espacement_min', force: 2, params: { ecart_min_jours: 2 } },
    } as ContrainteEngine
    const equipe = [
      vet('v1', 'Alice'), vet('v2', 'Bob', { contraintes: [espacement2] }),
      vet('v3', 'Carol'), vet('v4', 'David'),
    ]
    const planning: PlanningPartiel = {
      attributions: [
        { date: MAR, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v2' }, { role: 'second', vetId: 'v1' }] },
        { date: MER, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v2' }, { role: 'second', vetId: 'v3' }] },
        { date: JEU, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v4' }, { role: 'second', vetId: 'v1' }] },
      ],
    }
    const e = echangesPossibles(planning, options(equipe))
    // Bob (mardi) ↔ David (jeudi) : Bob se retrouverait jeudi, à un jour de son
    // mercredi. Le moteur doit le refuser, et donc ce module aussi.
    expect(
      contient(e,
        clePlace(MAR, 'semaine_soir', 'premier'),
        clePlace(JEU, 'semaine_soir', 'premier')),
    ).toBe(false)
  })

  it('ignore les places VIDES — elles relèvent des remplaçants, pas des échanges', () => {
    const planning: PlanningPartiel = {
      attributions: [
        { date: LUN, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v1' }, { role: 'second', vetId: null }] },
        { date: MER, type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'v3' }, { role: 'second', vetId: 'v4' }] },
      ],
    }
    const e = echangesPossibles(planning, options())
    expect(e.every((x) => x.a.role !== 'second' || x.a.date !== LUN)).toBe(true)
    expect(e.every((x) => x.b.role !== 'second' || x.b.date !== LUN)).toBe(true)
  })
})

describe('echangesPossibles — le filtre qui borne le dossier', () => {
  it('ne renvoie que les échanges impliquant une personne ciblée', () => {
    const e = echangesPossibles(planningDeuxSoirs(), options(EQUIPE, ['v1']))
    expect(e.length).toBeGreaterThan(0)
    expect(e.every((x) => x.a.vetId === 'v1' || x.b.vetId === 'v1')).toBe(true)
  })

  it('sans filtre, en trouve strictement plus qu’avec', () => {
    // Garde-fou : si le filtre ne filtrait rien, ou filtrait tout, ce test le dit.
    const tous = echangesPossibles(planningDeuxSoirs(), options())
    const cibles = echangesPossibles(planningDeuxSoirs(), options(EQUIPE, ['v1']))
    expect(tous.length).toBeGreaterThan(cibles.length)
    expect(cibles.length).toBeGreaterThan(0)
  })

  it('est DÉTERMINISTE — deux appels donnent le même ordre', () => {
    // Le dossier envoyé au modèle doit être stable d'une relecture à l'autre,
    // sinon deux relectures du même planning ne se comparent pas.
    const a = echangesPossibles(planningDeuxSoirs(), options())
    const b = echangesPossibles(planningDeuxSoirs(), options())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
