// ============================================================
// Aucun appelant des compteurs ne masque leur forme par un cast
// ============================================================
// L'INCIDENT QUI A RENDU CE TEST NÉCESSAIRE — 2026-08-14
//
// `queryCompteurs` et `queryTotalWE` renvoyaient un tableau et un nombre. Elles
// renvoient maintenant `{ compteurs, erreur }` et `{ totalWE, erreur }`, pour
// qu'une erreur de lecture cesse de se déguiser en « zéro garde ».
//
// Cinq appelants sur six ont été rattrapés par `tsc`. Le sixième,
// `app/(v2)/planning/page.tsx`, avait ceci :
//
//     const bilans = calculerBilans(compteurs as CompteursRow[], totalWE as number)
//
// Les deux `as` affirmaient à TypeScript une forme que la valeur n'avait plus.
// Le cast compilait, `next build` passait, la suite de tests passait. À
// l'exécution, `calculerBilans` recevait un objet :
//
//     TypeError: compteurs.reduce is not a function
//
// Ce qui rend le piège méchant : le garde-fou `if (compteurs.length === 0)` en
// tête de `calculerBilans` ne protège de rien — `undefined === 0` est faux, on
// entre quand même. Et la panne ne se déclenche QUE si un mois affiché
// chevauche une période : sur une base sans période, la branche de repli
// masquait tout. Autrement dit, l'écran principal du produit aurait tenu
// jusqu'à la première vraie donnée.
//
// D'où ce test, qui lit le SOURCE. Un cast n'est pas une vérification : c'est
// une promesse faite au compilateur, que personne ne tient à l'exécution.
//
// CE QUI RESTE AUTORISÉ : caster À L'INTÉRIEUR de la forme, par exemple
// `{ compteurs: [] as CompteursRow[], erreur: null }` pour typer une branche de
// repli. C'est le RÉSULTAT de l'appel qu'on ne doit pas maquiller.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(process.cwd(), 'src')

/** Les fonctions dont la forme de retour ne doit jamais être réaffirmée. */
const LECTURES = ['queryCompteurs', 'queryTotalWE', 'queryCompteursPlage']

function fichiersTs(dossier: string): string[] {
  const sortie: string[] = []
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree)
    if (statSync(chemin).isDirectory()) sortie.push(...fichiersTs(chemin))
    else if (/\.tsx?$/.test(entree)) sortie.push(chemin)
  }
  return sortie
}

describe('les appelants des compteurs ne maquillent pas la forme reçue', () => {
  it('aucune variable issue d’un compteur n’est réaffirmée par « as »', () => {
    const fautes: string[] = []

    for (const fichier of fichiersTs(RACINE)) {
      const source = readFileSync(fichier, 'utf8')
      if (!LECTURES.some((f) => source.includes(`${f}(`))) continue
      if (fichier.endsWith(join('hooks', 'useCompteurs.ts'))) continue // la définition

      const lignes = source.split('\n')
      lignes.forEach((ligne, i) => {
        // On cherche `calculerBilans(x as …)` et `compteurs={x as …}` : un cast
        // appliqué à une valeur nommée comme un compteur. C'est grossier, et
        // c'est voulu — un test qui comprend TypeScript serait un compilateur.
        const suspect =
          /\b(compteurs?|totalWE)\w*\s+as\s+(CompteursRow|number)/.test(ligne) &&
          // La branche de repli typée reste licite : elle construit la forme,
          // elle ne prétend pas qu'un appel en a une autre.
          !/erreur\s*:/.test(ligne)
        if (suspect) {
          fautes.push(`${fichier.replace(RACINE, 'src')}:${i + 1} → ${ligne.trim()}`)
        }
      })
    }

    expect(fautes, `Cast sur le résultat d'une lecture de compteurs :\n${fautes.join('\n')}`).toEqual([])
  })

  it('chaque appelant récupère bien « erreur » — sinon elle est avalée', () => {
    const muets: string[] = []

    for (const fichier of fichiersTs(RACINE)) {
      const source = readFileSync(fichier, 'utf8')
      if (fichier.endsWith(join('hooks', 'useCompteurs.ts'))) continue
      if (!LECTURES.some((f) => source.includes(`${f}(supabase`) || source.includes(`${f}(ctx.supabase`))) {
        continue
      }
      // Le fichier appelle une lecture : il doit mentionner `erreur` quelque
      // part. Une erreur qu'on ne nomme pas est une erreur qu'on ne traite pas.
      if (!/\berreur\b/.test(source)) {
        muets.push(fichier.replace(RACINE, 'src'))
      }
    }

    expect(muets, `Appelants qui ignorent l'erreur de lecture :\n${muets.join('\n')}`).toEqual([])
  })
})
