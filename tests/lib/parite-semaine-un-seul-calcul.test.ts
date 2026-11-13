// ============================================================
// B-209 — LE NUMÉRO DE SEMAINE NE SE CALCULE QU'À UN SEUL ENDROIT
// ============================================================
// Ce test ne vérifie pas un résultat : il vérifie qu'il n'existe pas un SECOND
// calcul quelque part. C'est le trou par lequel le bug est passé.
//
// Le 13/11, trois endroits calculaient le numéro de semaine :
//   • `src/engine/utils.ts`                        — faux (toute l'année 2027)
//   • `src/engine/validation/validerPlanning.ts`   — faux, copie de la même formule
//   • `src/components/chantier/GrilleSemainesV2.tsx` — JUSTE, et c'est le pire
//
// Les tests numériques de `utils.test.ts` prouvent que le calcul est juste
// aujourd'hui. Ils ne peuvent rien dire du jour où quelqu'un, pressé, réécrira
// la formule dans un quatrième fichier parce qu'importer paraissait lourd. Et
// deux calculs qui divergent ne lèvent AUCUNE erreur : l'écran affiche un
// numéro, le remplissage en applique un autre, et le cabinet découvre l'écart
// en lisant son planning. C'est exactement ce qui est arrivé.
//
// ⚠️ CE QUE CE GARDE-FOU NE COUVRE PAS, dit ici pour qu'il ne promette pas plus
//    qu'il ne tient (relevé par la revue SCAN du 13/11) :
//      • il attrape une DÉCLARATION de fonction, pas une formule posée en ligne
//        dans une expression ;
//      • il ne connaît que les noms de la liste `INTERDITS` ; un quatrième nom
//        inventé passerait ;
//      • il ne scanne que `src/` — ni `scripts/`, ni `supabase/`, ni `e2e/`,
//        ni les arbres de travail en `.claude/` (où dorment des copies de
//        `validerPlanning.ts` portant encore l'ancienne formule : à vérifier
//        avant de fusionner une de ces branches) ;
//      • un renommage de `numeroSemaine` À L'INTÉRIEUR de la maison ne le fait
//        pas rougir, puisque la maison est exclue du balayage.
//    Il ne prétend pas fermer la porte — il la fait grincer.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Le seul fichier autorisé à porter ces calculs. */
const MAISON = join('src', 'engine', 'utils.ts')

/**
 * Les déclarations interdites ailleurs que dans `MAISON`.
 *
 * On cible la DÉCLARATION (`function nom(`) et pas l'usage : importer et
 * appeler `numeroSemaine` est précisément ce qu'on veut encourager.
 */
const INTERDITS: ReadonlyArray<{ motif: RegExp; quoi: string }> = [
  // Déclarations, sous les deux formes que TypeScript accepte : `function nom(`
  // et `const nom = (…) =>`. La revue SCAN du 13/11 a relevé que la seule forme
  // `function` laissait passer une flèche — et la copie de `GrilleSemainesV2`
  // aurait très bien pu être écrite ainsi.
  {
    motif: /(?:function\s+|(?:const|let|var)\s+)numeroSemaine\w*\s*(?:\(|=)/,
    quoi: 'un calcul du numéro de semaine',
  },
  {
    motif: /(?:function\s+|(?:const|let|var)\s+)estSemaineImpaire\s*(?:\(|=)/,
    quoi: 'un calcul de la parité ISO',
  },
  // Les autres noms sous lesquels un numéro de semaine se recode sans y penser.
  // Liste ouverte : chaque fois qu'une copie est trouvée sous un nouveau nom,
  // elle s'ajoute ici.
  {
    motif: /(?:function\s+|(?:const|let|var)\s+)(?:getISOWeek|isoWeek|semaineIso|semaineISO|weekNumber|numSemaine)\w*\s*(?:\(|=)/i,
    quoi: 'un calcul du numéro de semaine sous un autre nom',
  },
]

function fichiersSource(racine: string): string[] {
  const trouves: string[] = []
  for (const entree of readdirSync(racine)) {
    if (entree === 'node_modules' || entree.startsWith('.')) continue
    const chemin = join(racine, entree)
    if (statSync(chemin).isDirectory()) {
      trouves.push(...fichiersSource(chemin))
    } else if (/\.(ts|tsx)$/.test(entree) && !/\.test\.tsx?$/.test(entree)) {
      trouves.push(chemin)
    }
  }
  return trouves
}

describe('B-209 — un seul calcul du numéro de semaine dans tout le code', () => {
  it('aucun fichier hors engine/utils.ts ne déclare son propre calcul', () => {
    const copies: string[] = []

    for (const chemin of fichiersSource('src')) {
      if (chemin === MAISON) continue
      const contenu = readFileSync(chemin, 'utf8')
      for (const { motif, quoi } of INTERDITS) {
        if (motif.test(contenu)) {
          copies.push(`${chemin} déclare ${quoi}`)
        }
      }
    }

    // Si ce test échoue : ne corrigez pas la liste, retirez la copie. Importez
    // `numeroSemaine` / `estSemaineImpaire` depuis `@/engine/utils`. Le jour où
    // une convention ancrée remplacera la parité ISO, les gardes et les semaines
    // types devront basculer DANS LE MÊME COMMIT — ce qui n'est possible que
    // tant qu'il n'y a qu'un seul endroit à changer.
    expect(copies).toEqual([])
  })

  it('la maison, elle, porte bien les deux calculs', () => {
    // Un garde-fou qui ne trouve plus ce qu'il surveille se taît au lieu de
    // crier : si `engine/utils.ts` est renommé ou découpé, ce test doit tomber
    // et pas devenir un test vide qui passe tout seul.
    const contenu = readFileSync(MAISON, 'utf8')
    expect(contenu).toMatch(/function\s+numeroSemaine\s*\(/)
    expect(contenu).toMatch(/function\s+estSemaineImpaire\s*\(/)
  })
})
