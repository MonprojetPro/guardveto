export type UsagePeriode = 'gardes' | 'journees' | 'les-deux'

/**
 * Deux périodes se chevauchent-elles VRAIMENT, ou coexistent-elles ? (B-162)
 *
 * `les-deux` touche tout — c'est le comportement d'avant cette colonne, celui
 * des 6 périodes existantes. Deux périodes du même usage spécifique
 * (`gardes`/`gardes` ou `journees`/`journees`) se disputent le même rôle.
 * `gardes` et `journees` ne se parlent pas : une période « journées » peut
 * courir sur l'année pendant que les périodes de gardes se succèdent par
 * blocs de quelques semaines à l'intérieur.
 */
export function usagesSeChevauchent(a: UsagePeriode, b: UsagePeriode): boolean {
  if (a === 'les-deux' || b === 'les-deux') return true
  return a === b
}
