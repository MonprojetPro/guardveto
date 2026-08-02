// ============================================================
// Aucun fichier « use server » ne réexporte de type
// ============================================================
// L'INCIDENT QUI A RENDU CE TEST NÉCESSAIRE — 2026-08-02
//
// `app/(protected)/regles/actions.ts` réexportait trois types pour éviter de
// réécrire une douzaine d'imports :
//
//     export type { BriqueEvaluable, ForceFormulaire, UpsertReglePayload }
//
// Raisonnement (faux) : « un type est effacé à la compilation, donc ça ne peut
// pas violer la règle des exports async ». En réalité, le transformateur
// `'use server'` recense les exports du module pour les enregistrer comme
// actions AVANT l'effacement des types, et émet un export runtime pour un
// symbole qui n'existe pas :
//
//     ReferenceError: BriqueEvaluable is not defined
//
// Ce qui rend le piège méchant : `tsc --noEmit` passe, `next build` passe,
// les tests passent. La panne n'apparaît qu'à l'exécution, en production, sous
// la forme d'une page blanche « a server error occurred » — sans nommer le
// fichier fautif ailleurs que dans les logs de l'hébergeur.
//
// D'où ce test, qui lit le SOURCE plutôt que d'exécuter quoi que ce soit.
//
// CE QUI RESTE AUTORISÉ : déclarer un type sur place (`export interface X {}`,
// `export type X = …`). Ce sont des déclarations, le transformateur les
// reconnaît. Seul le RÉEXPORT d'un symbole importé pose problème.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(process.cwd(), 'src')

function fichiersTs(dossier: string): string[] {
  const sortie: string[] = []
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree)
    if (statSync(chemin).isDirectory()) {
      sortie.push(...fichiersTs(chemin))
    } else if (/\.tsx?$/.test(entree)) {
      sortie.push(chemin)
    }
  }
  return sortie
}

/** Un fichier de server actions : la directive est en tête du fichier. */
function estUseServer(source: string): boolean {
  return /^\s*(['"])use server\1/.test(source)
}

/**
 * `export type { … }` et `export type { … } from '…'` — le réexport, dans ses
 * deux formes. On ne cherche PAS `export type X =` ni `export interface`, qui
 * sont des déclarations et vont très bien.
 */
const REEXPORT_DE_TYPE = /^\s*export\s+type\s*\{/m

describe('fichiers « use server »', () => {
  const fichiers = fichiersTs(RACINE)

  it('il y en a bien (le test scanne quelque chose)', () => {
    expect(fichiers.length).toBeGreaterThan(50)
  })

  it('aucun ne réexporte de type — ça produit un ReferenceError au runtime', () => {
    const fautifs: string[] = []
    for (const chemin of fichiers) {
      const source = readFileSync(chemin, 'utf-8')
      if (!estUseServer(source)) continue
      if (REEXPORT_DE_TYPE.test(source)) {
        fautifs.push(chemin.slice(process.cwd().length + 1))
      }
    }
    // Le message d'échec doit suffire à comprendre sans ouvrir ce fichier.
    expect(
      fautifs,
      fautifs.length === 0
        ? ''
        : `Ces fichiers 'use server' réexportent un type (« export type { … } ») : `
          + `${fautifs.join(', ')}. Le transformateur en fait un export runtime `
          + `d'un symbole inexistant → ReferenceError et page blanche en production. `
          + `Importe le type depuis son module d'origine à la place.`,
    ).toEqual([])
  })
})
