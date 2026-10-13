// ============================================================
// Aucun lecteur d'absence ne peut se taire sur le PÉRIMÈTRE (B-163)
// ============================================================
// L'EXIGENCE — MiKL, le 13/10 :
//
//   « je compte sur toi pour faire ce qu'il faut et repérer les trous dans la
//    raquette. Il faut que systématiquement tu te poses la question : là j'ai
//    fait ça pour cet endroit, est-ce qu'il y a d'autres endroits concernés »
//
// 🔴 CE TEST EXISTE PARCE QUE LA RÉPONSE A ÉTÉ « NON » DEUX FOIS.
//
//   · B-043, août — le formulaire offrait « Matin / Après-midi / Journée /
//     Soirée » et le moteur ne lisait pas le champ. Une matinée posée retirait
//     la garde du soir, en silence. Le champ a été supprimé.
//   · B-160a, le 13/10 — le retrait des présences était branché sur deux
//     chemins d'écriture sur quatre, dont pas celui que l'administratrice
//     utilise. Mesuré en base, pas deviné.
//
// Dans les deux cas, chaque correctif réparait SON endroit et annonçait le
// problème réglé. Rien ne posait la question « et les autres ? ».
//
// ── CE QU'IL VÉRIFIE, ET CE QU'IL NE PEUT PAS VÉRIFIER ─────────────────────
//
// ✅ Tout fichier de `src/` qui lit `conges` ou `absences` a une DÉCISION écrite
//    dans `lib/produit/perimetres-lus.ts`. Dans les deux sens : un fichier
//    ajouté sans décision échoue, une décision orpheline échoue aussi.
//
// ⚠️ IL NE JUGE PAS SI LA DÉCISION EST VRAIE. Un fichier déclaré `decide` qui ne
//    lirait pas vraiment le périmètre passerait — comme toute gate structurelle,
//    il force le geste, donc la relecture, pas la sincérité. C'est la même
//    limite que `couverture-juges`, `couverture-attentes` et
//    `filou-couverture-produit`, et elle est assumée : ce qui l'empêche, c'est
//    que la décision soit ÉCRITE sous les yeux de quelqu'un.
//
//    Mais pour les `decide` et les `ecrit`, on peut faire mieux que rien, et on
//    le fait : le dernier cas exige que le fichier importe réellement
//    l'autorité du périmètre. Une décision qui prétend lire sans importer est
//    forcément fausse.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PERIMETRES_LUS } from '../../src/lib/produit/perimetres-lus'

const SRC = join(__dirname, '..', '..', 'src')
const EXTS = ['.ts', '.tsx']

/** Les deux tables qui portent une indisponibilité. */
const LIT_UNE_TABLE = ["from('conges')", "from('absences')"]

/** L'autorité unique sur ce qu'une absence couvre. */
const L_AUTORITE = 'lib/absences/perimetre'

/**
 * Le registre se citerait lui-même : ses commentaires nomment les tables. On
 * l'exclut par son nom plutôt que par un motif rusé — on veut pouvoir écrire
 * `from('conges')` en clair dans sa documentation.
 */
const LE_REGISTRE = 'lib/produit/perimetres-lus.ts'

function fichiers(racine: string): string[] {
  const out: string[] = []
  const marcher = (dir: string) => {
    for (const nom of readdirSync(dir)) {
      const chemin = join(dir, nom)
      if (statSync(chemin).isDirectory()) {
        // Les tests ne décident rien : ils fabriquent des cas.
        if (nom === '__tests__') continue
        marcher(chemin)
      } else if (EXTS.some((e) => nom.endsWith(e)) && !nom.includes('.test.')) {
        out.push(chemin)
      }
    }
  }
  marcher(racine)
  return out
}

/** Les lecteurs réels, chemin depuis `src/` en barres obliques. */
function lecteursReels(): Map<string, string> {
  const out = new Map<string, string>()
  for (const chemin of fichiers(SRC)) {
    const source = readFileSync(chemin, 'utf8')
    if (!LIT_UNE_TABLE.some((m) => source.includes(m))) continue
    const cle = relative(SRC, chemin).split('\\').join('/')
    if (cle === LE_REGISTRE) continue
    out.set(cle, source)
  }
  return out
}

function fichierExiste(cleDepuisSrc: string): boolean {
  try {
    return statSync(join(SRC, cleDepuisSrc)).isFile()
  } catch {
    return false
  }
}

describe('Le recensement des lecteurs d’absence', () => {
  it('a une décision pour CHAQUE lecteur de `conges` ou `absences`', () => {
    const manquants = [...lecteursReels().keys()].filter((f) => !(f in PERIMETRES_LUS))

    expect(
      manquants,
      'Ces fichiers lisent `conges` ou `absences` sans qu’aucune décision ne dise ce\n'
        + 'qu’ils font du PÉRIMÈTRE de l’absence. C’est exactement le trou par lequel\n'
        + 'B-043 puis B-160a sont passés : un lecteur de plus, et personne pour poser\n'
        + 'la question.\n\n'
        + '➜ Ajoute une ligne par fichier dans `src/lib/produit/perimetres-lus.ts` :\n'
        + '  `decide`, `affiche`, `ecrit`, `delegue`, `manque` ou `hors`.\n'
        + '  La seule chose interdite est le silence :\n  '
        + manquants.join('\n  '),
    ).toEqual([])
  })

  it('n’a aucune décision orpheline', () => {
    // Une entrée qui désigne un fichier disparu est pire qu'une entrée absente :
    // elle donne l'impression d'une couverture qui n'existe plus.
    const orphelines = Object.keys(PERIMETRES_LUS).filter((f) => !fichierExiste(f))

    expect(
      orphelines,
      'Ces décisions désignent des fichiers qui n’existent plus. Une couverture\n'
        + 'qui parle d’un fichier disparu rassure à tort :\n  '
        + orphelines.join('\n  '),
    ).toEqual([])
  })

  it('chaque `decide` et chaque `ecrit` importe RÉELLEMENT l’autorité du périmètre', () => {
    // 🔑 LE SEUL CONTRÔLE DE SINCÉRITÉ QU'UNE GATE STRUCTURELLE PERMET ICI.
    //    Déclarer « je lis le périmètre » sans importer `lib/absences/perimetre`
    //    est forcément faux : la règle ne vit nulle part ailleurs. C'est la
    //    parade au défaut de B-043, où la règle vivait dans un écran.
    const sources = lecteursReels()
    const menteurs: string[] = []

    for (const [fichier, decision] of Object.entries(PERIMETRES_LUS)) {
      if (!('perimetre' in decision)) continue
      if (decision.perimetre !== 'decide' && decision.perimetre !== 'ecrit') continue
      const source = sources.get(fichier)
      if (source && !source.includes(L_AUTORITE)) menteurs.push(fichier)
    }

    expect(
      menteurs,
      'Ces fichiers se déclarent `decide` ou `ecrit` sur le périmètre, mais\n'
        + `n’importent pas \`${L_AUTORITE}\`. Ils décident donc d’après une règle\n`
        + 'écrite ailleurs — c’est le défaut exact de B-043, où le formulaire\n'
        + 'proposait un créneau que le moteur ne lisait pas :\n  '
        + menteurs.join('\n  '),
    ).toEqual([])
  })

  it('le gardien n’est pas muet — sondé sur un faux lecteur', () => {
    // Un gardien muet et un gardien sain sont indiscernables de l'extérieur :
    // c'est la leçon des trois mois. On lui donne un cas fautif fabriqué et on
    // exige qu'il le voie.
    const fauxLecteur = "const x = await supabase.from('conges').select('id')"
    expect(LIT_UNE_TABLE.some((m) => fauxLecteur.includes(m))).toBe(true)
    expect('lib/produit/inconnu.ts' in PERIMETRES_LUS).toBe(false)
  })

  it('recense au moins les lecteurs connus au 13/10', () => {
    // Une détection qui tomberait à zéro (motif cassé, dossier déplacé) rendrait
    // le test vert sans rien vérifier — c'est le `swarm_status` du contrôle
    // qualité : il répond même quand rien ne marche.
    expect(lecteursReels().size).toBeGreaterThanOrEqual(15)
  })
})
