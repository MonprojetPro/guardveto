// ============================================================
// B-175h / B-175i / B-177 — retours de la recette du 28/10
// ============================================================
// Trois captures de MiKL :
//   • la fenêtre « Les présences de… » (Équipe) sans aucune mise en page ;
//   • « À vérifier » qui répète trois fois la même chose pour Jean ;
//   • « Vos plannings » : deux cases trop pauvres pour un réglage aussi lourd.
// ============================================================

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { regrouperChevauchements } from '@/lib/absences/chevauchement'

const jean = (id: string, debut: string, fin: string, perimetre: string, origine: 'conge' | 'absence' = 'absence') => ({
  id,
  veterinaire_id: 'jean',
  date_debut: debut,
  date_fin: fin,
  origine,
  perimetre,
})

describe('B-175i — « À vérifier » : une ligne par groupe, pas par paire', () => {
  it('trois absences le même jour font UNE ligne, sans « une absence et une absence »', () => {
    const g = regrouperChevauchements([
      jean('a', '2026-10-26', '2026-10-26', 'ponctuel'),
      jean('b', '2026-10-26', '2026-10-26', 'matin'),
      jean('c', '2026-10-26', '2026-10-26', 'matin'),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].ids).toEqual(['a', 'b', 'c'])
    expect(g[0].phrase).toBe(
      '3 absences se recouvrent le 26 octobre 2026, avec des périmètres différents : « Indisponibilité ponctuelle », « Le matin ».',
    )
  })

  it('une chaîne de recouvrements sur deux jours reste un seul groupe, borné aux jours en double', () => {
    const g = regrouperChevauchements([
      jean('a', '2026-10-26', '2026-10-27', 'ponctuel'),
      jean('b', '2026-10-26', '2026-10-26', 'matin'),
      jean('c', '2026-10-27', '2026-10-27', 'apres-midi'),
    ])
    expect(g).toHaveLength(1)
    expect(g[0].date_debut).toBe('2026-10-26')
    expect(g[0].date_fin).toBe('2026-10-27')
    expect(g[0].phrase).toMatch(/^3 absences se recouvrent du 26 octobre 2026 au 27 octobre 2026/u)
  })

  it('nomme congé et absence, et se tait sur les périmètres s’ils sont identiques', () => {
    const [g] = regrouperChevauchements([
      jean('c1', '2026-11-02', '2026-11-02', 'journee-et-nuit', 'conge'),
      jean('a1', '2026-11-02', '2026-11-02', 'journee-et-nuit'),
    ])
    expect(g.phrase).toBe('un congé et une absence se recouvrent le 2 novembre 2026.')
    expect(g.perimetresDifferents).toBe(false)
  })

  it('deux groupes séparés dans le temps restent deux lignes', () => {
    const g = regrouperChevauchements([
      jean('a', '2026-10-26', '2026-10-26', 'matin'),
      jean('b', '2026-10-26', '2026-10-26', 'matin'),
      jean('c', '2026-11-10', '2026-11-10', 'matin'),
      jean('d', '2026-11-10', '2026-11-10', 'matin'),
    ])
    expect(g.map((x) => x.ids)).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('aucun recouvrement : rien à dire', () => {
    expect(regrouperChevauchements([jean('a', '2026-10-26', '2026-10-26', 'matin')])).toEqual([])
  })
})

describe('B-175h — la fenêtre des présences porte ses propres styles', () => {
  it('TramesJournee importe la feuille qui dessine ses classes `tj-`', () => {
    // Elle les tenait de l'ancienne page `/journee` : devenue redirection, la
    // fenêtre ouverte depuis Équipe s'est affichée nue.
    const src = readFileSync('src/components/v2/TramesJournee.tsx', 'utf8')
    expect(src).toMatch(/className="tj-/u)
    expect(src).toContain("import '@/styles/v2-journee.css'")
  })
})

describe('B-177 — les tuiles « Vos plannings »', () => {
  const src = readFileSync('src/components/v2/OrganisationParties.tsx', 'utf8')
  const css = readFileSync('src/styles/v2-organisation.css', 'utf8')

  it('l’interrupteur n’est jamais DANS le lien (deux commandes imbriquées)', () => {
    const lien = src.slice(src.indexOf('<Link'), src.indexOf('</Link>'))
    expect(lien).not.toContain('<button')
  })

  it('éteindre passe par une confirmation, allumer non', () => {
    expect(src).toContain('on ? setAEteindre(module) : basculer(module, true)')
  })

  it('chaque classe de la tuile a sa règle CSS', () => {
    const classes = [...src.matchAll(/org-[a-z-]+/gu)].map((m) => m[0])
    const manquantes = [...new Set(classes)].filter((c) => !css.includes(`.${c}`))
    expect(manquantes).toEqual([])
  })
})
