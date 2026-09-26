// ============================================================
// Le NOM d'une période, une seule fois
// ============================================================
// Trouvé en posant le filtre de congés (B-131, 26/09) : cette même ligne était
// écrite à l'identique dans `PlanningV2.tsx`, `ParcoursGeneration.tsx` et
// `ImprimerPourSecretariat.tsx`. Trois copies d'une règle d'AFFICHAGE, donc
// trois occasions de renommer les périodes dans un écran et pas dans les
// autres — et un filtre qui ne proposerait pas les mêmes noms que le planning
// serait un filtre qu'on n'oserait pas utiliser.
//
// ⚠️ IL RESTE D'AUTRES FORMES DANS LE PRODUIT, et elles NE DISENT PAS LA MÊME
//    CHOSE — ce module ne les remplace pas, et ce n'est pas un oubli :
//      • `lib/ia/outils/planning.ts` → « Hiver P2 » (le NUMÉRO de période) ;
//      • `admin/periodes/actions.ts` → les deux formes, selon l'endroit ;
//      • `(v2)/historique` et `HistoriqueV2` → la saison seule, recomposée.
//    Les unifier changerait des libellés affichés un peu partout : c'est un
//    chantier à décider, pas un effet de bord à glisser dans un filtre. Signalé
//    à MiKL plutôt que tranché ici.
// ============================================================

import type { Periode } from '@/types'

/** Ce que le nom d'une période exige : son titre, sa saison, sa date de début. */
export type PeriodeNommable = Pick<Periode, 'libelle' | 'saison' | 'date_debut'>

/**
 * nomPeriode — « Hiver 2026 », « Été 2026 », ou le titre saisi par l'admin.
 *
 * Le titre libre gagne toujours : si le cabinet a nommé sa période, c'est ce
 * nom-là qu'il cherche à l'écran, pas celui qu'on aurait recomposé pour lui.
 *
 * L'année vient de `date_debut` et non de la date du jour : une période
 * d'hiver à cheval sur deux années garde le millésime de son commencement,
 * qui est celui sous lequel le cabinet en parle.
 */
export function nomPeriode(p: PeriodeNommable): string {
  return p.libelle ?? `${p.saison === 'ete' ? 'Été' : 'Hiver'} ${p.date_debut.slice(0, 4)}`
}
