// ============================================================
// L'alignement de la grille « Planning Cabinet V2 » (B-153 lot 1)
// ============================================================
// LE DEFAUT QUE CE TEST EMPECHE DE REVENIR — B-145c, paye le 07/10.
//
// MiKL, capture a l'appui : « visuellement ca marche pas, on voit rien », puis
// la question qui tranche : « pkoi en bas le 2nd ou 1er est pas en face des
// noms ? ». Les trois causes, mesurees dans le CSS de l'epoque :
//
//   ① la case portait `padding: 6px` que la marge n'avait pas → 6 px d'ecart
//      des la premiere ligne ;
//   ② la case portait `gap: 2px` que la marge n'avait pas → +2 px par ligne,
//      soit +12 px a la septieme ;
//   ③ total 18 px a la derniere ligne, pour des lignes de 20 px — presque une
//      ligne entiere, donc ON LISAIT LA GARDE DU VOISIN.
//
// 🔑 ET LA REGLE ETAIT DEJA ECRITE. Le commentaire du fichier disait « les deux
//    colonnes empilent EXACTEMENT les memes hauteurs ». C'etait vrai des
//    hauteurs de LIGNE, et faux du CHASSIS — le padding et la bordure n'en sont
//    pas. Une regle en commentaire n'est pas une regle appliquee : c'est la
//    lecon qui a donne FILOU SUIT LE PRODUIT, et c'est pour ca que ce fichier
//    existe au lieu d'un paragraphe de plus.
//
// CE QUE CE TEST NE PEUT PAS FAIRE : il LIT du CSS, il ne mesure aucun pixel
// rendu — aucun test de ce projet ne monte un composant (B-144b). Il empeche la
// regression CONNUE de revenir en silence. Il ne remplace pas la recette.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(
  join(__dirname, '..', '..', 'src', 'styles', 'chantier-planning-v2.css'),
  'utf8',
)

/** Le corps d'une regle CSS, par son selecteur exact. */
function regle(selecteur: string): string {
  const i = CSS.indexOf(selecteur + ' {')
  expect(i, `le selecteur « ${selecteur} » doit exister`).toBeGreaterThanOrEqual(0)
  return CSS.slice(i, CSS.indexOf('}', i))
}

describe('Le chassis est PARTAGE, jamais recopie', () => {
  it('declare le padding et la bordure UNE fois, en variables', () => {
    expect(CSS).toMatch(/--pv2-pad:\s*\d+px/)
    expect(CSS).toMatch(/--pv2-bord:\s*\d+px/)
  })

  it('🔴 la marge depliee et la case consomment les MEMES variables', () => {
    // Cause ① de B-145c. Si l'une des deux ecrit une valeur en dur, l'ecart
    // revient au premier changement de l'autre — et il ne se verra qu'en bas.
    const marge = regle('.pv2-marge.depliee')
    const jour = regle('.pv2-jour')
    for (const [nom, corps] of [['marge', marge], ['case', jour]] as const) {
      expect(corps, `${nom} : le padding doit venir de --pv2-pad`).toContain('var(--pv2-pad)')
      expect(corps, `${nom} : la bordure doit venir de --pv2-bord`).toContain('var(--pv2-bord)')
    }
  })

  it('🔴 la case garde une bordure TRANSPARENTE, pas aucune bordure', () => {
    // Elle n'est pas decorative : elle occupe 1 px. La retirer « puisqu'on ne
    // la voit pas » decalerait les cases d'un pixel par rapport a la marge.
    expect(regle('.pv2-jour')).toMatch(/border:\s*var\(--pv2-bord\)\s+solid\s+transparent/)
  })

  it('🔴 ni la marge ni la case n’ont de `gap` qui s’accumule', () => {
    // Cause ② de B-145c : le gap s'ajoutait a CHAQUE ligne, d'ou un defaut
    // invisible en haut et criant en bas. Les hauteurs portent l'espacement.
    expect(regle('.pv2-marge')).toMatch(/gap:\s*0\b/)
    expect(regle('.pv2-jour')).toMatch(/gap:\s*0\b/)
  })

  it('empile les memes hauteurs, declarees en variables', () => {
    for (const v of ['tete', 'titres', 'pourvoir', 'ligne', 'presents']) {
      expect(CSS, `--pv2-h-${v} doit exister`).toMatch(
        new RegExp(`--pv2-h-${v}:\\s*\\d+px`),
      )
    }
    // La marge et la case doivent lire CES variables, pas des nombres.
    expect(regle('.pv2-prenom')).toContain('var(--pv2-h-ligne)')
    expect(regle('.pv2-rangee')).toContain('var(--pv2-h-ligne)')
    expect(regle('.pv2-marge-espace')).toContain('var(--pv2-h-titres)')
    expect(regle('.pv2-titres')).toContain('var(--pv2-h-titres)')
  })

  it('partage le gabarit de colonnes entre l’en-tete et les semaines', () => {
    // Un en-tete qui ne suit pas la grille nomme le mauvais jour — et c'est
    // indetectable a l'œil tant qu'on ne compte pas les colonnes.
    const gabarit = 'grid-template-columns: var(--pv2-marge-l) repeat(7, minmax(0, 1fr))'
    expect(regle('.pv2-entete')).toContain(gabarit)
    expect(regle('.pv2-sem')).toContain(gabarit)
  })
})

describe('La lisibilite, telle que MiKL l’a exigee en recette', () => {
  it('🔴 les barres de presence ne retombent pas sous 30 % d’opacite', () => {
    // `2E` (18 %) avait ete juge invisible le 07/10. La teinte vit dans le
    // composant, pas dans le CSS : on verifie la constante a la source.
    const src = readFileSync(
      join(__dirname, '..', '..', 'src', 'components', 'chantier', 'GrilleSemainesV2.tsx'),
      'utf8',
    )
    const m = /\$\{couleur\}([0-9a-fA-F]{2})`/.exec(src)
    expect(m, 'la teinte des barres doit etre une constante lisible').not.toBeNull()
    const alpha = parseInt(m![1], 16) / 255
    expect(alpha, `opacite des barres : ${Math.round(alpha * 100)} %`).toBeGreaterThanOrEqual(0.3)
  })

  it('🔴 la marge reste assez large pour un prenom entier', () => {
    // 84px rendait « Anne-Cathe » et « Anne-Sophi » sur une grille dont tout le
    // propos est nominatif. Relevee a 112px en B-145c.
    const m = /--pv2-marge-l:\s*(\d+)px/.exec(CSS)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(112)
  })

  it('🔴 une piste vide porte un fond — sinon il n’y a aucun couloir a suivre', () => {
    // Autre retour du 07/10 : sans fond, une case libre se lit comme une case
    // vide, et l'œil n'a plus de ligne a suivre de gauche a droite.
    const piste = regle('.pv2-piste')
    expect(piste).toMatch(/background:\s*rgba\(/)
  })
})
