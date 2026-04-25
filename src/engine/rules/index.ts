// ============================================================
// GUARDVETO — Agrégateur des règles du moteur
// ============================================================
// Point d'entrée unique pour toutes les règles :
//   - Contraintes dures  (hard-constraints)
//   - Contraintes souples (soft-constraints)
//   - Optimisation / équité (optimization)
// ============================================================

// Contraintes dures — validation binaire (valide / invalide)
export {
  isValid,
  checkR1JourReposFixe,
  checkR2IndispoCyclique,
  checkR3ReposConditionnel,
  checkR6DuoInterdit,
  checkR7DernierRecours,
  checkR8Inversion,
  checkR9VendrediLieWE,
  checkR16Conge,
  checkR17Ete,
  checkR18Hiver,
  checkR19Weekend,
} from './hard-constraints'

// Contraintes souples — score de pénalité (0 = parfait)
export { penalite, penaliteR10WEConsecutif, PENALITE } from './soft-constraints'

// Optimisation — compteurs et mesures de déséquilibre
export {
  compterParVet,
  variance,
  ecartMaxMin,
  desequilibreWE,
  desequilibreFeries,
  desequilibreSemainePremier,
  desequilibreSemaineSecond,
  desequilibreGrandsWeSalaries,
} from './optimization'
export type { CompteurVet } from './optimization'
