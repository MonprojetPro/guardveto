// ============================================================
// GARDE-FOU — aucune date ISO ne repart vers un écran
// ============================================================
// Le 2026-08-21, MiKL découvre dans la fenêtre de PUBLICATION :
//
//   « R16 : Anne-Sophie est en congé (2026-10-03→2026-10-03) mais de garde
//     le 2026-10-03 »
//
// Trois fois la même date, au format de stockage, au moment précis où l'on
// décide de diffuser un planning à sept vétérinaires. Corrigé — mais rien
// n'empêchait la prochaine règle ajoutée de refaire exactement pareil, et
// personne ne relit les `detail:` d'un validateur.
//
// Ce test lit le SOURCE des deux fichiers qui produisent ces phrases et refuse
// toute interpolation de date qui ne passe pas par `lib/dates-fr`. Il échoue au
// moment de l'écriture, pas six semaines plus tard devant un client.
//
// Même esprit que `tests/lib/colonnes-lues.test.ts` : on surveille le code
// source, parce que le défaut est invisible à l'exécution.
// ============================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RACINE = join(__dirname, '..', '..')

/**
 * Les fichiers dont les messages atterrissent SOUS LES YEUX DU CABINET.
 *
 * Ne pas y ajouter un module de diagnostic interne (`lib/ia/controleCoherence`
 * par exemple) : ses rapports sont lus par nous, en clair, et le format ISO y
 * est le bon choix.
 */
const SURVEILLES = [
  'src/engine/validation/validerPlanning.ts',
  'src/engine/rules/hard-constraints.ts',
]

/**
 * Les expressions qui, interpolées, produisent une date ISO à l'écran.
 * On cible les NOMS de variables du domaine, pas un motif de date : le défaut
 * est dans `${a.date}`, pas dans la chaîne « 2026-10-03 » qu'on n'écrit jamais
 * en dur.
 */
const SUSPECTES = /\$\{([^}]*\b(?:date|date_debut|date_fin)\b[^}]*)\}/g

/** Les fonctions qui rendent une date lisible. Leur présence lave le soupçon. */
const AUTORISEES = /\b(?:dateFr|dateFrCourte|dateFrSansJour|periodeFr)\s*\(/

describe('aucune date ISO ne doit atteindre un écran', () => {
  for (const fichier of SURVEILLES) {
    it(`${fichier} formate toutes ses dates en français`, () => {
      const source = readFileSync(join(RACINE, fichier), 'utf-8')
      const fautives: string[] = []

      for (const ligne of source.split('\n')) {
        // Seules les lignes qui composent un message pour l'écran nous
        // intéressent : `detail:` (validateur) et `invalid(` (contraintes).
        const estMessage = /\bdetail:\s*`/.test(ligne) || /\binvalid\(\s*`/.test(ligne)
        if (!estMessage) continue

        for (const [, expression] of ligne.matchAll(SUSPECTES)) {
          // `datesWe[i]` et consorts comptent aussi : c'est bien une date.
          if (!AUTORISEES.test(expression)) {
            fautives.push(`\${${expression}}`)
          }
        }
      }

      expect(
        fautives,
        `Date brute servie à l'écran dans ${fichier}. Passe-la par `
        + `dateFr() / periodeFr() de « @/lib/dates-fr » :\n  `
        + fautives.join('\n  '),
      ).toEqual([])
    })
  }
})
