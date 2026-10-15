// ============================================================
// GUARDVETO — Une feuille de style qui ne parse pas casse le DEPLOIEMENT
// ============================================================
// 🔴 PAYE LE 14/10, EN PRODUCTION. MiKL : « y a eu un pb avec le deploiement ».
//
// La cause, trouvee en rejouant `npm run build` : un COMMENTAIRE CSS qui citait
// un motif de recherche de fichiers — deux etoiles suivies d'une barre oblique.
// Cette sequence FERME LE COMMENTAIRE. Tout ce qui suivait devenait du CSS, et
// PostCSS rendait « Unknown word pour » a la ligne 1353.
//
// ⚠️ CE QUI N'A RIEN VU, ET POURQUOI :
//   • `tsc`             — ne lit pas les feuilles de style
//   • 2277 tests        — aucun ne parse de CSS
//   • `npm run lint`    — ESLint ne regarde pas les `.css`
//   • `chantier-classes-sans-regle.test.ts`, ecrit UNE HEURE PLUS TOT, cherche
//     des sous-chaines dans le texte du fichier : un `.cpm-origine` present
//     dans une zone devenue invalide lui parait parfaitement normal.
//
// **Le seul outil du projet qui parse le CSS est le build**, qui prend 40 s et
// que je n'avais pas lance sur ce lot. Ce test le fait en moins d'une seconde,
// a chaque `npm test` — c'est-a-dire SANS qu'on ait a y penser.
//
// 🔑 C'est l'application immediate de la lecon ecrite le matin meme : une sonde
//    qu'on n'execute pas vaut zero. Ici, la sonde s'appelait « le build ».
// ============================================================

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const STYLES = join(process.cwd(), 'src', 'styles')

const feuilles = readdirSync(STYLES).filter((f) => f.endsWith('.css'))

describe('Toutes les feuilles de style parsent', () => {
  it('le dossier contient bien des feuilles — sinon ce test passerait a vide', () => {
    // Un test qui n'a rien a verifier passe au vert pour la mauvaise raison.
    expect(feuilles.length).toBeGreaterThan(3)
  })

  it.each(feuilles)('%s est du CSS valide', (fichier) => {
    const source = readFileSync(join(STYLES, fichier), 'utf8')
    // `postcss.parse` leve une `CssSyntaxError` qui porte le fichier, la ligne
    // et la colonne — exactement ce que le build a dit, en 40 s de moins.
    expect(() => postcss.parse(source, { from: join(STYLES, fichier) })).not.toThrow()
  })

  it('⛔ aucun commentaire ne contient de sequence qui le fermerait', () => {
    // Le cas du 14/10 ne leve pas toujours une erreur de parsing : il peut
    // aussi produire du CSS *silencieusement faux* (des regles avalees par un
    // commentaire rouvert plus loin). On le cherche donc EN PLUS du parsing,
    // sur le motif precis qui a mordu : un glob de chemin.
    const fautifs: string[] = []
    for (const f of feuilles) {
      readFileSync(join(STYLES, f), 'utf8')
        .split('\n')
        .forEach((ligne, i) => {
          if (/\*\*\//.test(ligne)) fautifs.push(`${f}:${i + 1}  ${ligne.trim().slice(0, 90)}`)
        })
    }
    expect(
      fautifs,
      'Un glob de chemin dans un commentaire CSS le FERME, et le build casse :\n  '
        + fautifs.join('\n  '),
    ).toEqual([])
  })
})
