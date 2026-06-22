// Fixtures — vétérinaires de test (basés sur les données réelles)
import type { VetEngine, VetEngineNormalise } from '@/engine/types'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'

// Les fixtures sont au format plat (déjà normalisé) ; on les fait passer par
// normaliserContraintesVets (idempotent) pour obtenir le type VetEngineNormalise
// exigé par les juges (isValid…). Reflète l'usage réel : on ne juge JAMAIS un
// véto non normalisé.
function n(v: VetEngine): VetEngineNormalise {
  return normaliserContraintesVets([v])[0]
}

export const ANNE_SOPHIE: VetEngineNormalise = n({
  id: '00000000-0000-0000-0000-000000000001',
  prenom: 'Anne-Sophie', nom: 'Cornu',
  statut: 'associe', dernier_recours: false,
  contraintes: [
    {
      id: 'c1', type: 'indisponibilite_cyclique', actif: true,
      config: { semaines: 'impaires', periodes: ['soir_semaine', 'weekend'] },
    },
    {
      id: 'c2', type: 'jour_repos_fixe', actif: true,
      config: { regles: [
        { jour: 'jeudi', periode: 'apres_midi', semaine: 'impaire' },
        { jour: 'lundi', periode: 'apres_midi', semaine: 'paire' },
        { jour: 'mercredi', periode: 'journee', semaine: 'paire' },
      ]},
    },
  ],
  conges: [],
})

export const FANNY: VetEngineNormalise = n({
  id: '00000000-0000-0000-0000-000000000002',
  prenom: 'Fanny', nom: 'Martin',
  statut: 'associe', dernier_recours: false,
  contraintes: [
    {
      id: 'c3', type: 'jour_repos_fixe', actif: true,
      config: { jour: 'mercredi', flexible_vacances: true },
    },
  ],
  conges: [],
})

export const JEAN: VetEngineNormalise = n({
  id: '00000000-0000-0000-0000-000000000003',
  prenom: 'Jean', nom: 'Dubois',
  statut: 'associe', dernier_recours: false,
  contraintes: [
    {
      id: 'c4', type: 'jour_repos_conditionnel', actif: true,
      config: { si_garde_we: 'mardi', sinon: 'vendredi' },
    },
  ],
  conges: [],
})

export const ANNE_CAT: VetEngineNormalise = n({
  id: '00000000-0000-0000-0000-000000000004',
  prenom: 'Anne-Cat', nom: 'Laurent',
  statut: 'associe', dernier_recours: true,
  contraintes: [],
  conges: [],
})

export const MANON: VetEngineNormalise = n({
  id: '00000000-0000-0000-0000-000000000005',
  prenom: 'Manon', nom: 'Petit',
  statut: 'salarie', dernier_recours: false,
  contraintes: [
    {
      id: 'c5', type: 'jour_repos_conditionnel', actif: true,
      config: { si_garde_we: 'jeudi', sinon: 'vendredi' },
    },
    {
      id: 'c6', type: 'duo_interdit', actif: true,
      config: { avec_veterinaire_id: '00000000-0000-0000-0000-000000000006' },
    },
  ],
  conges: [],
})

export const ANTOINE: VetEngineNormalise = n({
  id: '00000000-0000-0000-0000-000000000006',
  prenom: 'Antoine', nom: 'Bernard',
  statut: 'salarie', dernier_recours: false,
  contraintes: [
    {
      id: 'c7', type: 'jour_repos_conditionnel', actif: true,
      config: { si_garde_we: 'jeudi', sinon: 'vendredi' },
    },
    {
      id: 'c8', type: 'duo_interdit', actif: true,
      config: { avec_veterinaire_id: '00000000-0000-0000-0000-000000000005' },
    },
  ],
  conges: [],
})

export const VICTOR: VetEngineNormalise = n({
  id: '00000000-0000-0000-0000-000000000007',
  prenom: 'Victor', nom: 'Moreau',
  statut: 'salarie', dernier_recours: false,
  contraintes: [
    {
      id: 'c9', type: 'jour_repos_conditionnel', actif: true,
      config: { si_garde_we: 'jeudi', sinon: 'vendredi' },
    },
  ],
  conges: [],
})

export const ALL_VETS = [ANNE_SOPHIE, FANNY, JEAN, ANNE_CAT, MANON, ANTOINE, VICTOR]
