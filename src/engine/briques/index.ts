// ============================================================
// GUARDVETO — Point d'entrée du module briques
// Story : F4-001 — Normaliser le schéma config des contraintes
// ============================================================

export {
  type ConfigBrique,
  type ConfigBriqueV2,
  type ConfigBriqueLegacy,
  type Etage,
  type AxesBrique,
} from './types'

/**
 * Valide qu'un config_json est au format V2 normalisé (grammaire 6-axes).
 *
 * Aucune dépendance Supabase — utilisable côté engine pur et dans les tests.
 *
 * Règles vérifiées :
 * - `brique` : string non vide
 * - `axes`   : object non-null (les sous-champs sont tous optionnels)
 * - `force`  : entier dans [0, 6]
 * - `params` : object non-null
 */
export function validerConfigBrique(config: unknown): config is import('./types').ConfigBriqueV2 {
  if (!config || typeof config !== 'object') return false
  const c = config as Record<string, unknown>

  if (typeof c.brique !== 'string' || c.brique.trim() === '') return false
  if (typeof c.axes !== 'object' || c.axes === null) return false
  if (
    typeof c.force !== 'number' ||
    c.force < 0 ||
    c.force > 6 ||
    !Number.isInteger(c.force)
  ) return false
  if (typeof c.params !== 'object' || c.params === null) return false

  return true
}
