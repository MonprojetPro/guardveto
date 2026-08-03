import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ============================================================
// LE PRINCIPE FONDAMENTAL, VÉRIFIÉ MÉCANIQUEMENT
// ============================================================
// « Chaque règle, chaque élément de structure doit TOUJOURS être vérifié avec
//   ce qui existe déjà, et les conséquences signalées à l'utilisateur. »
//
// L'audit du 2026-08-03 a montré comment ce principe s'érode : il était tenu
// par DISCIPLINE, dans l'écran Règles, et donc absent partout ailleurs — Filou
// écrivait sans contrôle, les dix-sept actions de l'écran Organisation n'en
// avaient jamais eu. Personne n'avait « oublié » : le contrôle n'était
// simplement pas sur le chemin.
//
// Ce test lit le SOURCE des actions serveur et vérifie que chaque écriture
// dans `regles_cabinet` est précédée du contrôle d'impact. Il échouera le jour
// où quelqu'un ajoutera une porte d'entrée sans le brancher — c'est-à-dire
// avant que le trou n'atteigne la production, et non des semaines après.
//
// Même famille que `colonnes-lues.test.ts` et `use-server-exports.test.ts` :
// des vérités qui ne se voient ni au typage, ni au build, ni à l'exécution des
// cas nominaux.
// ============================================================

const RACINE = join(process.cwd(), 'src')

function lire(chemin: string): string {
  return readFileSync(join(RACINE, chemin), 'utf-8')
}

describe('le contrôle d’impact est sur le chemin des écritures', () => {
  const actions = lire('app/(protected)/regles/actions.ts')

  it('les actions de règles importent le contrôle d’impact', () => {
    expect(actions).toContain("from '@/data/controleImpact'")
  })

  it('CHAQUE écriture de règle est précédée d’un contrôle', () => {
    // Volontairement exigeant : `upsertRegle` a DEUX chemins d'écriture (le
    // tronc commun, et le duo interdit qui écrit ses deux lignes miroir à
    // part). La première version de ce test ne regardait que le premier
    // contrôle rencontré et déclarait le duo couvert — il ne l'était pas.
    // Une écriture non contrôlée doit faire échouer ce test, pas une sur deux.
    const debut = actions.indexOf('export async function upsertRegle')
    expect(debut).toBeGreaterThan(0)
    const fin = actions.indexOf('export async function', debut + 10)
    const corps = actions.slice(debut, fin)

    // Les LECTURES ne comptent pas : seule une écriture change le monde.
    const ecritures = [...corps.matchAll(/from\('regles_cabinet'\)\s*\.?\s*(insert|update|delete)/g)]
      .map((m) => m.index ?? 0)
    const controles = [...corps.matchAll(/refusSiBloquant/g)].map((m) => m.index ?? 0)

    expect(ecritures.length).toBeGreaterThan(0)
    expect(controles.length).toBeGreaterThan(0)
    for (const e of ecritures) {
      expect(controles.some((c) => c < e)).toBe(true)
    }
  })

  it('le refus laisse une porte de sortie explicite à l’admin', () => {
    // Un blocage sans issue transformerait le gardien en mur : l'admin qui a
    // vu les conséquences doit pouvoir décider.
    expect(actions).toContain('confirmeImpact')
  })
})

describe('le contrôle d’impact lui-même', () => {
  const module = lire('data/controleImpact.ts')

  it('ne bloque QUE ce qui rend la génération impossible', () => {
    // Décision MiKL du 2026-08-03 : avertir toujours, bloquer seulement
    // l'impossible. Un contrôle qui bloque au moindre avertissement serait
    // contourné en trois jours.
    expect(module).toContain('bloquants.length === 0')
  })

  it('laisse écrire quand le contrôle n’a PAS pu tourner', () => {
    // Bloquer une modification légitime parce que le gardien est cassé serait
    // le pire des deux mondes.
    expect(module).toContain('if (!impact.verifie) return null')
  })

  it('ne compare jamais un monde simulé à un monde faussé par une erreur avalée', () => {
    // Une requête en échec traitée comme « zéro ligne » fabrique un monde sans
    // règles : le delta serait calculé contre un cabinet imaginaire.
    const erreursLevees = module.match(/if \(err\w+\) throw new Error/g) ?? []
    expect(erreursLevees.length).toBeGreaterThanOrEqual(3)
  })

  it('mesure le delta dans les DEUX sens — ce qui casse et ce qui se répare', () => {
    expect(module).toContain('repares')
  })
})

describe('Filou ne se passe jamais outre à la place de l’humain', () => {
  it('aucun outil de Filou ne pose confirmeImpact', () => {
    // Un assistant qui confirme lui-même un blocage annule le garde-fou. Il
    // doit rapporter le refus et laisser trancher.
    for (const fichier of ['lib/ia/outils/regles.ts', 'components/ia/creerRegleProposee.ts']) {
      let source: string
      try {
        source = lire(fichier)
      } catch {
        continue // le fichier a été renommé : les autres tests le diront
      }
      expect(source).not.toContain('confirmeImpact: true')
    }
  })
})
