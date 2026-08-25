// ============================================================
// Le tableau sait-il tout ce qui attend quelqu'un ?
// ============================================================
// LA QUESTION DE MiKL, le 2026-08-25, devant « Rien à vérifier » :
//
//   « Comment ça se fait qu'il y a encore des trucs comme ça en attente
//    et que je ne le sais que si je demande ? »
//
// CE QUI S'ÉTAIT PASSÉ : le coup d'œil du matin regardait deux choses — la
// garde du soir et la cohérence du planning — et disait « rien à vérifier ».
// C'était vrai de ces deux-là. Pendant ce temps, un échange proposé, un
// échange accepté en attente de validation et une dette de dépannage
// dormaient sans que rien ne les signale nulle part.
//
// La cause n'était pas un oubli isolé : le tableau n'avait jamais eu de liste
// maîtresse de ce qui attend quelqu'un. Chaque fiche avait été ajoutée le
// jour où l'on travaillait sur son sujet, donc chaque capacité livrée depuis
// était arrivée sans la sienne. Rien ne posait la question.
//
// CE QUE CE TEST FAIT, ET CE QU'IL NE FAIT PAS.
//
// Il ne force PAS à tout afficher : un tableau qui remonte tout ne remonte
// plus rien. Il force la DÉCISION — pour chaque état du produit dans lequel
// une chose peut rester en plan, quelqu'un a écrit ce que le tableau en fait :
// une fiche, un manque assumé, ou un hors-périmètre motivé.
//
// La seule chose interdite est le silence. C'est exactement ce qui manquait :
// personne n'avait décidé que les échanges ne remonteraient pas, on avait
// simplement oublié la question.
//
// Aucune connexion réseau : on lit les sources.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ATTENTES, fichesCitees, trousDAffichage } from '@/lib/produit/attentes'
import { FICHES } from '@/data/v2/enAttente'

const TYPES = join(__dirname, '..', '..', 'src', 'types', 'index.ts')

/**
 * Recompose, depuis les types eux-mêmes, tous les états du produit.
 *
 * LA CONVENTION QUI REND CE TEST POSSIBLE : dans ce produit, tout ce qui
 * attend quelqu'un est un statut, et tout statut s'écrit
 * `export type Statut<Quelque chose> = 'a' | 'b' | …` dans `types/index.ts`.
 * On n'a donc rien à maintenir en double : ajouter une valeur, en retirer une
 * ou créer un domaine entier change mécaniquement la liste attendue.
 *
 * Le jour où quelqu'un déclare un statut ailleurs, ce test ne le verra pas —
 * c'est la limite assumée, et c'est aussi pourquoi la convention est écrite
 * en toutes lettres ici et dans `lib/produit/attentes.ts`.
 */
function etatsDuProduit(): string[] {
  const source = readFileSync(TYPES, 'utf8')
  const cles: string[] = []
  const unions = source.matchAll(/^export type (Statut\w+)\s*=\s*([^\n;]+(?:\n\s*\|[^\n;]+)*)/gm)
  for (const [, nom, corps] of unions) {
    for (const [, valeur] of corps.matchAll(/'([^']+)'/g)) {
      cles.push(`${nom}.${valeur}`)
    }
  }
  return cles
}

describe('Couverture des attentes — le tableau ne peut plus se taire', () => {
  it('trouve bien les statuts dans les types (le test se teste lui-même)', () => {
    // Un jour, quelqu'un reformatera `types/index.ts` et l'expression
    // régulière ne trouvera plus rien. Sans ce garde-fou, TOUS les autres
    // contrôles passeraient au vert sur une liste vide — le test le plus
    // dangereux qui soit : celui qui rassure sans rien vérifier.
    const etats = etatsDuProduit()
    expect(etats.length).toBeGreaterThan(10)
    expect(etats).toContain('StatutConge.souhait')
    expect(etats).toContain('StatutEchange.proposee')
    expect(etats).toContain('StatutCompensation.a_compenser')
  })

  it('chaque état du produit a une décision écrite', () => {
    const sansDecision = etatsDuProduit().filter((cle) => !(cle in ATTENTES))

    expect(
      sansDecision,
      sansDecision.length === 0
        ? ''
        : [
            '',
            "Ces états du produit peuvent laisser quelque chose en attente, et personne",
            "n'a dit ce que le tableau en fait :",
            ...sansDecision.map((c) => `    ${c}`),
            '',
            'Ouvre src/lib/produit/attentes.ts et ajoute une ligne par état. Trois',
            'réponses possibles, aucune n\'est mauvaise :',
            "    { fiche: 'ma-fiche' }  — ça attend quelqu'un, voici la fiche",
            "    { manque: '…' }        — ça attend quelqu'un, pas encore affiché",
            "    { hors: '…' }          — personne n'attend rien, et voici pourquoi",
            '',
            "La seule réponse interdite est de ne pas répondre : c'est comme ça que",
            'les échanges de gardes sont restés invisibles pendant deux mois.',
            '',
          ].join('\n'),
    ).toEqual([])
  })

  it('aucune décision ne porte sur un état qui a disparu', () => {
    // Le sens inverse compte autant. Un statut supprimé dont la ligne reste
    // laisse croire que le sujet est traité, et fait grossir un registre que
    // plus personne n'ose relire.
    const etats = new Set(etatsDuProduit())
    const fantomes = Object.keys(ATTENTES).filter((cle) => !etats.has(cle))

    expect(
      fantomes,
      fantomes.length === 0
        ? ''
        : [
            '',
            "Ces décisions portent sur des états qui n'existent plus dans",
            'src/types/index.ts — retire-les de src/lib/produit/attentes.ts :',
            ...fantomes.map((c) => `    ${c}`),
            '',
          ].join('\n'),
    ).toEqual([])
  })

  it('chaque fiche citée existe vraiment dans le catalogue', () => {
    // Une clé mal orthographiée déclarerait un affichage qui n'a jamais lieu.
    // C'est le pire cas possible ici : le registre annoncerait une couverture
    // inexistante, donc exactement la fausse assurance qu'il doit empêcher.
    const connues = new Set(FICHES.map((f) => f.cle))
    const inconnues = fichesCitees().filter((cle) => !connues.has(cle))

    expect(
      inconnues,
      inconnues.length === 0
        ? ''
        : [
            '',
            'Ces fiches sont citées par le registre mais ne sont définies nulle part',
            'dans src/data/v2/enAttente.ts :',
            ...inconnues.map((c) => `    ${c}`),
            '',
            "Soit la clé est mal orthographiée, soit la fiche reste à écrire.",
            '',
          ].join('\n'),
    ).toEqual([])
  })

  it('aucune fiche du catalogue n\'est orpheline', () => {
    // Une fiche que plus aucun état ne cite s'affiche encore, mais pour un
    // motif que personne ne saurait plus expliquer.
    const citees = new Set(fichesCitees())
    const orphelines = FICHES.filter((f) => !citees.has(f.cle)).map((f) => f.cle)

    expect(
      orphelines,
      orphelines.length === 0
        ? ''
        : [
            '',
            "Ces fiches ne sont réclamées par aucun état du produit :",
            ...orphelines.map((c) => `    ${c}`),
            '',
            'Soit un état devrait les citer dans src/lib/produit/attentes.ts,',
            'soit elles ne servent plus.',
            '',
          ].join('\n'),
    ).toEqual([])
  })

  it('les manques assumés restent peu nombreux et motivés', () => {
    const trous = trousDAffichage()

    // Un registre où tout est « manque » aurait la forme du contrôle sans en
    // avoir l'effet. Le seuil n'est pas une science : il est là pour que
    // l'empilement se voie AVANT d'être une habitude.
    expect(
      trous.length,
      `${trous.length} états attendent quelqu'un sans rien afficher :\n` +
        trous.map((t) => `    ${t.cle} — ${t.raison}`).join('\n'),
    ).toBeLessThanOrEqual(3)

    // Une raison creuse (« TODO », « à voir ») ne vaut pas mieux qu'un
    // silence : elle le déguise.
    for (const t of trous) {
      expect(t.raison.length, `La raison de ${t.cle} est trop courte pour être défendue`)
        .toBeGreaterThan(60)
    }
  })
})
