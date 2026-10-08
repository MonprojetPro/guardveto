// ============================================================
// GUARDVETO — Le temoin d'un chantier ouvert (lot 0 de B-153)
// ============================================================
// A QUOI IL SERT, ET POURQUOI IL EXISTE AVANT LA GRILLE.
//
// Le lot 0 livre la PORTE (`lib/produit/chantiers.ts`), pas encore ce qu'il y a
// derriere. Sans ce temoin, le lot serait invisible : MiKL n'aurait aucun moyen
// de verifier que la porte s'ouvre au bac a sable et reste fermee chez le
// client — il devrait me croire sur parole. C'est precisement ce que la regle
// PREUVE AVANT ANNONCE interdit.
//
// Il est donc une MESURE, pas une fonctionnalite : il affiche ce que la porte a
// decide, pour que la decision soit verifiable a l'œil.
//
// ⚠️ IL DISPARAIT AU LOT 1, remplace par la vraie grille. S'il est encore la
//    quand la grille l'est aussi, c'est qu'on a oublie de le retirer.
//
// ⚠️ CE N'EST PAS LUI QUI GARDE LA PORTE. Il ne teste rien : il est rendu, ou
//    il ne l'est pas. La decision vit chez son appelant, et le test-gardien
//    `chantier-restreint.test.ts` verifie que cet appelant la prend vraiment.
// ============================================================

import { CHANTIERS } from '@/lib/produit/chantiers'

export function TemoinChantier({ id }: { id: string }) {
  const chantier = CHANTIERS[id]
  if (!chantier) return null

  return (
    <div className="gv-temoin-chantier" role="status">
      <span className="gvtc-pastille">Chantier</span>
      <span className="gvtc-nom">{chantier.nom}</span>
      <span className="gvtc-detail">
        {chantier.item} · ouvert depuis le{' '}
        {chantier.depuis.split('-').reverse().join('/')} · visible ici parce que
        ce compte est un bac à sable
      </span>
    </div>
  )
}
