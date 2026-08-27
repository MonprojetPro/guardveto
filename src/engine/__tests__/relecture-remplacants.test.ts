// ============================================================
// B-075 — qui pourrait tenir chaque place
// ============================================================
// MiKL, le 27/08, devant une relecture riche en constats et vide en actions :
// « il n'avait aucune idée de comment faire pour changer au mieux ? Je trouve
// actuellement comme c'est que ça ne sert à rien. »
//
// La cause : Filou ne savait pas qui pouvait aller où, devait deviner, et
// s'abstenait. Ce module lui répond — et comme sa réponse décide de ce que
// Filou osera proposer, elle doit être juste dans les deux sens :
//
//   • trop LARGE  → il propose des changements que le moteur refusera, et
//                   l'admin lit des refus à la chaîne ;
//   • trop ÉTROIT → il se tait à nouveau, et on revient au « ça ne sert à rien ».
// ============================================================

import { describe, it, expect } from 'vitest'
import { remplacantsPossibles } from '../relecture/remplacants'
import type { PlanningPartiel, VetEngine } from '../types'

const DATE_DEBUT = '2025-11-03' // lundi
const DATE_FIN = '2025-11-07'   // vendredi — une seule semaine

function vet(
  id: string,
  prenom: string,
  extra: Partial<VetEngine> = {},
): VetEngine {
  return {
    id, nom: prenom, prenom, statut: 'associe',
    dernier_recours: false, contraintes: [], conges: [],
    ...extra,
  }
}

const EQUIPE = [
  vet('v1', 'Alice'), vet('v2', 'Bob'),
  vet('v3', 'Carol'), vet('v4', 'David'),
]

function options(vets: VetEngine[] = EQUIPE) {
  return {
    vets,
    dateDebut: DATE_DEBUT,
    dateFin: DATE_FIN,
    saison: 'hiver' as const,
    nbVetosSemaineSoir: 2,
  }
}

/** Le lundi soir, pourvu par Alice et Bob. */
function planningLundi(): PlanningPartiel {
  return {
    attributions: [
      {
        date: '2025-11-03', type: 'semaine_soir',
        placements: [
          { role: 'premier', vetId: 'v1' },
          { role: 'second', vetId: 'v2' },
        ],
      },
    ],
  }
}

const CLE_PREMIER = '2025-11-03|semaine_soir|premier'

describe('remplacantsPossibles — ce qui est possible', () => {
  it('propose ceux qui sont libres, sans l’occupant', () => {
    const r = remplacantsPossibles(planningLundi(), options())

    const possibles = r.get(CLE_PREMIER)!
    expect(possibles).toContain('v3')
    expect(possibles).toContain('v4')
    // L'occupant n'est pas son propre remplaçant.
    expect(possibles).not.toContain('v1')
  })

  it('N’EXCLUT PAS l’autre place du même créneau à tort', () => {
    // ⚠️ Le test qui protège le cœur du module. Le calcul se fait sur un
    // planning où la place est VIDÉE ; sans ça, l'occupant bloquerait tous les
    // candidats par « une garde par jour » et on répondrait « personne ne peut
    // remplacer » sur chaque place du planning — l'inverse de ce qu'on veut.
    const possibles = remplacantsPossibles(planningLundi(), options()).get(CLE_PREMIER)!

    // Bob tient l'autre place du même soir : il ne peut pas tenir les deux.
    expect(possibles).not.toContain('v2')
    // Mais les autres, eux, restent proposables.
    expect(possibles.length).toBeGreaterThan(0)
  })
})

describe('remplacantsPossibles — ce qui ne l’est pas', () => {
  it('n’propose JAMAIS quelqu’un en congé', () => {
    // Si ce test tombe, Filou proposera d'envoyer quelqu'un en vacances sur
    // une garde, et l'admin lira un refus incompréhensible.
    const equipe = [
      vet('v1', 'Alice'), vet('v2', 'Bob'),
      vet('v3', 'Carol', {
        conges: [{ date_debut: '2025-11-01', date_fin: '2025-11-30', type: 'vacances' }],
      }),
      vet('v4', 'David'),
    ]

    const possibles = remplacantsPossibles(planningLundi(), options(equipe)).get(CLE_PREMIER)!

    expect(possibles).not.toContain('v3')
    expect(possibles).toContain('v4')
  })

  it('n’propose JAMAIS un « dernier recours »', () => {
    // Réglage voulu du cabinet, pas un oubli : le moteur ne le mobilise jamais
    // spontanément, donc Filou non plus. L'admin peut toujours le poser à la
    // main depuis le planning.
    const equipe = [
      vet('v1', 'Alice'), vet('v2', 'Bob'),
      vet('v3', 'Carol', { dernier_recours: true }),
      vet('v4', 'David'),
    ]

    const possibles = remplacantsPossibles(planningLundi(), options(equipe)).get(CLE_PREMIER)!

    expect(possibles).not.toContain('v3')
  })

  it('rend une liste VIDE plutôt que d’inventer, quand personne ne peut', () => {
    // Une liste vide est une réponse : « personne d'autre ne peut prendre
    // cette place ». Elle doit exister, pas manquer.
    const equipe = [
      vet('v1', 'Alice'), vet('v2', 'Bob'),
      vet('v3', 'Carol', {
        conges: [{ date_debut: '2025-11-01', date_fin: '2025-11-30', type: 'vacances' }],
      }),
      vet('v4', 'David', {
        conges: [{ date_debut: '2025-11-01', date_fin: '2025-11-30', type: 'vacances' }],
      }),
    ]

    const r = remplacantsPossibles(planningLundi(), options(equipe))

    expect(r.has(CLE_PREMIER)).toBe(true)
    expect(r.get(CLE_PREMIER)).toEqual([])
  })
})

describe('remplacantsPossibles — hygiène', () => {
  it('ne mute pas le planning qu’on lui donne', () => {
    const origine = planningLundi()
    const avant = JSON.stringify(origine)

    remplacantsPossibles(origine, options())

    expect(JSON.stringify(origine)).toBe(avant)
  })

  it('couvre AUSSI les places vides — c’est là qu’on en a le plus besoin', () => {
    const partiel: PlanningPartiel = {
      attributions: [
        {
          date: '2025-11-03', type: 'semaine_soir',
          placements: [
            { role: 'premier', vetId: 'v1' },
            { role: 'second', vetId: null },
          ],
        },
      ],
    }

    const possibles = remplacantsPossibles(partiel, options()).get(
      '2025-11-03|semaine_soir|second',
    )!

    expect(possibles).toContain('v3')
    expect(possibles).toContain('v4')
  })
})
