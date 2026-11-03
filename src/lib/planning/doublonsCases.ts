// ============================================================
// GUARDVETO — Une place vide ne se dit qu'une fois (B-180, 03/11)
// ============================================================
// À la publication, deux juges voient la même place vide :
//   • `casesAPourvoir` — « 3 gardes n'ont encore personne » ;
//   • `validerPlanning` — sa règle de COUVERTURE (« Aucun 1er de garde »,
//     R18 « garde semaine sans 2nd », R19 « week-end sans 2nd », place libre).
// La fenêtre affichait les deux : MiKL, 03/11, « tu répètes 2 fois les mêmes
// infos ». On garde l'encadré des places vides (il dit quoi faire) et on retire
// la violation qui redit EXACTEMENT la même chose — même date, même rôle.
//
// ⚠️ On ne retire RIEN d'autre : une violation de couverture sans case vide en
//    face (les deux juges en désaccord) reste affichée. C'est précisément le
//    genre d'écart qu'il ne faut pas faire taire.
// ============================================================

/** Les règles qui ne font que constater une place non pourvue. */
const REGLES_DE_COUVERTURE = new Set(['COUVERTURE', 'R18', 'R19'])

export function sansDoublonDesCases<V extends { regle: string; date: string; role?: string }>(
  violations: readonly V[],
  cases: readonly { date: string; role: string }[],
): V[] {
  if (cases.length === 0) return [...violations]
  const vides = new Set(cases.map((c) => `${c.date}|${c.role}`))
  return violations.filter(
    (v) => !(REGLES_DE_COUVERTURE.has(v.regle) && v.role && vides.has(`${v.date}|${v.role}`)),
  )
}
