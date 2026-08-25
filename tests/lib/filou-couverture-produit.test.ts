// ============================================================
// Filou est-il au courant de ce que le produit sait faire ?
// ============================================================
// L'EXIGENCE — MiKL, le 2026-08-25 :
//
//   « Je veux absolument que ce soit systématiquement fait. Dès qu'une
//    fonctionnalité est ajoutée ou retirée, quoi que ce soit qui concerne
//    Filou, je veux qu'il soit automatiquement configuré pour. Ça devrait
//    déjà être le cas depuis le début, et je m'aperçois que non. »
//
// CE QUI S'ÉTAIT PASSÉ : l'onglet Assistance et le rôle Secrétariat ont été
// livrés le matin. Filou ne l'a su que le soir, parce que MiKL a demandé de
// vérifier. Et le symptôme n'était pas « il ne sait pas faire » — à la
// question « qui a accès au planning ? », il répondait la liste des
// vétérinaires, sans le secrétariat et sans que rien ne signale l'absence.
//
// CE QUE CE TEST FAIT, ET CE QU'IL NE FAIT PAS.
//
// Il ne force PAS Filou à tout savoir faire : ce serait bloquer chaque
// livraison sur un outil à écrire, et la règle finirait contournée. Il force
// la DÉCISION — pour chaque action serveur du produit, quelqu'un a écrit ce
// que Filou en fait : un outil, un manque assumé, ou un hors-périmètre motivé.
//
// La seule chose interdite est le silence. C'est exactement ce qui manquait :
// personne n'avait décidé que Filou ignorerait le secrétariat, on avait
// simplement oublié la question.
//
// Aucune connexion réseau : on lit les sources.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { COUVERTURE_FILOU, trousDeCouverture } from '@/lib/ia/couverture-produit'

const RACINE = join(__dirname, '..', '..', 'src')
const APP = join(RACINE, 'app')

/** Tous les fichiers d'actions serveur du produit. */
function fichiersDActions(dossier: string): string[] {
  const trouves: string[] = []
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree)
    if (statSync(chemin).isDirectory()) {
      trouves.push(...fichiersDActions(chemin))
    } else if (/actions\.ts$/.test(entree) || /-actions\.ts$/.test(entree)) {
      trouves.push(chemin)
    }
  }
  return trouves
}

/**
 * La clé d'une action : `<dossier sous app, sans parenthèses>#<fonction>`.
 *
 * Les parenthèses des groupes de routes Next (`(v2)`, `(protected)`) sont
 * retirées : elles n'apportent rien à la lecture et changeraient toutes les
 * clés le jour où un groupe est renommé.
 */
function clesDuFichier(chemin: string): string[] {
  const source = readFileSync(chemin, 'utf8')
  const prefixe = chemin
    .replace(APP, '')
    .replace(/\\/g, '/')
    .replace(/^\//, '')
    .replace(/\.ts$/, '')
    .replace(/\/actions$/, '')
    .replace(/[()]/g, '')

  return [...source.matchAll(/^export async function (\w+)/gm)].map(
    (m) => `${prefixe}#${m[1]}`,
  )
}

/** Les noms d'outils réellement enregistrés dans le catalogue de Filou. */
function outilsEnregistres(): Set<string> {
  const dossier = join(RACINE, 'lib', 'ia', 'outils')
  const noms = new Set<string>()
  for (const fichier of readdirSync(dossier)) {
    if (!fichier.endsWith('.ts')) continue
    const source = readFileSync(join(dossier, fichier), 'utf8')
    for (const m of source.matchAll(/nom: '([a-z_]+)'/g)) noms.add(m[1])
  }
  return noms
}

describe('Toute capacité du produit a été confrontée à Filou', () => {
  const actions = fichiersDActions(APP).flatMap(clesDuFichier)

  it('trouve bien les actions serveur (le test ne passe pas à vide)', () => {
    expect(actions.length).toBeGreaterThan(50)
  })

  it('aucune action serveur n’échappe à la décision', () => {
    const oubliees = actions.filter((a) => !(a in COUVERTURE_FILOU))

    expect(
      oubliees,
      'Ces actions viennent d’apparaître et personne n’a dit ce que Filou en fait.\n' +
        'Ouvre `src/lib/ia/couverture-produit.ts` et ajoute une ligne par action :\n' +
        "  { outil: 'nom_de_l_outil' }  — Filou sait le faire\n" +
        "  { manque: 'ce qui manquerait' } — pas encore, et c’est assumé\n" +
        "  { hors: 'pourquoi jamais' }   — hors de son périmètre\n\n" +
        oubliees.map((a) => `  '${a}': { … },`).join('\n'),
    ).toEqual([])
  })

  it('aucune ligne du registre ne désigne une action disparue', () => {
    // L'exigence porte sur les DEUX sens : « dès qu'une fonctionnalité est
    // ajoutée OU RETIRÉE ». Une entrée orpheline ferait croire à une
    // couverture qui n'a plus d'objet, et vieillirait sans qu'on le voie.
    const reelles = new Set(actions)
    const fantomes = Object.keys(COUVERTURE_FILOU).filter((c) => !reelles.has(c))

    expect(
      fantomes,
      'Ces actions ont disparu du produit : retire-les du registre, et vérifie ' +
        'au passage si un outil de Filou pointait dessus.\n' +
        fantomes.map((f) => `  ${f}`).join('\n'),
    ).toEqual([])
  })

  it('chaque outil cité existe vraiment dans le catalogue', () => {
    // Sans ce contrôle, une faute de frappe dans le registre déclarerait une
    // couverture qui n'existe pas — et le test passerait au vert en donnant
    // exactement la fausse assurance qu'il est censé empêcher.
    const catalogue = outilsEnregistres()
    const inconnus = Object.entries(COUVERTURE_FILOU)
      .filter((e): e is [string, { outil: string }] => 'outil' in e[1])
      .filter(([, c]) => !catalogue.has(c.outil))
      .map(([capacite, c]) => `${capacite} → « ${c.outil} » n’existe pas`)

    expect(inconnus, inconnus.join('\n')).toEqual([])
  })
})

describe('Ce que Filou ne couvre pas encore est VISIBLE', () => {
  it('les manques sont nommés et motivés', () => {
    // On ne cherche pas zéro manque — un produit avance plus vite que son
    // assistant. On cherche qu'aucun manque ne soit muet : chacun porte une
    // phrase qui dit ce qu'il coûte, ce qui en fait une liste de travail
    // plutôt qu'un constat.
    for (const { capacite, raison } of trousDeCouverture()) {
      expect(raison.length, `${capacite} : le manque n’est pas expliqué`).toBeGreaterThan(30)
    }
  })

  it('reste sous un seuil raisonnable', () => {
    // Un garde-fou de dérive, pas un objectif. Si Filou décroche du produit,
    // ce test le dit avant que l'écart devienne une refonte.
    const trous = trousDeCouverture()
    expect(
      trous.length,
      `${trous.length} capacités hors de portée de Filou :\n` +
        trous.map((t) => `  · ${t.capacite}`).join('\n'),
    ).toBeLessThanOrEqual(12)
  })
})
