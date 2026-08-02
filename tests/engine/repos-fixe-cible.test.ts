// ============================================================
// GUARDVETO — Repos fixe CIBLÉ par type de garde
// ============================================================
// LE TROU QUE CETTE CAPACITÉ REFERME — trouvé le 2026-08-02, en recette.
//
// « Anne-Catherine ne fait pas de garde le mercredi » ne savait viser qu'un
// JOUR. Tant qu'un cabinet n'a qu'une garde par jour, « le mercredi » et « la
// garde du mercredi » se confondent — et personne ne voit le problème.
//
// Mais la structure permet de déclarer plusieurs gardes le même jour (une de
// jour, une de soir). Le jour où un cabinet le fait, cette règle se met à
// interdire les DEUX en n'en annonçant qu'une, sans le moindre signal. La
// donnée d'origine du cabinet pilote porte d'ailleurs un `periode: 'apres_midi'`
// qu'aucun code n'a jamais évalué : la phrase affichée promettait déjà une
// portée partielle que le moteur n'appliquait pas.
//
// D'où le ciblage `creneaux` — et ces tests, qui gardent les DEUX bouts :
//   · une règle SANS ciblage se comporte exactement comme avant (toutes les
//     règles déjà en base sont dans ce cas : aucune régression tolérée) ;
//   · une règle AVEC ciblage ne bloque que ce qu'elle nomme ;
//   · le validateur dit la MÊME chose que le solver (deux gardiens, une seule
//     vérité — le projet a déjà payé une divergence de ce genre sur R8/R9).
// ============================================================

import { describe, it, expect } from 'vitest'
import { isValid } from '@/engine/rules/hard-constraints'
import { validerPlanning } from '@/engine/validation/validerPlanning'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type {
  VetEngine, SlotGarde, PlanningPartiel, ContrainteEngine,
} from '@/engine/types'

// 2026-01-07 est un MERCREDI.
const MERCREDI = '2026-01-07'
const JEUDI = '2026-01-08'

/** Un véto au repos le mercredi, éventuellement pour certaines gardes seulement. */
function vetReposMercredi(creneaux?: string[]) {
  const config: Record<string, unknown> = {
    brique: 'interdire_creneau',
    force: 2, // dur — un repos fixe « Jamais »
    params: {
      jour: 'mercredi',
      exception_vacances_scolaires: false,
      ...(creneaux ? { creneaux } : {}),
    },
  }
  const v: VetEngine = {
    id: 'ac', prenom: 'Anne-Catherine', nom: 'B', statut: 'associe',
    dernier_recours: false, conges: [],
    contraintes: [
      { id: 'r1', type: 'jour_repos_fixe', actif: true, config } as ContrainteEngine,
    ],
  }
  return normaliserContraintesVets([v])[0]
}

const slot = (date: string, type: string): SlotGarde =>
  ({ date, type, saison: 'hiver', besoinSecond: false }) as SlotGarde

const planningVide: PlanningPartiel = { attributions: [] }

describe('sans ciblage — le comportement historique, à l’identique', () => {
  it('bloque la garde du soir le mercredi', () => {
    const v = vetReposMercredi()
    expect(isValid(slot(MERCREDI, 'semaine_soir'), v, 'premier', [v], planningVide).valid)
      .toBe(false)
  })

  it('bloque AUSSI une garde de jour le mercredi (toute la journée)', () => {
    const v = vetReposMercredi()
    expect(isValid(slot(MERCREDI, 'sm_garde_de_jour'), v, 'premier', [v], planningVide).valid)
      .toBe(false)
  })

  it('ne bloque rien un autre jour', () => {
    const v = vetReposMercredi()
    expect(isValid(slot(JEUDI, 'semaine_soir'), v, 'premier', [v], planningVide).valid)
      .toBe(true)
  })
})

describe('avec ciblage — seulement les gardes nommées', () => {
  it('bloque la garde de jour visée', () => {
    const v = vetReposMercredi(['sm_garde_de_jour'])
    expect(isValid(slot(MERCREDI, 'sm_garde_de_jour'), v, 'premier', [v], planningVide).valid)
      .toBe(false)
  })

  it('LAISSE PASSER la garde du soir, non visée — c’est tout l’objet', () => {
    const v = vetReposMercredi(['sm_garde_de_jour'])
    expect(isValid(slot(MERCREDI, 'semaine_soir'), v, 'premier', [v], planningVide).valid)
      .toBe(true)
  })

  it('une liste vide vaut « toute la journée », pas « rien »', () => {
    // Le piège inverse : un ciblage vide qui n'interdirait plus rien
    // transformerait la règle en coquille vide, en silence.
    const v = vetReposMercredi([])
    expect(isValid(slot(MERCREDI, 'semaine_soir'), v, 'premier', [v], planningVide).valid)
      .toBe(false)
  })

  it('plusieurs gardes visées à la fois', () => {
    const v = vetReposMercredi(['sm_garde_de_jour', 'semaine_soir'])
    expect(isValid(slot(MERCREDI, 'semaine_soir'), v, 'premier', [v], planningVide).valid)
      .toBe(false)
    expect(isValid(slot(MERCREDI, 'sm_garde_de_jour'), v, 'premier', [v], planningVide).valid)
      .toBe(false)
  })
})

describe('le validateur dit la même chose que le solver', () => {
  const planningAvecSoirMercredi = {
    attributions: [
      {
        date: MERCREDI,
        type: 'semaine_soir',
        placements: [
          { role: 'premier', vetId: 'ac' },
          { role: 'second', vetId: null },
        ],
      },
    ],
  }

  const violationsR1 = (v: ReturnType<typeof vetReposMercredi>) =>
    validerPlanning(planningAvecSoirMercredi as never, {
      dateDebut: MERCREDI,
      dateFin: JEUDI,
      saison: 'hiver',
      vets: [v],
    }).filter((x) => x.regle === 'R1')

  it('ne signale AUCUNE violation quand la garde n’est pas visée', () => {
    expect(violationsR1(vetReposMercredi(['sm_garde_de_jour']))).toEqual([])
  })

  it('signale la violation quand la règle n’est pas ciblée', () => {
    expect(violationsR1(vetReposMercredi()).length).toBeGreaterThan(0)
  })
})
