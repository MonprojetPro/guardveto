// ============================================================
// GUARDVETO — Le système de boutons « Relief » reste derrière sa porte (B-206)
// ============================================================
// CE QUE CE TEST EMPÊCHE.
//
// `styles/v2-boutons.css` est importée par la coquille V2, donc chargée par
// TOUS les cabinets. Ce qui la retient, c'est que chacune de ses règles vit
// dans le bloc `body:has(.v2[data-boutons="relief"])`, et que l'attribut n'est
// posé que si la porte de chantier `boutons-relief` est ouverte.
//
// Une seule règle écrite hors de ce bloc redessinerait les boutons du client
// sans qu'aucune porte ne le sache — exactement l'incident du 08/10 (B-151),
// par le chemin que la porte de chantier ne couvre pas : un FICHIER PARTAGÉ.
// (Mémoire : « un fichier partagé n'a pas de porte de chantier ».)
//
// Il vérifie donc :
//   1. que la feuille n'a qu'UN bloc de premier niveau, et que c'est le bon ;
//   2. que la coquille V2 consulte la porte pour poser l'attribut ;
//   3. que la feuille n'est importée par personne d'autre ;
//   4. que le chantier existe (sinon la porte est fermée pour tout le monde,
//      et le système ne s'affiche nulle part sans que rien ne le dise).
//
// CE QU'IL NE PEUT PAS FAIRE : juger que le rendu est beau, ni qu'une règle
// l'emporte réellement sur celle qu'elle remplace (spécificité, ordre). Ça, seul
// un œil sur l'écran le dit.
//
// Aucune connexion réseau : on lit les fichiers.
// ============================================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHANTIERS } from '../../src/lib/produit/chantiers'

const SRC = join(process.cwd(), 'src')
const FEUILLE = join(SRC, 'styles', 'v2-boutons.css')
const COQUILLE = join(SRC, 'app', '(v2)', 'layout.tsx')

/** Le seul sélecteur de premier niveau admis dans la feuille. */
export const LA_PORTE_CSS = 'body:has(.v2[data-boutons="relief"])'

/**
 * Les préludes des blocs de PREMIER niveau d'une feuille (sélecteurs et
 * at-rules), commentaires retirés.
 *
 * Isolée pour pouvoir être SONDÉE : un gardien qu'on n'a jamais vu refuser
 * est indiscernable d'un gardien muet.
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

function fichiers(racine: string): string[] {
  const out: string[] = []
  const marcher = (dir: string) => {
    for (const nom of readdirSync(dir)) {
      const chemin = join(dir, nom)
      if (statSync(chemin).isDirectory()) marcher(chemin)
      else if (/\.(ts|tsx|css)$/.test(nom)) out.push(chemin)
    }
  }
  marcher(racine)
  return out
}

describe('B-206 — le système de boutons « Relief » reste derrière sa porte', () => {
  it('la sonde refuse une règle écrite hors du bloc (contre-épreuve)', () => {
    const fautive = `${LA_PORTE_CSS} { .bt-pri { color: red; } }\n.btn { color: red; }`
    expect(blocsDePremierNiveau(fautive)).toEqual([LA_PORTE_CSS, '.btn'])
    // … et ne se laisse pas tromper par une règle imbriquée ou un commentaire.
    const saine = `/* .btn { } */\n${LA_PORTE_CSS} { .btn { color: red; &:hover { color: blue; } } }`
    expect(blocsDePremierNiveau(saine)).toEqual([LA_PORTE_CSS])
  })

  it('la feuille n’a qu’un bloc de premier niveau : la porte', () => {
    const blocs = blocsDePremierNiveau(readFileSync(FEUILLE, 'utf8'))
    expect(blocs).toEqual([LA_PORTE_CSS])
  })

  it('la coquille V2 consulte la porte de chantier pour poser l’attribut', () => {
    const source = readFileSync(COQUILLE, 'utf8')
    expect(source).toContain("chantierOuvertPourLeCabinet(supabase, 'boutons-relief')")
    expect(source).toMatch(/data-boutons=\{boutonsRelief \? 'relief' : undefined\}/)
    // L'attribut ne doit pas pouvoir être posé en dur ailleurs dans la coquille.
    expect(source.match(/data-boutons/g)?.length).toBe(2) // le commentaire + l'attribut
  })

  it('personne d’autre ne pose l’attribut ni n’importe la feuille', () => {
    const intrus = fichiers(SRC)
      .filter((f) => f !== FEUILLE && f !== COQUILLE)
      .filter((f) => {
        const s = readFileSync(f, 'utf8')
        return s.includes('data-boutons') || s.includes('v2-boutons.css')
      })
      .map((f) => relative(SRC, f).replace(/\\/g, '/'))
      // `chantiers.ts` cite l'attribut dans la raison de diffusion : c'est du texte.
      .filter((f) => f !== 'lib/produit/chantiers.ts')
    expect(intrus).toEqual([])
  })

  it('le chantier « boutons-relief » est déclaré, et porte son item', () => {
    expect(CHANTIERS['boutons-relief']).toBeDefined()
    expect(CHANTIERS['boutons-relief'].item).toBe('B-206')
  })
})
