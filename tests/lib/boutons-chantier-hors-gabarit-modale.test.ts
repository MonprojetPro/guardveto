// ============================================================
// GUARDVETO — Une feuille partagee ne doit pas redessiner les boutons du
//             chantier (B-165f)
// ============================================================
// MiKL, 16/10 : « les pastilles d'action sont tjrs mauvaises, on voit pas ce
// que c'est ? ». TROISIEME retour d'affilee sur les memes boutons.
//
// 🔦 CAUSE RACINE, MESUREE. `v2-terrier.css` porte :
//
//   [data-slot="dialog-content"] button:not(…)… {
//     min-height: 40px; padding: 9px 18px; font-size: 0.82rem;
//   }
//
// Specificite ~ (0,8,1), contre (0,1,0) pour une classe simple comme
// `.jdb-pastille`. Un bouton-icone de 24 px devenait donc **40 px de haut avec
// 18 px de padding lateral** : l'icone etait chassee hors de sa boite, et le
// bouton s'affichait comme un ROND GRIS VIDE.
//
// 🔑 ET C'EST CE QUI A PRODUIT LES TROIS ALLERS-RETOURS. A chaque recette je
//    redessinais le bouton — libelle large, puis icone nue, puis pastille — et
//    A CHAQUE FOIS cette regle le reprenait. Le dessin n'etait pas en cause :
//    il n'arrivait simplement jamais jusqu'a l'ecran.
//
// ⚠️ ET MON PREMIER DIAGNOSTIC ETAIT FAUX. J'avais conclu « les `<svg>` n'ont
//    pas leurs attributs inline » en comparant avec l'icone de la loupe, qui,
//    elle, s'affiche. Le contre-exemple etait DANS LA MEME CAPTURE : le bouton
//    « Ajouter », meme declaration de `<svg>`, affichait bien son `+`. **Une
//    comparaison qui confirme n'est pas une preuve tant qu'on n'a pas cherche
//    le contre-exemple.**
//
// ── CE QUE CE TEST GARDE ────────────────────────────────────────────────────
//
// Que les deux regles de gabarit de `v2-terrier.css` continuent d'exclure les
// boutons du tableau de bord. Si quelqu'un retire l'exclusion, ou ajoute une
// troisieme regle de gabarit sans elle, les boutons se deformeront a nouveau —
// **sans que rien ne casse, sans qu'aucun test ne rougisse**, et il faudra
// trois recettes pour s'en apercevoir.
//
// ⚠️ CE QU'IL NE PEUT PAS FAIRE : juger le rendu. Il verifie une exclusion,
//    pas une apparence. C'est deja ce qui manquait.
// ============================================================

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const TERRIER = join(process.cwd(), 'src', 'styles', 'v2-terrier.css')

/**
 * Les SELECTEURS INDIVIDUELS qui imposent un gabarit a un bouton de modale.
 *
 * 🔴 DECOUPES PAR LA VIRGULE, ET C'EST TOUT L'INTERET. La premiere version de
 *    ce test lisait le selecteur ENTIER d'une regle — donc les deux variantes
 *    (`dialog-content` et `alert-dialog-content`) d'un coup. La contre-epreuve
 *    l'a pris en flagrant delit : en retirant l'exclusion sur UNE des deux, le
 *    test restait VERT, parce que l'autre la portait encore.
 *
 * 🔑 Un gardien qui ne peut pas echouer est pire qu'aucun gardien : il donne
 *    la paix. **Toujours executer la contre-epreuve.**
 */
function selecteursDeGabarit(): string[] {
  const css = readFileSync(TERRIER, 'utf8')
  const out: string[] = []
  for (const [, sel, corps] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Une regle de gabarit impose une TAILLE ou une FORME.
    if (!/(min-height|padding|border-radius|font-size)\s*:/.test(corps)) continue
    for (const part of sel.split(',')) {
      if (!/\[data-slot="(alert-)?dialog-content"\][\s\S]*\bbutton\b/.test(part)) continue
      out.push(part.replace(/\s+/g, ' ').trim())
    }
  }
  return out
}

describe('🔦 Les boutons du chantier echappent au gabarit des modales', () => {
  it('la sonde trouve bien les selecteurs qu’elle est censee surveiller', () => {
    // Sans ceci, le test suivant passerait tout seul le jour ou le selecteur
    // change de forme — un gardien qui ne trouve plus rien est un gardien vert
    // qui ne garde rien (defaut paye le 14/10).
    expect(selecteursDeGabarit().length).toBeGreaterThanOrEqual(4)
  })

  it('⛔ CHACUN exclut les boutons `jdb-` du tableau de bord journalier', () => {
    const sansExclusion = selecteursDeGabarit()
      .filter((s) => !/:not\(\[class\*="jdb-"\]\)/.test(s))
      .map((s) => s.slice(0, 120))

    expect(
      sansExclusion,
      'Cette regle impose min-height / padding / border-radius a TOUT bouton de\n' +
        'modale, avec une specificite qu’une classe simple ne peut pas reprendre.\n' +
        'Sans `:not([class*="jdb-"])`, les boutons-icones du tableau de bord\n' +
        'journalier redeviennent des ronds de 40 px dont l’icone sort de la boite\n' +
        '(B-165f, trois recettes perdues dessus).',
    ).toEqual([])
  })
})
