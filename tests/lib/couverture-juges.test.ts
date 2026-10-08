// ============================================================
// Aucun lecteur de `gardes` ne peut se taire sur les remplacements
// ============================================================
// L'EXIGENCE — MiKL, le 2026-10-08, apres une journee a trois incidents :
//
//   « je voudrais que tu refasses un point sur tous les juges et controles qui
//    existent et qui signalent [...] et je suis sur qu il y a encore plein de
//    zones d ombre »
//
// Il y en avait huit.
//
// POURQUOI UN TEST ET PAS UNE CONSIGNE — c'est tout le sujet.
//
// La consigne existait : INSPECTION DES CONSUMERS, ecrite dans le CLAUDE.md,
// appliquee depuis des mois. Elle a ete sautee DEUX FOIS dans la meme journee,
// par la meme personne, sur le meme defaut. Le matin : `casesAPourvoir` corrige,
// probleme annonce regle, aucun autre lecteur cherche. Une heure plus tard, MiKL
// renvoie une capture : « pkoi il continue a dire qu il y a personne le 14 ? ».
//
// Une consigne qu'aucun garde-fou ne porte est une consigne deja oubliee. C'est
// la lecon de FILOU SUIT LE PRODUIT et de LE TABLEAU NE PEUT PAS SE TAIRE : les
// deux ont ete reparees par un REFUS automatique, jamais en reecrivant la
// consigne. Celle-ci l'est de meme.
//
// CE QUE CE TEST FAIT : il recense tout fichier de `src/` qui lit la table
// `gardes`, et exige une decision ecrite dans `lib/produit/juges.ts`. Dans les
// DEUX SENS — un lecteur ajoute sans decision echoue, une decision qui designe
// un fichier disparu echoue aussi. Il verifie en plus la SINCERITE minimale des
// deux reponses verifiables : qui se declare `brique` importe la brique, qui se
// declare `vue` cite bien une source qui porte les remplacements.
//
// CE QU'IL NE PEUT PAS FAIRE : prouver que le code est APPELE sur le bon chemin.
// Un grep prouve qu'un code est ecrit, jamais qu'il est execute (lecon payee sur
// B-146). Il force le geste — donc la relecture — pas l'implementation juste.
// C'est pour cela que les regles qui portaient les defauts ont ete extraites en
// fonctions PURES, testees a cote.
//
// Aucune connexion reseau : on lit les fichiers.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  JUGES,
  juges_quiIgnorentLesRemplacements,
  juges_surLaBrique,
  juges_surLaVue,
} from '../../src/lib/produit/juges'

const SRC = join(__dirname, '..', '..', 'src')
const EXTS = ['.ts', '.tsx']

/** La marque d'un lecteur de la table. Une seule forme dans tout le projet. */
const LIT_LA_TABLE = "from('gardes')"

/** La brique partagee — ce que doit importer qui se declare `brique`. */
const LA_BRIQUE = 'lib/gardes/exceptions-jour'

/** Les sources qui portent REELLEMENT les remplacements, en SQL ou en direct. */
const SOURCES_QUI_LES_PORTENT = ['planning_semaine', 'gardes_exceptions']

function fichiers(racine: string): string[] {
  const out: string[] = []
  const marcher = (dir: string) => {
    for (const nom of readdirSync(dir)) {
      const chemin = join(dir, nom)
      if (statSync(chemin).isDirectory()) {
        // Les tests ne jugent rien : ils fabriquent des cas.
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

/**
 * Le registre lui-meme cite le motif dans ses commentaires : il se recenserait
 * tout seul. Exclusion nommee plutot que motif ruse — on veut pouvoir ecrire
 * `from('gardes')` en clair dans la documentation du registre.
 */
const LE_REGISTRE = 'lib/produit/juges.ts'

/** Les lecteurs reels, chemin depuis `src/` en barres obliques. */
function lecteursReels(): Map<string, string> {
  const out = new Map<string, string>()
  for (const chemin of fichiers(SRC)) {
    const source = readFileSync(chemin, 'utf8')
    if (!source.includes(LIT_LA_TABLE)) continue
    const cle = relative(SRC, chemin).split('\\').join('/')
    if (cle === LE_REGISTRE) continue
    out.set(cle, source)
  }
  return out
}

/**
 * Un juge peut ne PAS lire la table : il appelle un juge qui le fait. Sa ligne
 * reste utile — elle rend la chaine lisible de bout en bout — mais le controle
 * « orpheline » doit alors verifier que le fichier EXISTE, pas qu'il lise.
 *
 * Sans cette nuance, la seule facon de garder un registre vert serait de ne
 * jamais declarer les delegants : on perdrait precisement la vue d'ensemble que
 * MiKL a demandee.
 */
function fichierExiste(cleDepuisSrc: string): boolean {
  try {
    return statSync(join(SRC, cleDepuisSrc)).isFile()
  } catch {
    return false
  }
}

describe('Le recensement des juges', () => {
  it('a une decision pour CHAQUE lecteur de la table `gardes`', () => {
    const manquants = [...lecteursReels().keys()].filter((f) => !(f in JUGES))

    expect(
      manquants,
      `Ces fichiers lisent la table \`gardes\` sans qu'aucune decision ne dise ce ` +
        `qu'ils font des remplacements ponctuels. Ajoute une ligne par fichier dans ` +
        `src/lib/produit/juges.ts — \`remplacements\`, \`delegue\`, \`manque\` ou \`hors\`. ` +
        `La seule chose interdite est le silence :\n  ${manquants.join('\n  ')}`,
    ).toEqual([])
  })

  it('ne garde aucune decision orpheline — un fichier disparu ou renomme se voit', () => {
    const reels = new Set(lecteursReels().keys())
    const orphelines = Object.keys(JUGES).filter(
      (f) => !reels.has(f) && !('delegue' in JUGES[f] && fichierExiste(f)),
    )

    expect(
      orphelines,
      `Ces decisions designent des fichiers qui ne lisent plus la table \`gardes\` ` +
        `(supprimes, renommes, ou dont la lecture a change). Une decision qui ne ` +
        `porte plus sur rien donne une fausse assurance de couverture :\n  ${orphelines.join('\n  ')}`,
    ).toEqual([])
  })

  it('verifie que `brique` importe VRAIMENT la brique partagee', () => {
    const reels = lecteursReels()
    const menteurs = juges_surLaBrique().filter((f) => {
      const source = reels.get(f)
      return source !== undefined && !source.includes(LA_BRIQUE)
    })

    expect(
      menteurs,
      `Ces fichiers declarent appliquer les remplacements via la brique partagee, ` +
        `mais ne l'importent pas. Une declaration qui ne correspond a rien est pire ` +
        `qu'une absence de declaration — elle annonce une couverture inexistante :\n  ${menteurs.join('\n  ')}`,
    ).toEqual([])
  })

  it('verifie que `vue` cite VRAIMENT une source qui porte les remplacements', () => {
    const reels = lecteursReels()
    const menteurs = juges_surLaVue().filter((f) => {
      const source = reels.get(f)
      return (
        source !== undefined && !SOURCES_QUI_LES_PORTENT.some((s) => source.includes(s))
      )
    })

    expect(
      menteurs,
      `Ces fichiers declarent lire les remplacements eux-memes, sans citer ` +
        `\`planning_semaine\` ni \`gardes_exceptions\` :\n  ${menteurs.join('\n  ')}`,
    ).toEqual([])
  })

  it('date chaque manque — un manque sans date est un manque qu’on oublie', () => {
    // Un `manque` est un aveu assume, donc datable et defendable a voix haute.
    // Sans date, il devient indistinguable d'un oubli au bout de trois semaines
    // — c'est exactement la confusion que ce registre existe pour supprimer.
    for (const { fichier, raison } of juges_quiIgnorentLesRemplacements()) {
      expect(raison, `le manque de « ${fichier} »`).toMatch(/\d{4}-\d{2}-\d{2}/)
      expect(raison.length, `le manque de « ${fichier} » doit etre defendable`).toBeGreaterThan(60)
    }
  })

  it('garde la liste des manques COURTE — sinon le registre devient une decharge', () => {
    // Seuil volontairement bas : 4 au 2026-10-08 (echanges x3, loader, syncAttributions,
    // crise/contexte = 6 au depart, trois d'entre eux etant la meme famille). Le
    // relever doit etre une decision consciente, pas une derive silencieuse.
    expect(juges_quiIgnorentLesRemplacements().length).toBeLessThanOrEqual(6)
  })
})

describe('La sonde du recensement', () => {
  // Un gardien muet et un gardien sain sont indiscernables de l'exterieur —
  // c'est la lecon des 3 mois. On ne se contente pas de voir ce test passer sur
  // le code reel : on lui donne des cas fautifs et on exige qu'il les refuse.

  it('refuserait un nouveau lecteur non declare', () => {
    const faux = new Map([['data/nouveauJuge.ts', `supabase.from('gardes').select('*')`]])
    const manquants = [...faux.keys()].filter((f) => !(f in JUGES))
    expect(manquants).toEqual(['data/nouveauJuge.ts'])
  })

  it('refuserait un `brique` qui n’importe pas la brique', () => {
    const source = `supabase.from('gardes').select('premier_id')`
    expect(source.includes(LA_BRIQUE)).toBe(false)
  })

  it('refuserait un `vue` qui ne cite aucune source portant les remplacements', () => {
    const source = `supabase.from('gardes').select('premier_id')`
    expect(SOURCES_QUI_LES_PORTENT.some((s) => source.includes(s))).toBe(false)
  })

  it('voit bien les lecteurs reels — un scan qui ne trouve rien se tairait', () => {
    // Si le motif de detection cassait (refacto du client Supabase, par
    // exemple), le test passerait en silence sur une liste vide : le pire des
    // cas, un garde-fou qui ne garde plus rien sans le dire.
    const reels = lecteursReels()
    expect(reels.size).toBeGreaterThan(25)
    expect(reels.has('data/monterValidationPeriode.ts')).toBe(true)
    expect(reels.has('data/casesAPourvoir.ts')).toBe(true)
  })
})
