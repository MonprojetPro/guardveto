// ============================================================
// B-090 — la marque « bac à sable » ne peut manquer sur aucun écran
// ============================================================
// MiKL, le 31/08 : « mets-moi une marque dans la barre du bac à sable que c'est
// bien la version démo, car sinon je ne sais pas ».
//
// Le besoin est né le matin même : le bac à sable a été remis à l'identique du
// compte client — mêmes prénoms, même planning, mêmes compteurs. Les deux
// comptes sont devenus indiscernables à l'œil. C'est ce qu'on voulait pour
// mesurer, et c'est ce qui rend une retouche « pour essayer » dangereuse.
//
// ── CE QUE CE TEST PROTÈGE, ET POURQUOI IL EST STRUCTUREL ───────────────────
//
// Un avertissement absent d'un SEUL écran est pire qu'un avertissement absent
// partout : il apprend à faire confiance à son absence. Le jour où l'on ouvre
// un écran sans ruban, on en conclut « je suis chez le client » — et on se
// trompe.
//
// La parade ne peut pas être « penser à l'ajouter » : c'est exactement la
// consigne qui a été oubliée pour Filou (règle FILOU SUIT LE PRODUIT) et pour
// le tableau des attentes (LE TABLEAU NE PEUT PAS SE TAIRE). Elle est donc
// structurelle : tout groupe de routes CONNECTÉES doit monter le ruban dans son
// layout, et ce test échoue si un nouveau groupe apparaît sans lui.
// ============================================================

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const APP = 'src/app'

/**
 * Les groupes de routes qui n'exigent PAS de ruban, avec leur raison.
 *
 * ⚠️ Une exemption se DÉCLARE ici, elle ne se constate pas. Sans cette liste,
 * un groupe oublié ressemblerait en tout point à un groupe volontairement
 * exempté — la confusion même que ce test existe pour empêcher.
 */
const HORS_PERIMETRE: Record<string, string> = {
  api: 'Routes serveur : aucun écran, rien à afficher.',
  auth: 'Parcours de connexion : on ne sait pas encore QUI se connecte, donc pas de cabinet à nommer.',
  login: 'Idem — avant l’identification.',
  'set-password': 'Idem — avant l’identification.',
}

/** Les dossiers de premier niveau qui portent des écrans. */
function groupesDeRoutes(): string[] {
  return readdirSync(APP, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

describe('B-090 — le ruban « bac à sable » couvre tous les écrans connectés', () => {
  it('chaque groupe de routes connectées monte le ruban dans son layout', () => {
    const sansRuban: string[] = []

    for (const groupe of groupesDeRoutes()) {
      if (groupe in HORS_PERIMETRE) continue

      const layout = join(APP, groupe, 'layout.tsx')
      if (!existsSync(layout)) {
        // Un groupe d'écrans sans layout ne peut pas porter le ruban : c'est
        // un trou, pas une exemption.
        sansRuban.push(`${groupe} (aucun layout.tsx)`)
        continue
      }

      const source = readFileSync(layout, 'utf8')
      // ⚠️ On cherche le MONTAGE `<RubanBacASable`, pas la mention du nom.
      // Première version de ce test : `includes('RubanBacASable')` — elle
      // passait au vert alors que le composant avait été retiré du rendu,
      // parce que la ligne d'import suffisait à la satisfaire. Un nom présent
      // ne prouve pas qu'un composant est affiché.
      if (!source.includes('<RubanBacASable')) sansRuban.push(groupe)
    }

    expect(
      sansRuban,
      'Ces groupes de routes affichent des écrans SANS la marque « bac à sable ». ' +
        'Sur le compte de démonstration, ils sont indiscernables du compte du cabinet. ' +
        'Monter <RubanBacASable /> dans leur layout, ou déclarer l’exemption avec sa ' +
        'raison dans HORS_PERIMETRE de ce test.',
    ).toEqual([])
  })

  it('le ruban ne dépend d’aucune feuille de style de coquille', () => {
    // Il est monté dans deux coquilles qui ne partagent aucun style (V1 en
    // Tailwind, V2 avec ses jetons). S'il dépendait de l'une, il serait
    // invisible dans l'autre — précisément là où on cesserait de le chercher.
    const source = readFileSync('src/components/RubanBacASable.tsx', 'utf8')

    expect(source).toContain('style={{')
    expect(source).not.toMatch(/className=["'][^"']/u)
  })

  it('ne s’affiche QUE sur un cabinet marqué, jamais par défaut', () => {
    // Une fausse alerte répétée finit par être ignorée, y compris le jour où
    // elle est vraie. Le ruban se tait donc en cas de doute.
    const source = readFileSync('src/components/RubanBacASable.tsx', 'utf8')

    expect(source).toContain('est_bac_a_sable')
    expect(source).toContain('if (!estBacASable) return null')
    // Et une lecture qui échoue ne doit pas non plus déclencher l'alerte.
    expect(source).toMatch(/catch\s*\{[\s\S]*?return null/u)
  })
})
