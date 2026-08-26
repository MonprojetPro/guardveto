/**
 * Les bornes de la vue planning — SOURCE UNIQUE.
 *
 * Deux bornes coexistent et ne font PAS le même travail :
 *
 * ① `bornesMois` — l'identité du mois consulté. Sert à savoir de quelle période
 *    relève l'écran et à décider quoi re-valider. Élargir ça ferait basculer
 *    l'affichage sur la période voisine dès qu'un mois l'effleure d'un jour.
 *
 * ② `bornesGrille` — ce qui est réellement DESSINÉ : la grille a toujours couvert
 *    des semaines pleines, du lundi de la semaine du 1er au dimanche de la
 *    semaine du dernier jour. Sert à charger ce qui remplit les cases (gardes,
 *    congés, souhaits).
 *
 * ⚠️ POURQUOI CE FICHIER EXISTE. Jusqu'au 2026-08-26, la grille était calculée
 * dans `components/v2/PlanningV2.tsx` et les données chargées sur le mois strict
 * dans `app/(v2)/planning/page.tsx`. Les deux ne se parlaient pas : les 1 à 6
 * cases de la semaine à cheval étaient dessinées, mais VIDES. Or une case vide
 * se lit « pas de garde ce jour-là », jamais « pas chargé » — même famille que
 * B-005 (le tableau ne peut pas se taire).
 *
 * Réunir les deux calculs ici ne corrige pas seulement l'écart du jour : il
 * rend le prochain impossible. Changer la forme de la grille (semaine partant
 * du dimanche, deux mois affichés) déplace désormais les deux en même temps.
 * Le garde-fou est `tests/lib/bornes-grille.test.ts`.
 */

/** Décale une date ISO de N jours (N peut être négatif). */
function decaler(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Position du jour dans la semaine, 0 = lundi. */
function indexJour(iso: string): number {
  return (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7
}

/** Premier et dernier jour du mois « AAAA-MM ». */
export function bornesMois(anneeMois: string): { debut: string; fin: string } {
  const [annee, mois] = anneeMois.split('-').map(Number)
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  const mm = String(mois).padStart(2, '0')
  return { debut: `${annee}-${mm}-01`, fin: `${annee}-${mm}-${String(dernier).padStart(2, '0')}` }
}

/** Premier et dernier jour RÉELLEMENT AFFICHÉS pour le mois « AAAA-MM ». */
export function bornesGrille(anneeMois: string): { debut: string; fin: string } {
  const { debut, fin } = bornesMois(anneeMois)
  return { debut: decaler(debut, -indexJour(debut)), fin: decaler(fin, 6 - indexJour(fin)) }
}

/** Les dates de la grille, dans l'ordre — toujours un multiple de 7. */
export function genererGrille(annee: number, mois: number): string[] {
  const { debut, fin } = bornesGrille(`${annee}-${String(mois).padStart(2, '0')}`)
  const cases: string[] = []
  for (let d = debut; d <= fin; d = decaler(d, 1)) cases.push(d)
  return cases
}
