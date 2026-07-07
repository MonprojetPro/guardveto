// ============================================================
// GUARDVETO — Tests du catalogue de briques (P1A-005)
// ============================================================
// 1. COHÉRENCE catalogue (code) ↔ seed briques_regles (P1A-001) : on PARSE
//    la vraie migration SQL et on exige que les ids + famille + axes
//    n'aient pas divergé. Couplage réel code ↔ base (pas une copie figée).
// 2. LANGAGE NATUREL : chaque brique rend une phrase française correcte
//    pour un jeu de params type (critère d'acceptation P1A-005).
// ============================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CATALOGUE_BRIQUES, BRIQUES_IDS, BRIQUES_INTERNES, rendreRegle } from '../catalogue'

// ── Parse du seed SQL (source de vérité côté base) ───────────

// Le catalogue est seedé par PLUSIEURS migrations : le seed initial (10 briques)
// + chaque ajout ultérieur (1 brique par migration). On les parse TOUTES pour
// garder le couplage réel code ↔ base.
const MIGRATIONS = [
  '20260619120000_p1a_briques_regles.sql',
  '20260629181000_p3_brique_espacement_weekend.sql',
  '20260706220000_penalites_souples_reglables.sql',
  '20260707150000_tags_composition_equipe.sql',
].map((f) => fileURLToPath(new URL(`../../../../supabase/migrations/${f}`, import.meta.url)))

interface SeedBrique {
  famille: string
  axes: string[]
}

/** Extrait { id → {famille, axes} } depuis le bloc INSERT d'une migration. */
function parserMigration(chemin: string): Record<string, SeedBrique> {
  const sql = readFileSync(chemin, 'utf8')
  // NB : « ON CONFLICT » apparaît AUSSI dans le commentaire d'en-tête → on
  // borne le bloc INSERT au VALUES puis au premier ON CONFLICT QUI SUIT.
  const debut = sql.indexOf('VALUES')
  const bloc = sql.slice(debut, sql.indexOf('ON CONFLICT', debut))

  const re =
    /\(\s*'([a-z_]+)',\s*'([a-z]+)',\s*'[A-Z_]+',\s*jsonb_build_object\([\s\S]*?'axes',\s*jsonb_build_array\(([^)]*)\)/g

  const seed: Record<string, SeedBrique> = {}
  for (const m of bloc.matchAll(re)) {
    const id = m[1]
    const famille = m[2]
    const axes = [...m[3].matchAll(/'([a-z]+)'/g)].map((a) => a[1])
    seed[id] = { famille, axes }
  }
  return seed
}

/** Fusionne le seed de toutes les migrations du catalogue. */
function parserSeed(): Record<string, SeedBrique> {
  return MIGRATIONS.reduce<Record<string, SeedBrique>>(
    (acc, chemin) => ({ ...acc, ...parserMigration(chemin) }),
    {},
  )
}

describe('catalogue ↔ seed briques_regles — cohérence (ne divergent pas)', () => {
  const seed = parserSeed()

  it('le seed parsé contient bien les 16 briques (sanity du parser)', () => {
    expect(Object.keys(seed)).toHaveLength(16)
  })

  it('catalogue et seed déclarent EXACTEMENT les mêmes briques', () => {
    expect([...BRIQUES_IDS].sort()).toEqual(Object.keys(seed).sort())
  })

  it('chaque brique a la même famille et les mêmes axes que le seed', () => {
    for (const id of BRIQUES_IDS) {
      const brique = CATALOGUE_BRIQUES[id]
      expect(brique.famille, `famille de ${id}`).toBe(seed[id].famille)
      expect([...brique.axes].sort(), `axes de ${id}`).toEqual([...seed[id].axes].sort())
    }
  })

  it('chaque brique expose un widget et au moins un paramètre', () => {
    for (const id of BRIQUES_IDS) {
      const brique = CATALOGUE_BRIQUES[id]
      expect(brique.widget, `widget de ${id}`).toMatch(/^Widget/)
      expect(Object.keys(brique.schemaParams).length, `schemaParams de ${id}`).toBeGreaterThan(0)
    }
  })
})

describe('briques internes (anti-coquille-vide)', () => {
  it('motif_grand_weekend est marquée interne (déjà couverte par repos_conditionnel)', () => {
    expect(CATALOGUE_BRIQUES.motif_grand_weekend.interne).toBe(true)
    expect(BRIQUES_INTERNES).toContain('motif_grand_weekend')
  })

  it('BRIQUES_INTERNES dérive bien du flag `interne` du catalogue', () => {
    const attendues = BRIQUES_IDS.filter((id) => CATALOGUE_BRIQUES[id].interne)
    expect([...BRIQUES_INTERNES].sort()).toEqual([...attendues].sort())
  })
})

describe('catalogue — rendu en langage naturel', () => {
  it('interdire_creneau (jour simple + exception vacances) — phrase lisible', () => {
    const phrase = rendreRegle('interdire_creneau', {
      jour: 'mercredi',
      exception_vacances_scolaires: true,
    })
    expect(phrase).toContain('mercredi')
    expect(phrase).toContain('sauf vacances scolaires')
  })

  it('interdire_creneau (tableau de règles — Anne-Sophie)', () => {
    const phrase = rendreRegle('interdire_creneau', {
      regles: [{ jour: 'jeudi', periode: 'apres_midi', semaine: 'impaire' }],
    })
    expect(phrase).toContain('jeudi')
    expect(phrase).toContain("l'après-midi")
    expect(phrase).toContain('impaire')
  })

  it('repos_conditionnel — décrit les deux cas (WE / sinon)', () => {
    const phrase = rendreRegle('repos_conditionnel', { si_garde_we: 'jeudi', sinon: 'vendredi' })
    expect(phrase).toContain('jeudi')
    expect(phrase).toContain('vendredi')
    expect(phrase).toContain('week-end')
  })

  it('duo_interdit — résout le nom du partenaire via le contexte', () => {
    const phrase = rendreRegle(
      'duo_interdit',
      { avec_veterinaire_id: 'id-manon' },
      { nomVeto: (id) => (id === 'id-manon' ? 'Manon' : id) },
    )
    expect(phrase).toContain('Manon')
    expect(phrase).not.toContain('id-manon')
  })

  it('alternance_ancre — indisponibilité une semaine sur deux', () => {
    const phrase = rendreRegle('alternance_ancre', {
      periodes: ['soir_semaine', 'weekend'],
      semaines: 'impaires',
    })
    expect(phrase).toContain('impaire')
    expect(phrase.toLowerCase()).toContain('soir')
  })

  it('chaque brique rend une phrase NON VIDE même sans params (robustesse interface)', () => {
    for (const id of BRIQUES_IDS) {
      const phrase = rendreRegle(id, {})
      expect(typeof phrase, `type de ${id}`).toBe('string')
      expect(phrase.length, `phrase de ${id}`).toBeGreaterThan(0)
    }
  })

  it('brique inconnue → fallback lisible sans exception', () => {
    expect(rendreRegle('brique_fantome', {})).toContain('non reconnue')
  })
})
