// ============================================================
// Un numéro de règle doit désigner la MÊME règle des deux côtés
// ============================================================
// CE QUI EST ARRIVÉ — le 2026-08-26, MiKL en démonstration devant la cliente.
//
// Il demande à Filou de mettre en pause le repos du mardi de Victor. Filou
// rédige exactement ça… et l'encadré « ce que ça changerait », lui, annonce la
// mise en pause de « Anne-Catherine ne fait pas de garde le mercredi ». Une
// autre personne, un autre jour. Un clic de plus et la règle d'Anne-Catherine
// sautait.
//
// LA CAUSE — Filou ne désigne pas une règle par son identifiant, mais par son
// NUMÉRO DE POSITION dans la liste qu'on lui a montrée. Ce numéro n'a donc de
// sens que si les deux côtés lisent la MÊME liste dans le MÊME ordre :
//
//   · `lister_regles`    numérote  → « la n°13, c'est Victor, repos du lundi »
//   · `agir_sur_regles`  résout    → « la n°13, donc… »
//
// Or les deux avaient leur propre requête. L'une triait par `brique_id` seul,
// l'autre par `brique_id` puis `id`. Postgres ne garantit AUCUN ordre entre
// lignes de même `brique_id` — et ce cabinet a quatre `interdire_creneau`, six
// `equilibrer`, trois `repos_conditionnel`. Mesure sur les données réelles :
// 13 règles sur 22 changeaient de place, les quatre `interdire_creneau` étant
// intégralement inversées. C'est-à-dire, très exactement, la règle de Victor
// et celle d'Anne-Catherine.
//
// CE QUE CE TEST GARDE — pas le tri, l'UNICITÉ de la lecture. Ajouter
// `.order('id')` à la requête en double aurait corrigé le symptôme du jour et
// laissé le piège en place : deux requêtes qu'il faut penser à garder
// identiques finissent toujours par diverger. Le commentaire du code affirmait
// d'ailleurs déjà qu'elles l'étaient.
//
// Le test échoue donc si une SECONDE lecture de `regles_cabinet` réapparaît
// dans ce fichier, ou si la lecture unique perd son tri déterministe. Il ne
// vérifie pas un comportement : il vérifie qu'on n'a pas refabriqué la
// possibilité du défaut.
//
// Aucune connexion réseau : on lit le fichier source.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FICHIER = join(process.cwd(), 'src/lib/ia/outils/regles.ts')
const source = readFileSync(FICHIER, 'utf-8')

describe('Numérotation des règles de Filou', () => {
  it('ne lit `regles_cabinet` qu’à UN seul endroit', () => {
    // Chaque `.from('regles_cabinet')` est une liste potentiellement ordonnée
    // autrement. Deux occurrences = deux numérotations possibles = le défaut
    // du 26/08 reconstruit.
    const lectures = source.match(/\.from\(\s*'regles_cabinet'\s*\)/g) ?? []

    expect(
      lectures.length,
      "Deux lectures de `regles_cabinet` dans ce fichier : le numéro d'une règle " +
        "risque de ne plus designer la meme des deux cotes (cf. B-036). " +
        'Passer par `chargerReglesCabinet`, qui est la lecture unique.',
    ).toBe(1)
  })

  it('trie sur un critère UNIQUE par ligne, donc déterministe', () => {
    // `brique_id` n'est pas unique — c'est un type de règle, partagé par
    // plusieurs. Sans `id` en second critère, l'ordre des ex aequo est laissé
    // au bon vouloir du moteur, et il change.
    const bloc = source.slice(source.indexOf("from('regles_cabinet')"))
    const tri = bloc.slice(0, 400)

    expect(
      tri.includes(".order('brique_id')"),
      'Le tri par `brique_id` a disparu de la lecture des regles.',
    ).toBe(true)

    expect(
      tri.includes(".order('id')"),
      "La lecture des regles a perdu son `.order('id')`. `brique_id` seul laisse " +
        "l'ordre des ex aequo indetermine : le numero d'une regle peut alors " +
        'designer une AUTRE regle a la lecture suivante (cf. B-036).',
    ).toBe(true)
  })

  it('fait passer `lister_regles` par la lecture partagée', () => {
    // La garantie ne tient que si celui qui NUMÉROTE utilise bien la lecture
    // unique. S'il refabriquait sa liste autrement — même bien triée — les deux
    // ordres pourraient à nouveau diverger.
    const debut = source.indexOf('export const listerRegles')
    const fin = source.indexOf('export const', debut + 10)
    const corps = source.slice(debut, fin === -1 ? undefined : fin)

    expect(
      corps.includes('chargerReglesCabinet'),
      '`lister_regles` ne passe plus par `chargerReglesCabinet` : il numerote ' +
        'une liste que `agir_sur_regles` ne verra pas forcement dans le meme ordre.',
    ).toBe(true)
  })
})
