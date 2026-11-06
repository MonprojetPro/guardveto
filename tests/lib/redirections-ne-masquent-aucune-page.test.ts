// ============================================================
// Une redirection ne masque jamais une vraie page (B-191, 06/11)
// ============================================================
// Next applique les `redirects()` de `next.config.ts` AVANT de chercher une
// page. Le 28/10, `/notifications` avait été redirigé vers les réglages
// d'e-mail (la page V1 venait d'être supprimée). Le 06/11, la page
// « Toutes mes notifications » est recréée à cette adresse : build vert,
// route listée, tests verts — et MiKL atterrissait sur les réglages d'e-mail.
// Rien ne relie les deux fichiers : ce test le fait.
// ============================================================

import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const RACINE = join(__dirname, '..', '..')
const APP = join(RACINE, 'src', 'app')

/** Les routes servies par une page, groupes « (v2) » retirés : « /notifications ». */
function routesDesPages(dossier: string = APP, routes: string[] = []): string[] {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom)
    if (statSync(chemin).isDirectory()) routesDesPages(chemin, routes)
    else if (/^page\.(tsx|ts|jsx|js)$/.test(nom)) {
      const segments = relative(APP, dossier).split(sep).filter((s) => s && !/^\(.*\)$/.test(s))
      routes.push('/' + segments.join('/'))
    }
  }
  return routes
}

describe('Les redirections de next.config.ts', () => {
  const config = readFileSync(join(RACINE, 'next.config.ts'), 'utf8').replace(/\/\/.*$/gm, '')
  const sources = [...config.matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1])

  it('en déclare (sinon ce test ne vérifie rien)', () => {
    expect(existsSync(APP)).toBe(true)
    expect(sources.length).toBeGreaterThan(0)
  })

  it('🔴 aucune ne détourne l’adresse d’une page qui existe', () => {
    const pages = new Set(routesDesPages())
    expect(pages.has('/notifications')).toBe(true)
    expect(sources.filter((s) => pages.has(s))).toEqual([])
  })
})
