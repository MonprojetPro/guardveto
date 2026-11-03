// ============================================================
// B-179e — la raison qui écarte UNE personne, pas celles de toute l'équipe.
// ============================================================
// Le 03/11, Fanny prend une place vide et lit : « Le moteur ne vous aurait pas
// placé ici (Anne-Sophie ne fait pas de garde le jeudi…, Victor…, Antoine…) ».
// Le diagnostic global agrège les règles de TOUS les vétos ; ici on vérifie que
// la raison renvoyée est bien la SIENNE, et qu'elle se lit en français.
// ============================================================

import { describe, expect, it } from 'vitest'
import { proposerReparation } from '../reparer'
import { libelleRaisonVet } from '../../diagnostic'
import type { VetEngine } from '../../types'
import { DEFAULT_STRUCTURE_CONFIG } from '../../structure-config'

const MERCREDI = '2025-11-05'

const reposMercredi = (id: string) => ({
  id,
  type: 'jour_repos_fixe' as const,
  actif: true,
  config: { axes: { quand: 'mercredi' }, force: 2, brique: 'interdire_creneau', params: { jour: 'mercredi' } },
})

function vet(id: string, prenom: string, over: Partial<VetEngine> = {}): VetEngine {
  return { id, nom: prenom.toUpperCase(), prenom, statut: 'associe', dernier_recours: false, contraintes: [], conges: [], ...over }
}

// Tout le monde est écarté du mercredi : Fanny par SON repos, Victor par le sien.
const vets = [
  vet('F', 'Fanny', { contraintes: [reposMercredi('c-f')] as VetEngine['contraintes'] }),
  vet('V', 'Victor', { contraintes: [reposMercredi('c-v')] as VetEngine['contraintes'] }),
]

function prendre(expliquerPour?: string) {
  return proposerReparation({
    creneau: { date: MERCREDI, type: 'semaine_soir', role: 'premier', saison: 'ete', besoinSecond: false },
    absentId: '',
    vets,
    planningComplet: [],
    structure: DEFAULT_STRUCTURE_CONFIG,
    expliquerPour,
  })
}

describe('proposerReparation — expliquerPour (B-179e)', () => {
  it('renvoie la raison BRUTE qui écarte la personne demandée', () => {
    const res = prendre('F')
    expect(res.candidats).toEqual([])
    expect(res.raisonPour).toMatch(/^R1/)
  })

  it('ne renvoie rien si on ne demande rien (comportement d’avant inchangé)', () => {
    expect(prendre().raisonPour).toBeUndefined()
  })

  it('la raison se lit au nom de la personne, jamais d’un collègue', () => {
    const res = prendre('F')
    const libelle = libelleRaisonVet(res.raisonPour!, vets[0], vets)
    expect(libelle).toMatch(/^Fanny /)
    expect(libelle).not.toMatch(/Victor/)
    // Alors que le diagnostic global, lui, cite aussi Victor : c'est le défaut.
    expect(res.diagnostic!.reglesEnCause.map((r) => r.libelle).join(' ')).toMatch(/Victor/)
  })

  it('une raison sans code lisible donne null (l’appelant dit une phrase générique)', () => {
    expect(libelleRaisonVet('raison inconnue', vets[0], vets)).toBeNull()
    expect(libelleRaisonVet('R17 effectif', vets[0], vets)).toBeNull()
  })
})
