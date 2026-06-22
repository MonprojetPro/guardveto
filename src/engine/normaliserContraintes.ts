// ============================================================
// GUARDVETO — Normalisation des contraintes à l'entrée du moteur
// ============================================================
// CORRECTIF CŒUR MOTEUR (2026-06-19). Bug historique : la grammaire V2
// (F4-002) range les paramètres d'une règle sous `config.params`
// ({ axes, force, brique, params }), mais les contrôles du moteur
// (hard-constraints.ts) ET le validateur indépendant (validerPlanning.ts)
// lisent ces champs À LA RACINE de config (cfg.jour, cfg.semaines,
// cfg.si_garde_we…). Résultat : SEUL le duo interdit (qui lit `params`)
// était appliqué ; tous les repos (fixe, conditionnel, cyclique) étaient
// IGNORÉS — sans que les tests le voient (solver + validateur aveugles du
// même côté → « 0 violation » trompeur).
//
// PARADE (point unique, sûr) : on HISSE `config.params.*` au niveau racine
// de config, à l'entrée du moteur (genererPlanningPur) ET du validateur
// (validerPlanning). Ainsi TOUS les lecteurs — présents et futurs —
// trouvent la valeur, que la règle soit au format V1 (plat) ou V2 (params).
//
// Non destructif : les clés STRUCTURELLES (axes/force/brique/params) ne sont
// jamais écrasées. Idempotent : re-normaliser une config déjà plate ne change
// rien.
// ============================================================

import type { VetEngine, VetEngineNormalise, ContrainteEngine } from './types'

/**
 * Hisse `config.params.*` à la racine de `config`, sans écraser les clés déjà
 * présentes à la racine (axes, force, brique, params, et tout champ V1 plat).
 */
export function normaliserConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (!config || typeof config !== 'object') return config
  const params = (config as Record<string, unknown>).params
  if (!params || typeof params !== 'object' || Array.isArray(params)) return config
  // params d'abord (valeurs hissées), config ensuite (la racine gagne →
  // les clés structurelles et tout champ V1 plat sont préservés).
  return { ...(params as Record<string, unknown>), ...config }
}

/**
 * Renvoie une COPIE des vétos dont chaque contrainte a une config normalisée.
 * Immutable : n'altère pas les objets d'entrée (respect du contrat de pureté).
 */
export function normaliserContraintesVets(vets: VetEngine[]): VetEngineNormalise[] {
  return vets.map((v) => ({
    ...v,
    contraintes: v.contraintes.map((c): ContrainteEngine => ({
      ...c,
      config: normaliserConfig(c.config as Record<string, unknown>),
    })),
  })) as VetEngineNormalise[]
}
