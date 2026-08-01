// ============================================================
// GUARDVETO — L'équité voit enfin les places de renfort
// ============================================================
// CE QUI NE MARCHAIT PAS. Les compteurs d'équité de semaine testaient des rôles
// NOMMÉS en dur :
//
//     estSemainePremier = type de semaine && vetPourRole(attr, 'premier') === vetId
//     estSemaineSecond  = type de semaine && vetPourRole(attr, 'second')  === vetId
//
// Un vétérinaire en 3ᵉ ou 4ᵉ place n'incrémentait donc AUCUN compteur : ces
// gardes-là étaient gratuites pour l'équité, et le moteur n'avait aucune raison
// de les répartir. Le scoring des candidats aggravait le tout — la 3ᵉ place
// tombait dans la branche du 2nd, donc tous les candidats y avaient le même
// coût, quel que soit le nombre de renforts déjà assurés.
//
// Le week-end et les fériés n'ont jamais eu ce trou : `estWEGarde` et
// `estFerieGarde` comptent « qui est de garde », sans regarder la place.
//
// Ce que ces tests gâtent :
//   • le compteur existe et compte par POSITION (pas par nom de rôle) ;
//   • sur un vrai planning à 3 places, les renforts sont RÉPARTIS ;
//   • un cabinet à 2 places n'est pas affecté (compteur nul partout).
// ============================================================

import { describe, it, expect } from 'vitest'
import { compterParVet, desequilibreSemaineRenfort } from '@/engine/rules/optimization'
import { DEFAULT_EQUITY_WEIGHTS } from '@/engine/equity-weights'
import { genererPlanningPur } from '@/engine/solver'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import type { CreneauModele } from '@/engine/creneau-modele'
import type { AttributionGarde, VetEngine, VetEngineNormalise } from '@/engine/types'

function vetBrut(id: string): VetEngine {
  return {
    id,
    nom: id,
    prenom: id,
    statut: 'salarie',
    dernier_recours: false,
    contraintes: [],
    conges: [],
  } as VetEngine
}

function vet(id: string): VetEngineNormalise {
  return normaliserContraintesVets([vetBrut(id)])[0]
}

/** Un créneau de semaine à `nbPlaces` places, du lundi au jeudi. */
function catalogue(nbPlaces: number): CreneauModele[] {
  const roles = ['premier', 'second', 'troisieme', 'quatrieme'].slice(0, nbPlaces)
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
      roles,
      actif: true,
      ordre: 1,
    },
  ]
}

describe('Le compteur de renfort compte par POSITION', () => {
  const vets = ['a', 'b', 'c'].map(vetBrut)

  it('la 3ᵉ place est comptée, quel que soit le nom donné à ce rôle', () => {
    // Le cabinet a renommé sa troisième place « astreinte » : le compteur ne
    // doit pas s'appuyer sur le mot.
    const attr: AttributionGarde = {
      date: '2026-07-07',
      type: 'semaine_soir',
      placements: [
        { role: 'premier', vetId: 'a' },
        { role: 'second', vetId: 'b' },
        { role: 'astreinte', vetId: 'c' },
      ],
    }
    const compteurs = compterParVet({ attributions: [attr] }, vets)
    const parId = new Map(compteurs.map((c) => [c.vetId, c]))

    expect(parId.get('a')!.semainePremier).toBe(1)
    expect(parId.get('a')!.semaineRenfort).toBe(0)
    expect(parId.get('b')!.semaineSecond).toBe(1)
    expect(parId.get('b')!.semaineRenfort).toBe(0)
    // c est 3ᵉ : c'est LUI le renfort, et il ne doit compter nulle part ailleurs.
    expect(parId.get('c')!.semaineRenfort).toBe(1)
    expect(parId.get('c')!.semainePremier).toBe(0)
    expect(parId.get('c')!.semaineSecond).toBe(0)
  })

  it('un cabinet à 2 places laisse le compteur à zéro partout', () => {
    const attr: AttributionGarde = {
      date: '2026-07-07',
      type: 'semaine_soir',
      placements: [
        { role: 'premier', vetId: 'a' },
        { role: 'second', vetId: 'b' },
      ],
    }
    const compteurs = compterParVet({ attributions: [attr] }, vets)
    expect(compteurs.every((c) => c.semaineRenfort === 0)).toBe(true)
    // Et donc aucun déséquilibre : c'est ce qui rend la dimension inoffensive
    // pour les plannings existants.
    expect(desequilibreSemaineRenfort(compteurs)).toBe(0)
  })
})

describe('Sur un vrai planning à 3 places, les renforts sont RÉPARTIS', () => {
  const vets = ['a', 'b', 'c', 'd', 'e', 'f'].map(vet)

  /** Combien de gardes de renfort chacun assure, sur 4 semaines à 3 places. */
  function renfortsParVet(poidsRenfort: number): number[] {
    const res = genererPlanningPur({
      dateDebut: '2026-07-06',
      dateFin: '2026-07-31', // 4 semaines : assez pour que l'équité ait prise
      saison: 'ete',
      vets,
      bonusMalus: {},
      lnsTimeoutMs: 0,
      creneaux: catalogue(3),
      nbVetosSemaineSoir: 3,
      equityWeights: { ...DEFAULT_EQUITY_WEIGHTS, SEMAINE_RENFORT: poidsRenfort },
    })
    expect(res.success).toBe(true)
    if (!res.success) return []
    return compterParVet(res.planning, vets).map((c) => c.semaineRenfort)
  }

  const ecart = (n: number[]) => Math.max(...n) - Math.min(...n)

  it('les renforts se répartissent : écart de 1 garde au plus', () => {
    const renforts = renfortsParVet(DEFAULT_EQUITY_WEIGHTS.SEMAINE_RENFORT)
    expect(renforts.reduce((s, n) => s + n, 0)).toBeGreaterThan(0)
    expect(ecart(renforts)).toBeLessThanOrEqual(1)
  })

  it('à poids nul (l’ancien comportement), la répartition s’effondre', () => {
    // La preuve que ce chantier servait à quelque chose. Poids 0 = la
    // dimension n'existe pas, exactement la situation d'avant : mesuré le
    // 2026-08-01, un vétérinaire ramassait 10 gardes de renfort pendant que
    // quatre n'en assuraient aucune.
    const sansEquite = renfortsParVet(0)
    const avecEquite = renfortsParVet(DEFAULT_EQUITY_WEIGHTS.SEMAINE_RENFORT)
    expect(ecart(sansEquite)).toBeGreaterThan(ecart(avecEquite))
    expect(ecart(sansEquite)).toBeGreaterThanOrEqual(5)
  })
})
