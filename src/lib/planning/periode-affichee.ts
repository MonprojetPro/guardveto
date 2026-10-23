// ============================================================
// GUARDVETO — Quel planning le mois affiché désigne-t-il ? (B-172)
// ============================================================
// Avant B-172, la page prenait « la première période qui chevauche le mois ».
// Les périodes sont triées par date de début DÉCROISSANTE : depuis B-162, une
// période « journées seules » qui démarre au milieu d'un planning de gardes
// passait donc DEVANT lui. En novembre, l'écran affichait « Journées — 9 au
// 16 nov. » comme planning courant, et « Publier » refusait (aucune garde) —
// le planning de gardes du mois devenait inatteignable depuis la tête de page.
//
// LA RÈGLE, dans l'ordre :
//   ① le planning DEMANDÉ (paramètre `periode` de l'adresse), s'il chevauche
//      bien le mois — c'est le choix fait dans le menu des plannings ;
//   ② sinon, un planning qui porte des gardes ;
//   ③ sinon, n'importe quel planning qui chevauche le mois.
//
// ⚠️ Pour un cabinet sans période « journées », ② rend exactement ce que
//    rendait l'ancienne règle : rien ne change pour lui.
// ============================================================

import { periodePorteDesGardes, type UsagePeriode } from './usage-periode'

interface PeriodeBornee {
  id: string
  date_debut: string
  date_fin: string
  usage?: UsagePeriode
}

export function choisirPeriodeAffichee<T extends PeriodeBornee>(
  periodes: T[],
  debut: string,
  fin: string,
  demandee?: string | null,
): T | null {
  const duMois = periodes.filter((p) => p.date_debut <= fin && p.date_fin >= debut)
  if (demandee) {
    const choisie = duMois.find((p) => p.id === demandee)
    if (choisie) return choisie
  }
  return duMois.find((p) => periodePorteDesGardes(p.usage)) ?? duMois[0] ?? null
}
