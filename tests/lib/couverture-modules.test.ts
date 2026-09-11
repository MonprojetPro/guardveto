// ============================================================
// Chaque ecran a-t-il dit de quel module il depend ?
// ============================================================
// LA DEMANDE DE MiKL, le 2026-09-09 (B-120, decision ①) :
//
//   « Il faudra qu'ils aient la possibilite d'activer les modules comme ils
//    veulent. Peut-etre que certains cabinets voudront juste les gardes soir
//    et week-end, d'autres que le planning jour, et d'autres les 2. »
//
// CE QUE CE TEST FAIT, ET CE QU'IL NE FAIT PAS.
//
// Il ne force PAS un ecran a appartenir a un module : beaucoup relevent du
// socle, et c'est tres bien. Il force la DECISION — pour chaque ecran de la
// V2, quelqu'un a ecrit soit le module dont il depend, soit pourquoi il n'en
// depend d'aucun.
//
// La seule chose interdite est le silence. Sans ce gardien, chaque ecran
// ajoute dans six mois echapperait au dispositif sans qu'un seul test
// rougisse — exactement le defaut que `couverture-produit.ts` (Filou) et
// `attentes.ts` (le tableau) ont ete ecrits pour empecher.
//
// ⚠️ Ce test ne prouve RIEN sur la fermeture des portes : il regarde un
//    catalogue, pas un refus. Le refus est dans `modules-serveur.ts` et se
//    verifie dans `modules-serveur.test.ts`.
//
// Aucune connexion reseau : on lit les sources et le systeme de fichiers.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { APPARTENANCE, MODULES, MODULE_SOCLE, ecranVisible } from '@/lib/produit/modules'

const ECRANS_V2 = join(__dirname, '..', '..', 'src', 'app', '(v2)')

/**
 * Recompose la liste des ecrans depuis le SYSTEME DE FICHIERS, jamais depuis
 * une liste tenue a la main — une liste a la main aurait exactement le defaut
 * qu'on corrige : elle s'oublie.
 */
function ecransReels(): string[] {
  return readdirSync(ECRANS_V2)
    .filter((nom) => statSync(join(ECRANS_V2, nom)).isDirectory())
    .sort()
}

describe('Le catalogue des modules', () => {
  it('declare les trois modules de la V3', () => {
    expect(Object.keys(MODULES).sort()).toEqual(['chat', 'gardes', 'planning-journee'])
  })

  it('donne a chaque module un nom lisible et une phrase qui dit ce qu’il fait', () => {
    for (const [id, m] of Object.entries(MODULES)) {
      expect(m.nom, `${id} n’a pas de nom lisible`).toBeTruthy()
      expect(m.description, `${id} n’a pas de description`).toBeTruthy()
    }
  })

  it('designe les gardes comme le module socle, celui qu’on ne peut pas eteindre', () => {
    expect(MODULE_SOCLE).toBe('gardes')
    expect(MODULES[MODULE_SOCLE].eteignable).toBe(false)
  })
})

describe('ecranVisible — ce que la barre demande avant d’afficher une entree', () => {
  // ⚠️ Sans ces cas, `ecranVisible` serait du code ECRIT mais jamais EXECUTE
  // par la suite (lecon du 26/08 : un grep ne prouve pas l’execution). C’est
  // pourtant elle qui decide de chaque entree du dock.

  it('montre un ecran du socle, quels que soient les modules', () => {
    expect(ecranVisible('support', ['gardes'])).toBe(true)
    expect(ecranVisible('absences', ['planning-journee'])).toBe(true)
  })

  it('montre un ecran dont le module est allume', () => {
    expect(ecranVisible('planning', ['gardes'])).toBe(true)
  })

  it('CACHE un ecran dont le module est eteint', () => {
    expect(ecranVisible('planning', ['planning-journee'])).toBe(false)
    expect(ecranVisible('regles', ['chat'])).toBe(false)
    expect(ecranVisible('historique', [])).toBe(false)
  })

  it('n’invente pas de refus pour un ecran inconnu du catalogue', () => {
    // Le catalogue incomplet est l’affaire du test-gardien, qui crie. Ici,
    // cacher une entree sur une donnee absente ferait disparaitre un espace
    // sans qu’une seule ligne ne l’ait decide.
    expect(ecranVisible('un-ecran-jamais-declare', ['gardes'])).toBe(true)
  })
})

describe('L’appartenance des ecrans aux modules', () => {
  it('ne laisse AUCUN ecran sans decision', () => {
    const sansDecision = ecransReels().filter((e) => !(e in APPARTENANCE))
    expect(
      sansDecision,
      `Ces ecrans n’ont pas dit a quel module ils appartiennent : ${sansDecision.join(', ')}. ` +
        'Ajoutez une ligne dans APPARTENANCE (src/lib/produit/modules.ts) — ' +
        'soit { module: "..." }, soit { socle: "pourquoi il ne depend d’aucun module" }.',
    ).toEqual([])
  })

  it('ne garde AUCUNE decision qui designe un ecran disparu', () => {
    const reels = new Set(ecransReels())
    const fantomes = Object.keys(APPARTENANCE).filter((e) => !reels.has(e))
    expect(
      fantomes,
      `Ces decisions designent des ecrans qui n’existent plus : ${fantomes.join(', ')}`,
    ).toEqual([])
  })

  it('ne cite aucun module inconnu', () => {
    const inconnus = Object.entries(APPARTENANCE)
      .filter(([, d]) => 'module' in d && !(d.module in MODULES))
      .map(([ecran, d]) => `${ecran} → ${(d as { module: string }).module}`)
    expect(
      inconnus,
      `Modules inconnus cites : ${inconnus.join(', ')}. Une faute de frappe ici declare ` +
        'une appartenance qui n’existe pas, donc un ecran qui ne s’eteindra jamais.',
    ).toEqual([])
  })
})
