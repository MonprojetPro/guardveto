// ============================================================
// GUARDVETO — Le socle « couleur »
// ============================================================
// Depuis le 2026-08-24, la couleur d'un vétérinaire n'est plus choisie dans
// une liste fermée de quatorze teintes : l'admin la compose librement, ou colle
// le code exact de son agenda Google. N'IMPORTE QUELLE valeur hexadécimale peut
// donc arriver en base — y compris un jaune très clair ou un bleu très sombre.
//
// Deux conséquences, et ce fichier existe pour les deux :
//
// 1. LA LISIBILITÉ N'EST PLUS ACQUISE. Les quatorze teintes du terrier étaient
//    toutes moyennement sombres : un texte blanc par-dessus passait partout, et
//    vingt endroits du code écrivaient `color: #fff` en dur. Sur un jaune clair,
//    ce blanc devient invisible. `encreLisible()` calcule l'encre à partir de la
//    couleur, au lieu de la supposer.
//
// 2. LA SAISIE N'EST PLUS SÛRE. Une palette ne se trompe pas ; un champ de
//    texte, si. `normaliserHex()` est le seul point d'entrée : il accepte ce
//    qu'un humain colle réellement (avec ou sans `#`, en trois ou six chiffres,
//    dans n'importe quelle casse) et refuse le reste, plutôt que de laisser une
//    chaîne bancale atteindre la base.
//
// Le reste (RVB ↔ TSV) sert au sélecteur : le rectangle en dégradé et la barre
// de teinte raisonnent en TSV, la base et le CSS en hexadécimal.
// ============================================================

import type { CSSProperties } from 'react'

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Teinte 0-360, saturation 0-1, valeur 0-1. */
export interface Tsv {
  t: number
  s: number
  v: number
}

/** La couleur de repli, celle de la migration 001 : un gris neutre. */
export const COULEUR_DEFAUT = '#6B7280'

/**
 * L'encre sombre. Pas `#000` : sur une pastille de 30 px, un noir pur fait une
 * tache dure. Ce gris très foncé porte le même contraste à l'œil sans le coup
 * de burin.
 */
const ENCRE_SOMBRE = '#1F2937'
const ENCRE_CLAIRE = '#FFFFFF'

/**
 * Remet une saisie humaine dans la seule forme que la base connaît : `#RRGGBB`
 * en majuscules.
 *
 * Accepte : `#CF9E64`, `cf9e64`, `  #CF9E64  `, `#abc` (forme courte, chaque
 * chiffre doublé comme le fait le CSS).
 * Refuse tout le reste — et refuser veut dire `null`, pas « une couleur au
 * hasard » : c'est à l'appelant de garder la dernière valeur valide.
 */
export function normaliserHex(saisie: string | null | undefined): string | null {
  if (typeof saisie !== 'string') return null
  const brut = saisie.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(brut)) {
    const [a, b, c] = brut
    return `#${a}${a}${b}${b}${c}${c}`.toUpperCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(brut)) return `#${brut}`.toUpperCase()
  return null
}

/** Vrai si la chaîne peut être stockée comme couleur. Le portier des actions. */
export function hexValide(saisie: string | null | undefined): boolean {
  return normaliserHex(saisie) !== null
}

export function hexVersRgb(hex: string): Rgb {
  const n = normaliserHex(hex) ?? COULEUR_DEFAUT
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  }
}

export function rgbVersHex({ r, g, b }: Rgb): string {
  const morceau = (x: number) =>
    Math.round(Math.min(255, Math.max(0, x)))
      .toString(16)
      .padStart(2, '0')
  return `#${morceau(r)}${morceau(g)}${morceau(b)}`.toUpperCase()
}

export function rgbVersTsv({ r, g, b }: Rgb): Tsv {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min

  let t = 0
  if (d !== 0) {
    if (max === rn) t = ((gn - bn) / d) % 6
    else if (max === gn) t = (bn - rn) / d + 2
    else t = (rn - gn) / d + 4
    t *= 60
    if (t < 0) t += 360
  }
  return { t, s: max === 0 ? 0 : d / max, v: max }
}

export function tsvVersRgb({ t, s, v }: Tsv): Rgb {
  const teinte = ((t % 360) + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs(((teinte / 60) % 2) - 1))
  const m = v - c
  let rp = 0
  let gp = 0
  let bp = 0
  if (teinte < 60) [rp, gp, bp] = [c, x, 0]
  else if (teinte < 120) [rp, gp, bp] = [x, c, 0]
  else if (teinte < 180) [rp, gp, bp] = [0, c, x]
  else if (teinte < 240) [rp, gp, bp] = [0, x, c]
  else if (teinte < 300) [rp, gp, bp] = [x, 0, c]
  else [rp, gp, bp] = [c, 0, x]
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  }
}

export function hexVersTsv(hex: string): Tsv {
  return rgbVersTsv(hexVersRgb(hex))
}

export function tsvVersHex(tsv: Tsv): string {
  return rgbVersHex(tsvVersRgb(tsv))
}

/**
 * La luminance relative au sens WCAG 2.1 — pas la moyenne des trois canaux.
 * L'œil ne pèse pas les couleurs à parts égales : le vert compte pour presque
 * les trois quarts de la clarté perçue, le bleu pour moins d'un quinzième. Un
 * bleu franc et un vert franc ont beau afficher la même « valeur » en TSV, l'un
 * réclame un texte blanc et l'autre un texte sombre.
 */
export function luminanceRelative(hex: string): number {
  const { r, g, b } = hexVersRgb(hex)
  const canal = (c: number) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

/** Le rapport de contraste WCAG entre deux couleurs. De 1 (identiques) à 21. */
export function rapportContraste(a: string, b: string): number {
  const la = luminanceRelative(a)
  const lb = luminanceRelative(b)
  const clair = Math.max(la, lb)
  const sombre = Math.min(la, lb)
  return (clair + 0.05) / (sombre + 0.05)
}

/**
 * L'encre à poser SUR cette couleur : blanche ou gris très foncé, celle des
 * deux qui se lit le mieux.
 *
 * C'est la fonction qui remplace les vingt `color: #fff` écrits en dur du temps
 * où la palette était fermée.
 */
export function encreLisible(fond: string | null | undefined): string {
  const hex = normaliserHex(fond) ?? COULEUR_DEFAUT
  // Le blanc GARDE la main tant qu'il est lisible ; le sombre ne prend le
  // relais que là où le blanc ne tient plus.
  //
  // La première version prenait bêtement « celui des deux qui contraste le
  // plus ». Mesuré sur les quatorze teintes déjà en base, ce choix faisait
  // basculer l'ambre (#B5761A) vers l'encre sombre pour trois pour cent de
  // contraste en plus — 3,89 contre 3,77. Une fiche existante aurait changé
  // d'aspect sans que personne y gagne rien, et l'ambre se serait mis à
  // détonner au milieu de treize pastilles à texte blanc.
  //
  // Le seuil est celui du WCAG pour les grands caractères (3:1). Il ne laisse
  // aucun trou : au point où les deux encres s'équivalent, elles valent 3,66
  // toutes les deux — il n'existe donc pas de couleur où les deux échouent.
  return rapportContraste(hex, ENCRE_CLAIRE) >= 3 ? ENCRE_CLAIRE : ENCRE_SOMBRE
}

/**
 * Le style complet d'une pastille qui porte du texte : le fond ET son encre,
 * d'un seul geste.
 *
 * `--encre` sert les feuilles de style qui posaient `color: #fff` en dur : elles
 * lisent maintenant `var(--encre, #fff)`, donc elles suivent sans que chaque
 * composant ait à répéter la couleur du texte.
 */
/**
 * `CSSProperties` ne connaît pas les variables CSS : React refuse un objet de
 * style composé UNIQUEMENT de `--c` ou `--encre`, faute d'y reconnaître une
 * seule propriété. C'est ce qui obligeait les composants du projet à écrire
 * `{ ['--c' as string]: … } as CSSProperties`.
 *
 * Ce type les déclare une fois pour toutes, au lieu d'un cast par appel. Il
 * étend `CSSProperties`, donc tout ce qui accepte un style continue de marcher
 * — et, contrairement au cast, il permet de RELIRE la variable (un test qui
 * vérifie le liseré, un composant qui compose deux styles).
 */
export type StyleAvecVariables = CSSProperties & Record<`--${string}`, string>

export function stylePastille(couleur: string | null | undefined): StyleAvecVariables {
  const fond = normaliserHex(couleur) ?? COULEUR_DEFAUT
  const encre = encreLisible(fond)
  return { background: fond, color: encre, '--encre': encre }
}

/**
 * La même chose, pour les feuilles de style qui prennent la couleur par la
 * variable `--c` plutôt que par `background` (`.vet-dot` des écrans Absences,
 * Échanges et Dépannages). Le fond y est posé par le CSS ; on ne fournit que
 * les deux variables.
 */
export function stylePastilleVar(couleur: string | null | undefined): StyleAvecVariables {
  const fond = normaliserHex(couleur) ?? COULEUR_DEFAUT
  return { '--c': fond, '--encre': encreLisible(fond) }
}

/**
 * Vrai quand la couleur est si claire qu'un point de quelques pixels se perdrait
 * sur le fond crème de l'application. Les pastilles muettes (les points de 9 px
 * du planning, les puces de légende) n'ont pas de texte à protéger, mais elles
 * disparaissent : elles se posent alors un liseré.
 *
 * Le seuil se mesure contre `--surface` du terrier (#FFFCF4), pas contre du
 * blanc pur : c'est le fond réel sur lequel ces points sont posés.
 */
const SURFACE_TERRIER = '#FFFCF4'

export function pastilleTropPale(couleur: string | null | undefined): boolean {
  const hex = normaliserHex(couleur) ?? COULEUR_DEFAUT
  // 1,25 est bas exprès. Ce liseré est un FILET pour les teintes quasi blanches
  // (#FFF3B0 tombe à 1,10 : le point devient un trou dans la page), pas une
  // retouche sur les teintes claires ordinaires. Un seuil de 1,6, essayé
  // d'abord, cernait le jaune clair (1,46) mais laissait nus l'orange (1,70) et
  // le rose (1,76) — trois teintes voisines, deux traitements : l'œil aurait
  // lu ça comme un bug, pas comme une aide.
  return rapportContraste(hex, SURFACE_TERRIER) < 1.25
}

/**
 * Le style d'un point de couleur SANS texte : le fond, plus un liseré quand la
 * teinte est trop pâle pour se détacher toute seule.
 */
export function stylePoint(couleur: string | null | undefined): CSSProperties {
  const fond = normaliserHex(couleur) ?? COULEUR_DEFAUT
  return { background: fond, boxShadow: LISERE_PALE(fond) }
}

/** Le liseré, ou son absence — la même décision, en une expression. */
const LISERE_PALE = (hex: string) =>
  pastilleTropPale(hex) ? 'inset 0 0 0 1px rgba(0,0,0,.28)' : 'none'

/**
 * La variante par variables, pour les points que le CSS peint via `--c`
 * (le filtre par véto sur Absences, la liste des dépannages).
 */
export function stylePointVar(couleur: string | null | undefined): StyleAvecVariables {
  const fond = normaliserHex(couleur) ?? COULEUR_DEFAUT
  return { '--c': fond, '--lisere': LISERE_PALE(fond) }
}
