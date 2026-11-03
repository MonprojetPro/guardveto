// B-183 — la cloche des notifications, revenue le 03/11.
// Elle avait disparu avec la V1 (28/10) sans que rien ne le signale : la base
// écrivait toujours, plus personne ne lisait. Ces tests verrouillent qu'elle est
// BRANCHÉE (pas seulement écrite), et ses petites règles d'affichage.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chiffrePastille, lienInterne, tempsRelatif } from '@/lib/notifications/types'

const lire = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('chiffrePastille', () => {
  it('rien sous 1, le chiffre jusqu’à 9, puis « 9+ »', () => {
    expect(chiffrePastille(0)).toBeNull()
    expect(chiffrePastille(-2)).toBeNull()
    expect(chiffrePastille(1)).toBe('1')
    expect(chiffrePastille(9)).toBe('9')
    expect(chiffrePastille(182)).toBe('9+')
  })
})

describe('lienInterne — on ne suit que les adresses de GuardVeto', () => {
  it('garde les chemins internes réellement écrits par le code', () => {
    for (const l of ['/planning', '/absences', '/echanges', '/planning?mois=2026-11', '/absences?onglet=echanges']) {
      expect(lienInterne(l)).toBe(l)
    }
  })
  it('refuse tout ce qui sort du site', () => {
    for (const l of ['https://exemple.com', '//exemple.com', '/\\exemple.com', 'javascript:alert(1)', 'planning', '', null, undefined]) {
      expect(lienInterne(l as string | null | undefined)).toBeNull()
    }
  })
  it('la cloche passe par ce filtre avant de naviguer', () => {
    const cloche = readFileSync(join(process.cwd(), 'src/components/v2/ClocheV2.tsx'), 'utf8')
    expect(cloche).toContain('const lien = lienInterne(n.lien)')
    expect(cloche).not.toContain('router.push(n.lien)')
  })
})

describe('tempsRelatif', () => {
  const t0 = Date.parse('2026-11-03T14:00:00Z')
  it('dit l’ancienneté en mots simples', () => {
    expect(tempsRelatif('2026-11-03T13:59:40Z', t0)).toBe('à l’instant')
    expect(tempsRelatif('2026-11-03T13:57:00Z', t0)).toBe('il y a 3 min')
    expect(tempsRelatif('2026-11-03T11:00:00Z', t0)).toBe('il y a 3 h')
    expect(tempsRelatif('2026-11-01T14:00:00Z', t0)).toBe('il y a 2 j')
    expect(tempsRelatif('2026-10-20T14:00:00Z', t0)).toMatch(/20 oct/)
  })
})

describe('la cloche est branchée', () => {
  const barre = lire('src/components/v2/BarreV2.tsx')
  const cloche = lire('src/components/v2/ClocheV2.tsx')
  const actions = lire('src/app/(v2)/cloche-actions.ts')

  it('la barre la pose pour admin et véto, jamais pour le secrétariat', () => {
    expect(barre).toContain('{!estSecretaire && <ClocheV2 />}')
    // Juste avant la déconnexion, sur la même rangée.
    expect(barre.indexOf('<ClocheV2 />')).toBeLessThan(barre.indexOf('<form action={logout}>'))
  })

  it('écoute la table en direct ET lit le statut de l’abonnement', () => {
    expect(cloche).toContain("table: 'notifications'")
    expect(cloche).toContain('abonnerEnSignalantLesEchecs(canal')
  })

  it('n’affiche jamais « aucune notification » quand la lecture a échoué', () => {
    expect(actions).toMatch(/if \(liste\.error \|\| compte\.error\)/)
    expect(cloche).toContain('etat.erreur ?')
  })

  it('un « lu » refusé par la base (zéro ligne) n’est pas pris pour un succès', () => {
    expect(actions).toContain(".update({ lu: true }).eq('id', id).select('id')")
  })

  it('le fichier serveur n’exporte que des fonctions async (sinon le build casse)', () => {
    const exports = [...actions.matchAll(/^export (\w+(?: \w+)?)/gm)].map((m) => m[1])
    expect(exports.every((e) => e === 'async function')).toBe(true)
  })

  it('le panneau ouvert passe AU-DESSUS de la carte de Filou (03/11 : il s’ouvrait sous la vidéo)', () => {
    const css = lire('src/styles/v2-cloche.css')
    expect(css).toMatch(/\.v2 \.app-bar:has\(\.cl-panneau\) \{ position: relative; z-index: 60; \}/)
  })

  it('la feuille est importée par le composant lui-même', () => {
    expect(cloche).toContain("import '@/styles/v2-cloche.css'")
  })
})
