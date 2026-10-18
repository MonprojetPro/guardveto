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

/**
 * Cette période peut-elle porter des gardes ? (B-162)
 *
 * Une période `journees` pure n'a jamais de garde à attendre — elle ne doit
 * donc JAMAIS devenir le « planning courant » du dock (affiché sur tous les
 * écrans V2), ni apparaître dans Historique, qui liste des plannings de
 * gardes et leurs compteurs. `undefined` (objet construit avant la colonne —
 * fixture, test) se traite comme `les-deux`, le défaut en base.
 */
export function periodePorteDesGardes(usage: UsagePeriode | undefined): boolean {
  return usage !== 'journees'
}
