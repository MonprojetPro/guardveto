// ============================================================
// GUARDVETO — Le système de boutons « Relief » (B-206)
// ============================================================
// DEUX CHOSES QUE CE TEST EMPÊCHE.
//
// ① QUE LE DESSIN SORTE DE SA PORTE.
//    `styles/v2-boutons.css` est importée par la coquille V2, donc chargée par
//    TOUS les cabinets. Ce qui la retient, c'est que chacune de ses règles vit
//    dans le bloc `body:has(.v2[data-boutons="relief"])`, et que l'attribut
//    n'est posé que si la porte de chantier `boutons-relief` est ouverte. Une
//    seule règle écrite hors de ce bloc redessinerait les boutons du client
//    sans qu'aucune porte ne le sache — l'incident du 08/10 (B-151), par le
//    chemin que la porte ne couvre pas : un FICHIER PARTAGÉ.
//
// ② QU'UN BOUTON SOIT OUBLIÉ EN SILENCE.
//    MiKL, le 12/11 : « généralise ces boutons à l'ensemble du site… et
//    n'oublie rien ». L'inventaire comptait 458 boutons et une quarantaine de
//    dessins. « Penser à raccorder le prochain bouton » est exactement le
//    genre de consigne qui s'oublie (cf. FILOU SUIT LE PRODUIT). Donc :
//    chaque <button> de `src/` doit porter une classe RACCORDÉE dans la
//    feuille, ou figurer au registre HORS_SYSTEME avec sa raison. La seule
//    chose interdite est le silence.
//
// CE QU'IL NE PEUT PAS FAIRE : juger que le rendu est beau, ni qu'une règle
// l'emporte réellement sur celle qu'elle remplace (spécificité, ordre). Il ne
// voit pas non plus l'ANCÊTRE d'un bouton sans classe : pour ceux-là il compte,
// fichier par fichier, et un bouton de plus ou de moins l'oblige à être relu.
//
// Aucune connexion réseau : on lit les fichiers.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHANTIERS } from '../../src/lib/produit/chantiers'

const SRC = join(process.cwd(), 'src')
const STYLES = join(SRC, 'styles')
const FEUILLE = join(STYLES, 'v2-boutons.css')
const COQUILLE = join(SRC, 'app', '(v2)', 'layout.tsx')
/** Les pages d'avant la connexion : hors coquille V2, sans cabinet. */
const CONNEXION = [join(SRC, 'app', 'login', 'page.tsx'), join(SRC, 'app', 'set-password', 'page.tsx')]

/** Le seul sélecteur de premier niveau admis dans la feuille. */
export const LA_PORTE_CSS = 'body:has(.v2[data-boutons="relief"])'

/**
 * Les familles de boutons volontairement laissées HORS du système, et pourquoi.
 *
 * Une entrée = une décision. Retirer une entrée sans raccorder la famille fait
 * échouer le test ; y ajouter une famille demande d'écrire la raison.
 */
export const HORS_SYSTEME: Record<string, string> = {
  // — La grille du planning : décision MiKL du 12/11, on ne touche pas aux cases.
  'pv2-garde': 'case de la grille du planning',
  'pv2-jour-loupe': 'case de la grille du planning',
  'pv2-ligne': 'case de la grille du planning',
  'pv2-prenom': 'case de la grille du planning',
  'pv2-sem-lbl': 'case de la grille du planning',
  'pv2-trou': 'case de la grille du planning',
  'jour-presents': 'case de la grille du planning (ancien écran)',
  'cad-btn': 'cadenas posé sur une case de la grille',
  'fixer-ouvrir': 'cadenas posé sur une case de la grille',
  'fixer-vet': 'rangée de la liste du cadenas',
  // — Des cartes ou des rangées entières qu'on clique : ce ne sont pas des touches.
  'gen-carte': 'carte de choix cliquable',
  'gjc-carte': 'carte de choix cliquable',
  widget: 'fiche du tableau de bord cliquable',
  'rg-mrow': 'rangée du sommaire des réglages',
  'rg-nav': 'entrée du sommaire des réglages',
  'msg-conv': 'rangée de la liste des conversations',
  'cl-item': 'rangée de la liste des notifications',
  'pp-item': 'rangée de la liste des plannings',
  'pp-new': 'rangée « nouveau planning » en pointillés',
  'av-row': 'rangée de choix d’un vétérinaire',
  'cp-item': 'rangée de choix d’un périmètre d’absence',
  'gen-ligne': 'rangée de la liste des générations',
  'pv2h-menu-item': 'entrée du menu Outils',
  'pdf-menu-item': 'entrée du menu d’impression',
  'cnt-reglage-item': 'entrée du menu des compteurs',
  'ma-option-tete': 'en-tête dépliable d’une option d’agenda',
  'ppv-vet': 'rangée d’un vétérinaire dans le point de contrôle',
  'sup-type': 'carte de choix du type de demande',
  'bpl-sel': 'titre du planning, qui ouvre la liste',
  'pt-titre-mois': 'titre du mois, qui ouvre le calendrier',
  'pt-replie': 'ligne repliée du planning téléphone',
  'jdb-pers': 'pastille d’une personne (dessin validé le 16/10, B-165f)',
  'jdb-pastille': 'pastille d’action de 24 px (dessin validé le 16/10, B-165f)',
  'cpm-tr': 'tranche horaire cochable (dessin validé le 16/10)',
  // — Filou a son identité à lui.
  'btn-filou': 'bouton aux couleurs de Filou',
  'filou-edge': 'languette de Filou sur le bord de l’écran',
  // — Des contrôles qui ne sont pas des boutons d’action.
  swatch: 'pastille du sélecteur de couleur',
  'selcoul-pipette': 'pipette du sélecteur de couleur',
  coche: 'case à cocher',
  'org-inter': 'interrupteur : son rail et son curseur sont raccordés, pas son libellé',
  // — La couleur y porte un sens (alerte) : la remplacer le ferait mentir.
  'f-masques': 'pastille d’alerte « filtres masqués »',
  'gva-toggle': 'bouton d’une alerte colorée',
  // — Suppressions fantômes, visibles seulement au survol de leur rangée.
  'gen-suppr': 'icône de suppression qui n’apparaît qu’au survol de la rangée',
  'gjc-carte-suppr': 'icône de suppression posée sur une carte',
}

/**
 * Les <button> sans aucune classe maison, par fichier : combien, et ce qui les
 * dessine. Le test ne voit pas l'ancêtre d'un bouton ; il vérifie donc le
 * COMPTE. Un bouton sans classe ajouté ou retiré oblige à relire cette ligne.
 */
export const SANS_CLASSE: Record<string, { n: number; par: string }> = {
  'components/v2/AbsencesV2.tsx': { n: 3, par: '.tabs button' },
  'components/v2/ReglesStructureV2.tsx': { n: 4, par: '.tabs button' },
  'components/v2/HistoriqueV2.tsx': { n: 3, par: '.seg button' },
  'components/v2/EchangesV2.tsx': { n: 2, par: '.segmente button' },
  'components/v2/ContraintesVetoModale.tsx': { n: 2, par: '.cv-item-actions button' },
  'components/v2/DepannagesV2.tsx': { n: 3, par: '.dep-actions button' },
  'components/v2/EquipeV2.tsx': { n: 3, par: '.vet-outils button, .vet-actions button' },
  'components/v2/SecretariatSection.tsx': { n: 2, par: '.secr-outils button' },
  'components/v2/MessagerieV2.tsx': {
    n: 6,
    par: '.msg-gestes button, .msg-joints button, .msg-mail-choisi button — et 1 rangée d’annuaire (hors système)',
  },
  'components/v2/regles/OngletCreneaux.tsx': { n: 1, par: '.jours-pick button' },
  'components/v2/regles/OngletMoteur.tsx': { n: 2, par: '.chips button' },
  'components/v2/regles/OngletProfils.tsx': { n: 1, par: 'case de la grille des périodes types (hors système)' },
  'components/v2/PlanningV2.tsx': { n: 2, par: 'cases de l’ancienne grille (hors système)' },
  'components/v2/PlanningTelephone.tsx': {
    n: 4,
    par: '.pt-bascule button (2) — et 2 cases du calendrier téléphone (hors système)',
  },
  'components/v2/MonAgendaCorps.tsx': { n: 1, par: '.ma-seg button' },
  'components/absences/ChoixPerimetre.tsx': { n: 1, par: 'point d’aide dans une rangée (hors système)' },
  // — Héritage V1, dessiné en classes utilitaires : l'état « choisi » y est
  //   porté par ces classes, un rôle le masquerait. Reste à faire : B-206a.
  'components/echanges/EchangesClient.tsx': { n: 2, par: 'tuiles de choix Tailwind (non raccordées, B-206a)' },
  'components/planning/DiagnosticImpasse.tsx': { n: 1, par: 'bouton dépliant Tailwind (non raccordé, B-206a)' },
  'components/regles/CompositionEquipeClient.tsx': { n: 2, par: 'puces Tailwind (non raccordées, B-206a)' },
  'components/regles/RegleFormDialog.tsx': { n: 3, par: 'puces Tailwind (non raccordées, B-206a)' },
}

/**
 * Les familles dont le nom n'a pas de tiret. Tout autre mot sans tiret (`on`,
 * `actif`, `danger`, `sel`…) est un ÉTAT, pas une famille : il ne suffit pas à
 * dire qu'un bouton est raccordé, sinon `className="truc actif"` passerait.
 */
const FAMILLES_SANS_TIRET = ['btn', 'widget', 'swatch', 'coche', 'piste']

/** Les variantes du bouton shadcn que la feuille sait dessiner. */
const VARIANTES_RACCORDEES = ['', 'outline', 'destructive', 'ghost']

/**
 * Les préludes des blocs de PREMIER niveau d'une feuille, commentaires retirés.
 * Isolée pour pouvoir être SONDÉE : un gardien qu'on n'a jamais vu refuser est
 * indiscernable d'un gardien muet.
 */
export function blocsDePremierNiveau(css: string): string[] {
  const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const preludes: string[] = []
  let profondeur = 0
  let courant = ''
  for (const c of sansCommentaires) {
    if (c === '{') {
      if (profondeur === 0) preludes.push(courant.trim().replace(/\s+/g, ' '))
      profondeur++
      courant = ''
    } else if (c === '}') {
      profondeur--
      courant = ''
    } else if (profondeur === 0) {
      courant += c
    }
  }
  return preludes
}

/** Les noms de classe cités comme sélecteur (`.nom`) dans un texte CSS. */
export function classesCitees(css: string): Set<string> {
  const sans = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return new Set([...sans.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]))
}

export interface BoutonLu {
  ligne: number
  balise: 'button' | 'Button'
  /** Tous les mots lus dans l'attribut className, quelle que soit son écriture. */
  mots: string[]
  variante: string
}

/** Chaque <button> et <Button> d'un fichier source, avec les mots de sa classe. */
export function boutonsDe(source: string): BoutonLu[] {
  const out: BoutonLu[] = []
  const re = /<(button|Button)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    let i = m.index + m[0].length
    let prof = 0
    for (; i < source.length; i++) {
      const c = source[i]
      if (c === '{') prof++
      else if (c === '}') prof--
      else if (c === '>' && prof === 0 && source[i - 1] !== '=') break
    }
    const attrs = source.slice(m.index, i)
    let brut = ''
    const k = attrs.indexOf('className=')
    if (k >= 0) {
      const j = k + 'className='.length
      if (attrs[j] === '"') brut = attrs.slice(j + 1, attrs.indexOf('"', j + 1))
      else {
        let d = 0
        let e = j
        for (; e < attrs.length; e++) {
          if (attrs[e] === '{') d++
          else if (attrs[e] === '}') {
            d--
            if (d === 0) break
          }
        }
        brut = attrs.slice(j + 1, e)
      }
    }
    out.push({
      ligne: source.slice(0, m.index).split('\n').length,
      balise: m[1] as 'button' | 'Button',
      mots: [...new Set(brut.match(/[a-zA-Z][a-zA-Z0-9_]*(?:-[a-zA-Z0-9_]+)*/g) ?? [])],
      variante: attrs.match(/variant="([^"]*)"/)?.[1] ?? '',
    })
  }
  return out
}

/**
 * La décision prise pour un bouton, ou `null` s'il n'y en a aucune.
 * `maison` = les classes définies dans NOS feuilles (les utilitaires Tailwind
 * n'y sont pas, ils ne comptent donc pas comme une famille).
 */
export function decisionPour(
  bouton: BoutonLu,
  maison: Set<string>,
  raccordees: Set<string>,
  hors: Record<string, string>,
): 'raccorde' | 'hors' | 'sans-classe' | null {
  const siennes = bouton.mots.filter(
    (mot) => maison.has(mot) && (mot.includes('-') || FAMILLES_SANS_TIRET.includes(mot)),
  )
  if (siennes.length === 0) return 'sans-classe'
  if (siennes.some((mot) => mot in hors)) return 'hors'
  if (siennes.some((mot) => raccordees.has(mot))) return 'raccorde'
  return null
}

function fichiers(racine: string, exts: RegExp): string[] {
  const out: string[] = []
  const marcher = (dir: string) => {
    for (const nom of readdirSync(dir)) {
      const chemin = join(dir, nom)
      if (statSync(chemin).isDirectory()) marcher(chemin)
      else if (exts.test(nom)) out.push(chemin)
    }
  }
  marcher(racine)
  return out
}
const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/')

const cssBoutons = readFileSync(FEUILLE, 'utf8')
const raccordees = classesCitees(cssBoutons)
const maison = classesCitees(
  readdirSync(STYLES)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(STYLES, f), 'utf8'))
    .join('\n'),
)
const sources = fichiers(SRC, /\.tsx$/).map((f) => ({ f: rel(f), boutons: boutonsDe(readFileSync(f, 'utf8')) }))

describe('B-206 ① — le dessin « Relief » reste derrière sa porte', () => {
  it('la sonde refuse une règle écrite hors du bloc (contre-épreuve)', () => {
    const fautive = `${LA_PORTE_CSS} { .bt-pri { color: red; } }\n.btn { color: red; }`
    expect(blocsDePremierNiveau(fautive)).toEqual([LA_PORTE_CSS, '.btn'])
    const saine = `/* .btn { } */\n${LA_PORTE_CSS} { .btn { color: red; &:hover { color: blue; } } }`
    expect(blocsDePremierNiveau(saine)).toEqual([LA_PORTE_CSS])
  })

  it('la feuille n’a qu’un bloc de premier niveau : la porte', () => {
    expect(blocsDePremierNiveau(cssBoutons)).toEqual([LA_PORTE_CSS])
  })

  it('la coquille V2 consulte la porte de chantier pour poser l’attribut', () => {
    const source = readFileSync(COQUILLE, 'utf8')
    expect(source).toContain("chantierOuvertPourLeCabinet(supabase, 'boutons-relief')")
    expect(source).toMatch(/data-boutons=\{boutonsRelief \? 'relief' : undefined\}/)
  })

  it('les pages de connexion posent l’attribut par la porte, cabinet inconnu', () => {
    // Avant la connexion il n'y a pas de cabinet. Ces pages doivent donc
    // interroger la porte avec « pas un bac à sable » : elle ne s'ouvre alors
    // que si le chantier est ouvert à TOUS — jamais en dur, jamais pour un seul.
    for (const f of CONNEXION) {
      const source = readFileSync(f, 'utf8')
      expect(source, rel(f)).toContain("chantierOuvert('boutons-relief', { estBacASable: false })")
      const poses = source.match(/data-boutons=\{[^}]*\}/g) ?? []
      expect(poses.length, rel(f)).toBeGreaterThan(0)
      expect(poses.every((p) => p === 'data-boutons={BOUTONS}'), rel(f)).toBe(true)
    }
  })

  it('personne d’autre ne pose l’attribut ni n’importe la feuille', () => {
    const intrus = fichiers(SRC, /\.(ts|tsx|css)$/)
      .filter((f) => f !== FEUILLE && f !== COQUILLE && !CONNEXION.includes(f))
      .filter((f) => {
        const s = readFileSync(f, 'utf8')
        return s.includes('data-boutons') || s.includes('v2-boutons.css')
      })
      .map(rel)
      // `chantiers.ts` cite l'attribut dans la raison de diffusion : c'est du texte.
      .filter((f) => f !== 'lib/produit/chantiers.ts')
    expect(intrus).toEqual([])
  })

  it('le chantier « boutons-relief » est déclaré, et porte son item', () => {
    expect(CHANTIERS['boutons-relief']).toBeDefined()
    expect(CHANTIERS['boutons-relief'].item).toBe('B-206')
  })
})

describe('B-206 ② — aucun bouton n’est oublié en silence', () => {
  it('la sonde reconnaît les trois issues, et le silence (contre-épreuve)', () => {
    const m = new Set(['btn', 'btn-valider', 'widget', 'nouvelle-famille'])
    const r = new Set(['btn', 'btn-valider'])
    const h = { widget: 'fiche cliquable' }
    const lu = (src: string) => boutonsDe(src)[0]
    expect(decisionPour(lu('<button className="btn btn-valider">'), m, r, h)).toBe('raccorde')
    expect(decisionPour(lu('<button className={`widget ${x}`}>'), m, r, h)).toBe('hors')
    expect(decisionPour(lu('<button className="flex gap-2">'), m, r, h)).toBe('sans-classe')
    expect(decisionPour(lu('<button onClick={() => a > b}>'), m, r, h)).toBe('sans-classe')
    // Le cas que tout ce test existe pour attraper :
    expect(decisionPour(lu('<button className="nouvelle-famille">'), m, r, h)).toBeNull()
  })

  it('l’inventaire n’est pas vide — sinon ce test passerait pour la mauvaise raison', () => {
    const total = sources.reduce((n, s) => n + s.boutons.length, 0)
    expect(total).toBeGreaterThan(400)
  })

  it('chaque <button> classé est raccordé à la feuille, ou hors système avec sa raison', () => {
    const muets = sources.flatMap((s) =>
      s.boutons
        .filter((b) => b.balise === 'button' && decisionPour(b, maison, raccordees, HORS_SYSTEME) === null)
        .map((b) => `${s.f}:${b.ligne}  (${b.mots.filter((mot) => maison.has(mot)).join(' ')})`),
    )
    expect(
      muets,
      'Ces boutons portent une classe que rien ne décide. Pour chacun, au choix :\n' +
        '  • ajouter sa classe à la liste d’un rôle dans src/styles/v2-boutons.css ;\n' +
        '  • ou l’inscrire dans HORS_SYSTEME (ce fichier) avec la raison.\n',
    ).toEqual([])
  })

  it('les <button> sans classe sont comptés, fichier par fichier', () => {
    const constate: Record<string, number> = {}
    for (const s of sources) {
      const n = s.boutons.filter(
        (b) => b.balise === 'button' && decisionPour(b, maison, raccordees, HORS_SYSTEME) === 'sans-classe',
      ).length
      if (n > 0) constate[s.f] = n
    }
    const declare = Object.fromEntries(Object.entries(SANS_CLASSE).map(([f, v]) => [f, v.n]))
    expect(
      constate,
      'Un bouton sans classe a été ajouté ou retiré. Vérifier ce qui le dessine ' +
        '(son conteneur est-il raccordé dans v2-boutons.css ?) puis mettre SANS_CLASSE à jour.',
    ).toEqual(declare)
  })

  it('chaque conteneur déclaré comme raccordé l’est vraiment dans la feuille', () => {
    const absents = Object.entries(SANS_CLASSE).flatMap(([f, v]) =>
      (v.par.match(/\.[a-z][a-z0-9-]* button/g) ?? [])
        .filter((sel) => !cssBoutons.includes(sel))
        .map((sel) => `${f} → ${sel}`),
    )
    expect(absents).toEqual([])
  })

  it('aucune entrée HORS_SYSTEME ne désigne une famille disparue ou déjà raccordée', () => {
    const utilisees = new Set(sources.flatMap((s) => s.boutons.flatMap((b) => b.mots)))
    expect(Object.keys(HORS_SYSTEME).filter((k) => !utilisees.has(k))).toEqual([])
    expect(Object.keys(HORS_SYSTEME).filter((k) => raccordees.has(k))).toEqual([])
  })

  it('les boutons shadcn n’utilisent que des variantes que la feuille dessine', () => {
    const autres = sources.flatMap((s) =>
      s.boutons
        .filter((b) => b.balise === 'Button' && !VARIANTES_RACCORDEES.includes(b.variante))
        .map((b) => `${s.f}:${b.ligne} variant="${b.variante}"`),
    )
    expect(autres).toEqual([])
  })
})
