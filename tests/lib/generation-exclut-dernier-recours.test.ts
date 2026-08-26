// ============================================================
// B-046 — garde-fou : aucune porte de génération sans l'exclusion
// ============================================================
// L'exclusion du dernier recours ne vit pas dans le moteur (elle casserait les
// chemins manuels, qui appellent les mêmes fonctions) : elle vit dans le
// CHARGEMENT, `resoudreContexte({ pourGeneration: true })`.
//
// Ce qui veut dire qu'une future route qui lancerait le moteur en oubliant ce
// drapeau remettrait le dernier recours dans les plannings, sans qu'aucun test
// métier ne rougisse — le planning serait valide, simplement pas celui que MiKL
// a demandé. Le silence est le mode de défaillance ici, comme pour la couverture
// de Filou et le tableau des attentes. On refuse donc le silence.
//
// Règle vérifiée : tout fichier de production qui appelle `genererPlanningPur`
// doit aussi passer `pourGeneration: true` à `resoudreContexte`.
// ============================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(process.cwd(), 'src')

function fichiersSources(dir: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(dir)) {
    const chemin = join(dir, entree)
    if (statSync(chemin).isDirectory()) {
      if (entree === '__tests__' || entree === 'node_modules') continue
      out.push(...fichiersSources(chemin))
    } else if (/\.tsx?$/.test(entree) && !/\.test\.tsx?$/.test(entree)) {
      out.push(chemin)
    }
  }
  return out
}

describe('B-046 — toute porte de génération exclut le dernier recours', () => {
  it('chaque appelant de genererPlanningPur charge son contexte avec pourGeneration', () => {
    const appelants = fichiersSources(RACINE).filter((f) => {
      if (f.endsWith(join('engine', 'solver.ts'))) return false // c'est sa définition
      const src = readFileSync(f, 'utf-8')
      // L'IMPORT, pas la mention : quatre fichiers citent `genererPlanningPur()`
      // dans un commentaire d'en-tête sans jamais le lancer.
      return /import\s*\{[^}]*\bgenererPlanningPur\b[^}]*\}\s*from/.test(src)
    })

    // Contrôle négatif : si la recherche ne trouve plus personne, c'est elle
    // qui est cassée, pas le produit qui est devenu conforme.
    expect(appelants.length).toBeGreaterThan(0)

    const fautifs = appelants.filter((f) => {
      const src = readFileSync(f, 'utf-8')
      return !/pourGeneration\s*:\s*true/.test(src)
    })

    expect(
      fautifs.map((f) => f.replace(process.cwd(), '')),
      'Ces fichiers lancent le moteur sans exclure les vétérinaires « dernier recours » : ' +
        'ajoute { pourGeneration: true } à resoudreContexte (cf. src/engine/effectif.ts).',
    ).toEqual([])
  })

  it('le pré-vol raisonne sur le même effectif que la génération', () => {
    const src = readFileSync(join(RACINE, 'app', 'api', 'generate', 'pre-vol', 'route.ts'), 'utf-8')
    expect(src).toMatch(/pourGeneration\s*:\s*true/)
    // Et il dit au pré-vol qui a été écarté, sinon il conseille de supprimer
    // les règles du dernier recours.
    expect(src).toMatch(/idsHorsGeneration/)
  })
})
