// ============================================================
// La marge des prénoms et les cases doivent partir du MÊME point
// ============================================================
// B-145c. Ce fichier existe à cause d'un défaut trouvé par MiKL en recette, le
// 07/10 : « pkoi en bas le 2nd ou 1er est pas en face des noms ? »
//
// CE QUI S'ÉTAIT PASSÉ. La grille dépliée pose une ligne par vétérinaire dans
// chaque case, et les prénoms correspondants dans une marge. Les deux colonnes
// sont sœurs d'une même grille CSS : elles ne s'alignent que si elles empilent
// les mêmes hauteurs À PARTIR DU MÊME POINT. Or la case portait deux choses que
// la marge n'avait pas :
//
//   • `padding: 6px`  → 6 px d'écart dès la première ligne
//   • `gap: 2px`      → +2 px PAR ligne, soit +12 px à la septième
//   • (et `border: 1px`, oubliée au premier correctif)
//
// Soit ~19 px à la ligne de Manon, pour des lignes de 19 px : une ligne entière
// de décalage. On lisait la garde du voisin, et rien ne le signalait.
//
// 🔑 LE POINT QUI COMPTE : J'AVAIS ÉCRIT LA RÈGLE DANS LE FICHIER.
//    Le commentaire disait « les deux colonnes empilent EXACTEMENT les mêmes
//    hauteurs ». C'était vrai des hauteurs de LIGNE, et faux du châssis. Une
//    règle écrite en commentaire n'est pas une règle appliquée — c'est très
//    exactement la leçon « penser à mettre à jour était déjà la consigne »,
//    celle qui a donné FILOU SUIT LE PRODUIT et LE TABLEAU NE PEUT PAS SE TAIRE.
//
// ⚠️ CE QUE CE TEST NE PEUT PAS FAIRE. Il lit du CSS, il ne mesure aucun pixel
//    rendu : aucun test ne monte un composant sur ce projet (B-144b). Il
//    empêche la RÉGRESSION CONNUE de revenir en silence — il ne remplace pas la
//    recette, qui reste le seul juge du rendu.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(
  join(__dirname, '..', '..', 'src', 'styles', 'v2-planning.css'),
  'utf8',
)

describe('Les deux colonnes partent du même point', () => {
  it('la case dépliée n’a PAS de gap — il s’accumulerait ligne après ligne', () => {
    // Le défaut exact : `gap: 2px` sur `.jour` ajoutait 2 px à chaque ligne,
    // donc un décalage croissant que les premières lignes ne laissaient pas
    // deviner. C'est pour ça qu'il s'est vu « en bas » et pas en haut.
    expect(css).toMatch(/\.sem\.depliee \.jour \{ gap: 0; \}/)
  })

  it('la marge reçoit le même padding que la case', () => {
    expect(css).toContain('--pad-case:')
    expect(css).toMatch(/\.sem\.depliee \.sem-marge \{[\s\S]{0,200}padding-top: var\(--pad-case\)/)
  })

  it('la marge reçoit aussi la bordure de la case', () => {
    // Oubliée au premier correctif : `.jour` porte `border: 1px solid transparent`.
    // Un pixel, invisible seul, qui remet le décalage.
    expect(css).toMatch(/\.sem\.depliee \.sem-marge \{[\s\S]{0,200}border-top: 1px solid transparent/)
  })

  it('les hauteurs de ligne sont des VARIABLES, écrites une seule fois', () => {
    // Si `--h-ligne` était recopiée en dur d'un côté, un jour l'une bougerait
    // sans l'autre — et le décalage reviendrait sans qu'aucun test ne bouge.
    expect(css).toContain('--h-ligne:')
    expect(css).toMatch(/\.sem-prenom \{[\s\S]{0,120}height: var\(--h-ligne\)/)
    expect(css).toMatch(/\.jd-rangee \{[\s\S]{0,120}height: var\(--h-ligne\)/)
    expect(css).toMatch(/\.sem-marge-pourvoir \{[\s\S]{0,120}height: var\(--h-ligne\)/)
    expect(css).toMatch(/\.jd-pourvoir \{[\s\S]{0,120}height: var\(--h-ligne\)/)
  })

  it('la marge et l’en-tête des jours suivent la MÊME largeur de colonne', () => {
    // Deux grilles qui se superposent doivent partager leur gabarit, sinon
    // l'en-tête « MER » se décale de sa colonne au premier changement.
    const gabarit = /grid-template-columns: var\(--w-marge\) repeat\(7, minmax\(0, 1fr\)\)/g
    expect((css.match(gabarit) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('Ce que MiKL doit pouvoir voir', () => {
  it('une barre de présence n’est plus à 18 % d’opacité', () => {
    // « on voit rien » (07/10). 18 % d'une couleur sur fond crème, ce n'est pas
    // une barre, c'est une nuance.
    const grille = readFileSync(
      join(__dirname, '..', '..', 'src', 'components', 'v2', 'GrilleSemaines.tsx'),
      'utf8',
    )
    expect(grille).not.toContain('}2E`')
    expect(grille).toContain('}4D`')
    // Le liseré de gauche marque le DÉBUT de la tranche : c'est lui qui donne
    // l'heure au premier coup d'œil.
    expect(css).toMatch(/\.jd-barre \{[\s\S]{0,200}inset 2px 0 0 currentColor/)
  })

  it('les pistes vides se voient — sinon la case paraît vide au lieu de libre', () => {
    expect(css).toMatch(/\.jd-piste \{ background: rgba\(/)
  })

  it('la marge est assez large pour « Anne-Catherine »', () => {
    // Un prénom tronqué sur une grille NOMINATIVE est exactement ce qu'elle
    // sert à éviter. 84 px (le prototype) rendait « Anne-Cathe ».
    const m = /--w-marge: (\d+)px/g
    const valeurs = [...css.matchAll(m)].map((x) => Number(x[1]))
    expect(valeurs.length).toBeGreaterThan(0)
    // La DERNIÈRE déclaration gagne en CSS : c'est elle qui s'applique.
    expect(valeurs[valeurs.length - 1]).toBeGreaterThanOrEqual(104)
  })
})
