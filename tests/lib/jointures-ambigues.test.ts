// ============================================================
// Une jointure ambiguë rend une liste VIDE, en silence
// ============================================================
// L'INCIDENT — trouvé le 2026-08-25, en cherchant pourquoi le panneau
// « Absences à venir » du secrétariat restait vide alors que la base contenait
// quatorze congés validés à venir.
//
// La réponse de PostgREST, mesurée avec le vrai jeton :
//
//     {"code":"PGRST201","details":[
//       {"embedding":"conges with veterinaires","relationship":"conges_saisi_par_fkey…"},
//       {"embedding":"conges with veterinaires","relationship":"conges_valide_par_fkey…"},
//       {"embedding":"conges with veterinaires","relationship":"conges_veterinaire_id_fkey…"}]}
//
// `conges` porte TROIS liens vers `veterinaires` : le titulaire, celui qui a
// saisi, celui qui a validé. Écrire `veterinaires(...)` laisse trois chemins
// possibles — PostgREST refuse la requête ENTIÈRE et rend une erreur. Pour du
// code qui ne lit pas son `error`, cela ressemble trait pour trait à « il n'y
// a rien ». C'est la leçon `supabase-erreur-avalée-devient-zéro-ligne`, dans
// sa version la plus discrète : la requête n'est pas fausse, elle est
// AMBIGUË, et rien ne le dit à l'écran.
//
// CE QUE ÇA A COÛTÉ : la requête des congés de l'écran planning date du
// 2026-07-25. Elle n'a JAMAIS fonctionné. Pendant un mois, aucun congé ne s'est
// affiché dans les cases du planning — pour personne, administratrice comprise
// — et personne ne l'a remarqué, puisqu'un planning sans congé affiché
// ressemble à un planning où personne n'est absent.
//
// CE QUE CE TEST GARDE : sur toute table qui a PLUSIEURS chemins vers
// `veterinaires`, la relation doit être nommée (`veterinaires!la_fkey(...)`)
// ou aliasée par colonne (`demandeur:demandeur_id(...)`).
//
// Aucune connexion réseau : on lit les sources.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Les tables qui ont PLUS D'UN lien vers `veterinaires`, relevées en base le
 * 2026-08-25 :
 *
 *   conges              3  (veterinaire_id, saisi_par, valide_par)
 *   gardes_exceptions   3  (veterinaire_id, remplace_id, cree_par)
 *   absences            2  (veterinaire_id, declaree_par)
 *   compensations       2  (remplacant_id, remplace_id)
 *   echanges_gardes     2  (demandeur_id, cible_id)
 *   gardes              2  (premier_id, second_id)
 *
 * Pour régénérer cette liste :
 *
 *   select c.conrelid::regclass, count(*)
 *   from pg_constraint c
 *   where c.contype='f' and c.confrelid='public.veterinaires'::regclass
 *   group by 1 having count(*) > 1;
 *
 * Toute table qui gagne un second lien doit être ajoutée ici le même jour.
 */
const TABLES_AMBIGUES = [
  'conges',
  'gardes_exceptions',
  'absences',
  'compensations',
  'echanges_gardes',
  'gardes',
] as const

const RACINE = join(__dirname, '..', '..', 'src')

function fichiersSources(dossier: string): string[] {
  const trouves: string[] = []
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree)
    if (statSync(chemin).isDirectory()) {
      trouves.push(...fichiersSources(chemin))
    } else if (/\.tsx?$/.test(entree)) {
      trouves.push(chemin)
    }
  }
  return trouves
}

/** Retire les commentaires : ils PARLENT de ces jointures sans en être. */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n')
}

describe('Aucune jointure ambiguë vers les vétérinaires', () => {
  const fichiers = fichiersSources(RACINE)

  it('trouve bien les sources (le test ne passe pas à vide)', () => {
    expect(fichiers.length).toBeGreaterThan(100)
  })

  it('nomme la relation partout où plusieurs chemins existent', () => {
    const fautes: string[] = []

    for (const chemin of fichiers) {
      const source = sansCommentaires(readFileSync(chemin, 'utf8'))
      if (!TABLES_AMBIGUES.some((t) => source.includes(`from('${t}')`))) continue

      // On rattache chaque `veterinaires(...)` à SA requête, pas au fichier :
      // un même fichier interroge souvent plusieurs tables, et la jointure
      // n'est ambiguë que si elle part d'une table à plusieurs chemins.
      let tableCourante: string | null = null

      source.split('\n').forEach((ligne, i) => {
        const from = ligne.match(/\.from\(['"]([a-z_]+)['"]\)/)
        if (from) tableCourante = from[1]

        if (!tableCourante || !TABLES_AMBIGUES.includes(tableCourante as never)) return

        // `veterinaires(` non précédé de `!` (relation nommée) ni de `:`
        // (alias par colonne, ex. `demandeur:demandeur_id(prenom)`).
        if (!/(?<![!:\w])veterinaires\s*\(/.test(ligne)) return
        if (/from\(['"]veterinaires/.test(ligne)) return

        // Jointure IMBRIQUÉE dans une autre relation — par exemple
        // `garde_placements(place_index, veterinaires(prenom))`. Le chemin part
        // alors de `garde_placements`, qui n'a qu'un seul lien : rien
        // d'ambigu.
        //
        // ⚠️ `select` est EXCLU de ce motif : c'est la fonction qui porte la
        // requête, pas une relation. Sans cette exclusion, `.select('…,
        // veterinaires(prenom)')` passait pour une jointure imbriquée et le
        // test ne détectait plus rien — vérifié en réintroduisant la faute.
        if (/\b(?!select\b)\w+\s*\([^()]*veterinaires\s*\(/.test(ligne)) return

        fautes.push(`${chemin.replace(RACINE, 'src')}:${i + 1} → ${ligne.trim()}`)
      })
    }

    expect(
      fautes,
      'Jointure ambiguë : PostgREST refusera la requête (PGRST201) et le code lira une liste vide.\n' +
        'Nommer la relation, par exemple `veterinaires!conges_veterinaire_id_fkey(prenom)`.\n' +
        fautes.join('\n'),
    ).toHaveLength(0)
  })
})
