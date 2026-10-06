// ============================================================
// Une pilule ne colle jamais son contenu à sa courbe
// ============================================================
// Exigence de MiKL, le 2026-10-06, capture à l'appui :
//   « toujours ce problème d'affichage, que ce soit les encarts ou les boutons
//     […] règle définitivement ce problème, j'en ai marre de revenir
//     systématiquement sur ce genre de détail. »
//
// Il a raison, et ce n'était pas un détail : à la mesure, **56 règles sur 97**
// portaient le défaut, dans 16 feuilles de style. Ce n'est pas une négligence
// répétée, c'est l'absence d'une règle commune — `border-radius: 999px` est
// redéclaré à la main dans chaque composant, avec un padding pensé comme pour
// un rectangle.
//
// ── POURQUOI UNE PILULE A BESOIN DE PLUS QU'UN RECTANGLE ────────────────────
//
// ⚠️ LA RAISON N'EST PAS GÉOMÉTRIQUE AU SENS STRICT, et il faut le dire ici
//    parce que c'est l'explication que j'ai d'abord écrite, et elle est FAUSSE.
//    On est tenté de raisonner « le rayon vaut la moitié de la hauteur, donc la
//    courbe mange cette largeur ». Elle ne la mange pas : au MILIEU de la
//    pilule — là où le texte est centré — le bord du cercle est à son extrême,
//    et n'empiète sur rien. Sur un bouton de 38px portant 16px de texte, la
//    courbe ne vole que ~1,8px. Une règle bâtie là-dessus serait dix fois trop
//    sévère, et on la désactiverait au premier écran serré.
//
// LA VRAIE RAISON EST VISUELLE. Un bord entièrement arrondi se lit comme plus
// proche qu'un bord droit : l'œil mesure la marge au point le plus étroit, pas
// au milieu. Un padding correct sur un rectangle paraît donc serré dès qu'on
// arrondit, et c'est très exactement ce que montre la capture du 06/10 — le rond
// du bouton radio semble toucher l'arrondi de sa pilule.
//
// ── LE SEUIL RETENU, ASSUMÉ COMME UN CHOIX DE DESIGN ────────────────────────
//
//   padding horizontal ≥ padding vertical + 8
//   et, quand une hauteur est déclarée, ≥ 40 % de cette hauteur
//
// Le second critère existe parce que `min-height` PRIME sur le padding : `.btn`
// déclare `padding: 9px 18px` ET `min-height: 38px`. Juger sur le seul padding
// serait aveugle à la moitié des boutons du projet.
//
// ⚠️ C'est un PLANCHER de lisibilité, pas une consigne esthétique. Au-dessus,
//    chacun fait ce qu'il veut. Les 40 % ne sortent d'aucune loi : c'est le
//    rapport qui, sur les boutons déjà jugés corrects de ce projet, les laisse
//    passer tout en attrapant ceux que MiKL a signalés.
//
// ── POURQUOI UN TEST ET PAS UNE CONSIGNE ────────────────────────────────────
//
// « Penser au padding des pilules » était déjà la consigne implicite, et elle a
// été oubliée 56 fois. Même raisonnement que les deux règles permanentes du
// projet (FILOU SUIT LE PRODUIT, LE TABLEAU NE PEUT PAS SE TAIRE) : une
// consigne déjà oubliée ne se répare pas en la réécrivant.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DOSSIER = join(process.cwd(), 'src', 'styles')

/**
 * Les CONTENEURS de segments : leur padding n'entoure pas du texte, c'est une
 * gouttière autour de boutons qui portent eux-mêmes un arrondi. Leur contenu
 * épouse donc la courbe au lieu de la heurter, et les élargir ne ferait que
 * grossir la barre.
 *
 * ⚠️ N'AJOUTER ICI QU'UN CONTENEUR DE BOUTONS. Une pilule qui contient un
 *    `input`, une pastille ou un texte n'en est pas un — elle a besoin de PLUS
 *    de padding, pas de moins. C'est l'erreur que le premier tri automatique a
 *    faite : il avait rangé `.tj-radio` ici, alors que c'est exactement la
 *    pilule que MiKL a prise en capture.
 */
const CONTENEURS_DE_BOUTONS: Record<string, string> = {
  '.tabs': 'Barre d’onglets : gouttière autour de boutons déjà arrondis.',
  '.segmente': 'Sélecteur segmenté : gouttière autour de boutons déjà arrondis.',
  '.seg': 'Sélecteur segmenté de l’historique : gouttière autour de boutons.',
  '.recap-seg': 'Sélecteur segmenté du récapitulatif : gouttière autour de boutons.',
  '.vet-filter': 'Filtre par vétérinaire : gouttière autour de boutons déjà arrondis.',
  // Au repos, l'entrée du dock est une ICÔNE seule dans une pastille de 56px :
  // son contenu est centré, il n'y a pas de texte à décoller du bord. Le libellé
  // n'apparaît qu'au survol, dans un volet qui se déplie à côté (`.di-flap`) et
  // qui porte son propre espacement. Appliquer les 40 % ici imposerait 23px de
  // padding autour d'une icône de 24px — la barre entière doublerait de largeur.
  '.dock-item': 'Pastille d’icône du dock : contenu centré, le libellé vit dans le volet dépliant.',
}

interface Regle {
  fichier: string
  selecteur: string
  padVertical: number
  padHorizontal: number
  /** `height` ou `min-height` déclarée, quand il y en a une. */
  hauteurDeclaree: number | null
}

/** Les règles qui dessinent une pilule ET déclarent un `padding` raccourci. */
function pilules(): Regle[] {
  const out: Regle[] = []
  for (const fichier of readdirSync(DOSSIER).filter((f) => f.endsWith('.css'))) {
    const texte = readFileSync(join(DOSSIER, fichier), 'utf8')
    for (const [, selBrut, corps] of texte.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/border-radius:\s*999px/.test(corps)) continue

      // ⚠️ LES TROIS ÉCRITURES, PAS SEULEMENT LE RACCOURCI. Ne lire que
      //    `padding:` laissait un trou béant dans la promesse « définitivement » :
      //    un composant déclarant `padding-inline` ou `padding-left` serait passé
      //    sous le radar, et le défaut serait revenu par cette porte — exactement
      //    ce que MiKL demande de ne plus avoir à signaler.
      const court = corps.match(/(?:^|[;\s])padding:\s*([^;]+)/)
      const inline = corps.match(/(?:^|[;\s])padding-inline:\s*([^;]+)/)
      const gauche = corps.match(/(?:^|[;\s])padding-left:\s*([\d.]+)px/)
      const droite = corps.match(/(?:^|[;\s])padding-right:\s*([\d.]+)px/)
      const bloc = corps.match(/(?:^|[;\s])padding-(?:block|top):\s*([\d.]+)px/)

      let padVertical: number | null = null
      let padHorizontal: number | null = null

      if (court) {
        const valeurs = court[1].trim().split(/\s+/).map((v) => Number.parseFloat(v))
        // On ne juge que les valeurs en nombres (px). Une valeur en `em`, en `%`
        // ou via une variable dépend du contexte : la refuser au jugé produirait
        // un faux positif, et un test qui crie à tort finit désactivé.
        if (valeurs.some((v) => Number.isNaN(v))) continue
        if (!/\d(px)?(\s|$)/.test(court[1])) continue
        padVertical = valeurs[0]
        padHorizontal = valeurs.length === 1 ? valeurs[0] : valeurs[1]
      }

      // Les formes longues écrasent le raccourci si elles le suivent — on les
      // applique donc après, comme la cascade le ferait.
      if (inline) {
        const v = Number.parseFloat(inline[1].trim().split(/\s+/)[0])
        if (!Number.isNaN(v)) padHorizontal = v
      }
      if (gauche) padHorizontal = Number.parseFloat(gauche[1])
      if (droite) {
        const d = Number.parseFloat(droite[1])
        // Le côté le plus serré décide : c'est lui qu'on voit.
        padHorizontal = padHorizontal === null ? d : Math.min(padHorizontal, d)
      }
      if (bloc) padVertical = Number.parseFloat(bloc[1])

      if (padHorizontal === null) continue
      // Sans padding vertical connu, on ne peut pas appliquer le premier
      // critère : on retombe sur 0, et seul celui de la hauteur jouera.
      if (padVertical === null) padVertical = 0
      // ⚠️ `min-height` PRIME SUR LE PADDING, et l'oublier a failli laisser
      //    passer le bouton même de la capture. `.btn` déclare
      //    `padding: 9px 18px` ET `min-height: 38px` : la hauteur réelle est 38,
      //    donc le rayon est 19 — pas 17 comme le padding seul le laisse croire.
      //    Une règle qui ne regarde que le padding est aveugle à la moitié des
      //    boutons du projet.
      const mh = corps.match(/(?:^|[;\s])(?:min-)?height:\s*([\d.]+)px/)
      out.push({
        fichier,
        selecteur: selBrut.trim().split('\n').pop()!.trim(),
        padVertical,
        padHorizontal,
        hauteurDeclaree: mh ? Number.parseFloat(mh[1]) : null,
      })
    }
  }
  return out
}

/**
 * Le plancher de lisibilité d'une pilule.
 *
 * Deux critères, dont le plus exigeant l'emporte :
 *   • `padding vertical + 8` — vaut pour toute pilule ;
 *   • `40 % de la hauteur` — quand une hauteur est déclarée, car elle prime
 *     alors sur le padding pour fixer la taille réelle.
 */
function minimumHorizontal(r: Pick<Regle, 'padVertical' | 'hauteurDeclaree'>): number {
  const parLePadding = r.padVertical + 8
  const parLaHauteur = r.hauteurDeclaree ? Math.ceil(r.hauteurDeclaree * 0.4) : 0
  return Math.max(parLePadding, parLaHauteur)
}

describe('Une pilule ne colle jamais son contenu à sa courbe', () => {
  // Sans ce garde-fou, une erreur de lecture des fichiers ferait passer le test
  // au vert en n'ayant rien analysé — le défaut même qu'il traque.
  it('le test ne passe pas à vide : les pilules sont bien trouvées', () => {
    const toutes = pilules()
    expect(toutes.length, 'aucune règle en pilule trouvée dans src/styles').toBeGreaterThan(40)
  })

  it('chaque pilule dégage sa courbe (padding horizontal ≥ vertical + 8)', () => {
    const fautives = pilules()
      .filter((r) => !(r.selecteur in CONTENEURS_DE_BOUTONS))
      .filter((r) => r.padHorizontal < minimumHorizontal(r))
      .map(
        (r) =>
          `${r.fichier} ${r.selecteur} : padding ${r.padVertical}px ${r.padHorizontal}px` +
          (r.hauteurDeclaree ? ` (hauteur ${r.hauteurDeclaree}px)` : '') +
          ` → il faut au moins ${minimumHorizontal(r)}px en horizontal`,
      )
      .sort()

    expect(
      fautives,
      'Ces pilules collent leur contenu à leur arrondi.\n\n' +
        'Sur un `border-radius: 999px`, le rayon vaut la moitié de la hauteur :\n' +
        'un contenu posé trop près du bord commence À L’INTÉRIEUR de la courbe.\n' +
        'C’est ce que MiKL a pris en capture le 06/10, et ce qu’il demande de ne\n' +
        'plus avoir à signaler.\n\n' +
        'Deux réponses possibles, jamais une troisième :\n' +
        '  • augmenter le padding horizontal à `padding vertical + 8` ;\n' +
        '  • si la place manque vraiment, RÉDUIRE LE RAYON (8px au lieu de 999px) —\n' +
        '    une pilule parfaite est un choix esthétique qui coûte de la largeur.\n\n' +
        'N’ajouter à CONTENEURS_DE_BOUTONS qu’un conteneur de boutons déjà\n' +
        'arrondis. Une pilule qui porte un texte, une pastille ou un input n’en\n' +
        'est pas un : elle a besoin de plus de padding, pas d’une dispense.\n\n' +
        fautives.join('\n'),
    ).toEqual([])
  })

  it('les dispenses déclarées existent encore, et sont bien des pilules', () => {
    // Une dispense qui désigne un sélecteur disparu est une ligne morte : elle
    // laisse croire qu'un cas est traité alors qu'il n'existe plus, et masque
    // le jour où un composant du même nom revient avec le défaut.
    const vus = new Set(pilules().map((r) => r.selecteur))
    const fantomes = Object.keys(CONTENEURS_DE_BOUTONS).filter((s) => !vus.has(s))
    expect(fantomes, 'dispenses qui ne correspondent à aucune pilule existante').toEqual([])
  })
})
