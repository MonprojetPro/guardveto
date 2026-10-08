// ============================================================
// Aucun chantier ne peut partir chez le client sans decision
// ============================================================
// L'EXIGENCE — MiKL, le 2026-10-08, apres avoir vu un renouveau visuel arriver
// sur le compte de son client :
//
//   « je croyais avoir ete clair, qu il n y aurait que les bacs a sable qui
//    seraient affectes »
//
// POURQUOI UNE CONSIGNE NE SUFFISAIT PAS — c'est tout le sujet.
//
// La consigne avait ete donnee. Elle n'a pas ete appliquee, et surtout : ELLE
// N'AURAIT PAS PU L'ETRE. `PlanningV2.tsx:1060` rendait `<GrilleSemaines>` sans
// aucune condition, et `cabinets.est_bac_a_sable` — qui existait depuis B-090 —
// n'etait lue qu'a un seul endroit, pour afficher un bandeau. Il n'y avait ni
// drapeau, ni chemin de rendu alternatif : la consigne n'avait aucune prise sur
// le code.
//
// C'est le mecanisme exact de FILOU SUIT LE PRODUIT et de LE TABLEAU NE PEUT
// PAS SE TAIRE : une consigne qu'aucun garde-fou ne porte est une consigne deja
// oubliee. Les deux ont ete reparees par un REFUS automatique, jamais en
// reecrivant la consigne. Celle-ci l'est de meme.
//
// CE QUE CE TEST FAIT : il pose une convention — tout composant d'un chantier
// en cours vit sous `src/components/chantier/` — et verifie que personne ne
// peut le rendre sans avoir CONSULTE la porte (`chantierOuvert`). Il verifie
// aussi, dans l'autre sens, que la porte se ferme par defaut.
//
// CE QU'IL NE PEUT PAS FAIRE : juger que la condition est la BONNE. Il voit que
// l'appelant consulte la porte, pas qu'il en respecte la reponse. Comme toute
// gate structurelle, il force le geste — donc la relecture — pas la sincerite.
//
// Aucune connexion reseau : on lit les fichiers.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CHANTIERS, chantierOuvert } from '../../src/lib/produit/chantiers'

const SRC = join(__dirname, '..', '..', 'src')
const DOSSIER_CHANTIER = join(SRC, 'components', 'chantier')
const EXTS = ['.ts', '.tsx']

/** Le nom de la fonction qu'un appelant doit citer pour avoir le droit de rendre. */
const LA_PORTE = 'chantierOuvert'

/**
 * La regle, isolee pour pouvoir etre SONDEE.
 *
 * Un gardien muet et un gardien sain sont indiscernables de l'exterieur — c'est
 * la lecon des 3 mois, et celle de B-146 (un garde-fou qui ne lisait qu'une des
 * trois ecritures du padding). On ne se contente donc pas de voir ce test
 * passer sur le code reel : on lui donne un faux fichier fautif et on exige
 * qu'il le refuse.
 */
export function rendUnChantierSansLaPorte(
  cheminRelatif: string,
  source: string,
  composantsDeChantier: string[],
): boolean {
  if (cheminRelatif.startsWith('components/chantier/')) return false
  const importeUnChantier = composantsDeChantier.some((c) => source.includes(`@/${c}`))
  if (!importeUnChantier) return false
  return !source.includes(LA_PORTE)
}

function fichiers(racine: string): string[] {
  const out: string[] = []
  const marcher = (dir: string) => {
    for (const nom of readdirSync(dir)) {
      const chemin = join(dir, nom)
      if (statSync(chemin).isDirectory()) marcher(chemin)
      else if (EXTS.some((e) => nom.endsWith(e))) out.push(chemin)
    }
  }
  marcher(racine)
  return out
}

describe('La porte des chantiers', () => {
  it('ferme un chantier inconnu — une faute de frappe ne livre jamais au client', () => {
    expect(chantierOuvert('planning-grille-v3', { estBacASable: true })).toBe(false)
    expect(chantierOuvert('', { estBacASable: true })).toBe(false)
  })

  it('ferme un chantier restreint quand le cabinet n’est pas un bac a sable', () => {
    expect(chantierOuvert('planning-grille-v2', { estBacASable: false })).toBe(false)
  })

  it('ouvre un chantier restreint sur un bac a sable', () => {
    expect(chantierOuvert('planning-grille-v2', { estBacASable: true })).toBe(true)
  })

  it('n’ouvre pas sur une valeur approchante de `true` — le test est strict', () => {
    // Une lecture Supabase qui renverrait une chaine, un 1, ou `undefined` ne
    // doit pas valoir `true`. C'est la porte d'entree des fausses ouvertures :
    // `if (valeur)` aurait laisse passer la chaine « false ».
    const douteux = ['true', 1, 'oui', {}, []] as unknown[]
    for (const v of douteux) {
      expect(
        chantierOuvert('planning-grille-v2', { estBacASable: v as boolean }),
      ).toBe(false)
    }
  })
})

describe('Le catalogue des chantiers', () => {
  it('cite un item de board pour chaque chantier — la filiation reste lisible', () => {
    const board = readFileSync(
      join(__dirname, '..', '..', 'docs', '00-product-board.md'),
      'utf8',
    )
    for (const [id, c] of Object.entries(CHANTIERS)) {
      expect(c.item, `le chantier « ${id} » doit citer son item de board`).toMatch(
        /^B-\d+[a-z]?$/,
      )
      expect(
        board.includes(`| ${c.item} |`),
        `l'item ${c.item} du chantier « ${id} » doit exister au board`,
      ).toBe(true)
    }
  })

  it('date chaque chantier — un chantier sans date est un chantier qu’on oublie', () => {
    for (const [id, c] of Object.entries(CHANTIERS)) {
      expect(c.depuis, `le chantier « ${id} »`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(c.nom.length, `le chantier « ${id} »`).toBeGreaterThan(3)
    }
  })
})

describe('Les composants de chantier', () => {
  it('vivent tous sous src/components/chantier/', () => {
    // La convention est ce qui rend le test possible. Sans elle, il faudrait
    // deviner quels composants appartiennent a un chantier — et deviner, c'est
    // exactement ce qui a rate le 08/10.
    expect(statSync(DOSSIER_CHANTIER).isDirectory()).toBe(true)
  })

  it('ne sont importes QUE par des fichiers qui consultent la porte', () => {
    const duChantier = fichiers(DOSSIER_CHANTIER).map((f) =>
      relative(SRC, f).replace(/\\/g, '/').replace(/\.(ts|tsx)$/, ''),
    )
    expect(
      duChantier.length,
      'le dossier chantier ne doit pas etre vide tant qu un chantier est ouvert',
    ).toBeGreaterThan(0)

    const fautifs: string[] = []

    for (const fichier of fichiers(SRC)) {
      const rel = relative(SRC, fichier).replace(/\\/g, '/')
      // Un fichier DEJA sous `chantier/` est derriere la porte : ses imports
      // internes n'ont pas a la reconsulter.
      if (rel.startsWith('components/chantier/')) continue

      const source = readFileSync(fichier, 'utf8')
      if (rendUnChantierSansLaPorte(rel, source, duChantier)) fautifs.push(rel)
    }

    expect(
      fautifs,
      `Ces fichiers rendent un composant de chantier sans consulter « ${LA_PORTE} ». ` +
        `C'est exactement le defaut du 08/10 (B-151) : un renouveau visuel qui part ` +
        `chez le client parce que rien ne pouvait l'en empecher. Lire le contexte via ` +
        `chantierOuvertPourLeCabinet(), et ne rendre que si la porte est ouverte.`,
    ).toEqual([])
    // ⚠️ 30 s, et pas le défaut de 5 s. Ce test lit TOUS les fichiers de `src/`
    //    (~800) : seul, il tourne en moins d'une seconde ; lancé en parallèle
    //    des 190 autres fichiers de la suite, il attend le disque. Un gardien
    //    qui rougit par contention est pire qu'inutile — on apprend à ignorer
    //    sa couleur, et le jour où il a raison, personne ne regarde.
  }, 30_000)

  it('DETECTE vraiment un fautif — la sonde, sans quoi ce test pourrait etre muet', () => {
    const faux = ['components/chantier/GrilleV2']

    // ① Le cas du 08/10, reproduit : on rend le composant, sans rien consulter.
    expect(
      rendUnChantierSansLaPorte(
        'app/(v2)/planning/page.tsx',
        `import { GrilleV2 } from '@/components/chantier/GrilleV2'\nreturn <GrilleV2 />`,
        faux,
      ),
      'un rendu sans condition DOIT etre refuse — si cette ligne passe, le gardien est muet',
    ).toBe(true)

    // ② Le meme fichier, mais qui consulte la porte : accepte.
    expect(
      rendUnChantierSansLaPorte(
        'app/(v2)/planning/page.tsx',
        `import { GrilleV2 } from '@/components/chantier/GrilleV2'\n` +
          `const ok = chantierOuvert('x', ctx)\nreturn ok && <GrilleV2 />`,
        faux,
      ),
    ).toBe(false)

    // ③ Un fichier qui n'importe aucun chantier n'est pas concerne.
    expect(
      rendUnChantierSansLaPorte('app/(v2)/equipe/page.tsx', `const a = 1`, faux),
    ).toBe(false)

    // ④ Un fichier DEJA sous chantier/ est derriere la porte.
    expect(
      rendUnChantierSansLaPorte(
        'components/chantier/Case.tsx',
        `import { GrilleV2 } from '@/components/chantier/GrilleV2'`,
        faux,
      ),
    ).toBe(false)
  })
})
