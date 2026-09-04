// ============================================================
// GUARDVETO — Tests du loader « zone-aware »
// ============================================================
// Prouve que chargerInputDepuisSupabase(periodeId, cabinetId) :
//   1. lit la zone scolaire du cabinet (cabinets.zone_scolaire),
//   2. filtre vacances_scolaires sur CETTE zone (.eq('zone', ...)),
//   3. expose ces dates dans input.calendrier.vacancesScolaires,
//   4. n'attache AUCUN calendrier si cabinetId est omis (fallback).
//
// Le client Supabase est mocké : un query-builder chaînable qui
// enregistre les appels (table + filtres) et renvoie des données
// canoniques zone A.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock du client Supabase ───────────────────────────────
// On capture les filtres appliqués pour les assertions.
const calls: { table: string; filters: Record<string, unknown> } = {
  table: '',
  filters: {},
}

// Données canoniques renvoyées selon la table interrogée.
function dataFor(table: string): unknown {
  switch (table) {
    case 'periodes':
      // .single() pour la période ; .maybeSingle() pour la période précédente.
      return { id: 'periode-1', saison: 'hiver', date_debut: '2026-01-05', date_fin: '2026-03-29', statut: 'brouillon' }
    case 'veterinaires':
      return [
        {
          id: 'v1', nom: 'Petit', prenom: 'Fanny', statut: 'associe', dernier_recours: false,
          contraintes_veto: [{ id: 'c1', type: 'jour_repos_fixe', config: { jour: 'mercredi', flexible_vacances: true }, brique_type: 'legacy', actif: true }],
        },
      ]
    case 'conges':
      return []
    case 'bonus_malus':
      return []
    case 'cabinets':
      // Cabinet pilote : zone A (Cusset / Allier).
      return { zone_scolaire: 'A', region_feries: 'metropole' }
    case 'vacances_scolaires':
      // Le mock IGNORE volontairement le filtre et renvoie les dates zone A :
      // l'assertion vérifie séparément que .eq('zone', 'A') a bien été appelé.
      return [
        { debut: '2026-02-07', fin: '2026-02-23', label: 'Hiver 2026 (zone A)' },
        { debut: '2026-04-04', fin: '2026-04-20', label: 'Pâques 2026 (zone A)' },
      ]
    case 'jours_feries':
      return [{ date: '2026-01-01', libelle: '1er janvier' }]
    default:
      return []
  }
}

// Query-builder chaînable. Termine sur .single()/.maybeSingle() (objet)
// ou en tant que thenable (tableau) pour les requêtes sans terminateur.
function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder

  builder.select = chain
  builder.eq = (col: string, val: unknown) => { calls.filters[`${table}.eq.${col}`] = val; return builder }
  builder.lte = (col: string, val: unknown) => { calls.filters[`${table}.lte.${col}`] = val; return builder }
  builder.gte = (col: string, val: unknown) => { calls.filters[`${table}.gte.${col}`] = val; return builder }
  builder.is = chain // le socle se lit `.is('profil_id', null)` (2026-08-04)
  builder.neq = chain // B-111 — lecture des places cadenassées (`neq('places_figees','{}')`)
  builder.lt = chain
  builder.or = chain
  builder.order = chain
  builder.limit = chain
  builder.single = () => Promise.resolve({ data: dataFor(table), error: null })
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null }) // pas de période précédente
  // Thenable : permet `await supabase.from(t).select()...` sans terminateur.
  builder.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
    resolve({ data: dataFor(table), error: null })

  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      calls.table = table
      return makeBuilder(table)
    },
  })),
}))

import { chargerInputDepuisSupabase } from '@/engine/loader'

beforeEach(() => {
  calls.table = ''
  calls.filters = {}
})

describe('chargerInputDepuisSupabase — calendrier zone-aware', () => {
  it('filtre vacances_scolaires sur la zone du cabinet (A) et expose ces dates', async () => {
    const input = await chargerInputDepuisSupabase('periode-1', 'cabinet-pilote')

    // Le filtre de zone a bien été appliqué sur vacances_scolaires.
    expect(calls.filters['vacances_scolaires.eq.zone']).toBe('A')

    // Le calendrier est présent et contient les dates zone A.
    expect(input.calendrier).toBeDefined()
    const debuts = input.calendrier!.vacancesScolaires.map((v) => v.debut)
    expect(debuts).toContain('2026-02-07') // Hiver zone A (≠ zone C qui commence le 14)
    expect(debuts).not.toContain('2026-02-14') // date d'hiver zone C → absente
  })

  it('charge aussi les fériés de la région (Set non incohérent)', async () => {
    const input = await chargerInputDepuisSupabase('periode-1', 'cabinet-pilote')
    expect(input.calendrier!.feries.has('2026-01-01')).toBe(true)
    expect(calls.filters['jours_feries.eq.region']).toBe('metropole')
  })

  it('sans cabinetId : aucun calendrier attaché (fallback hors-DB)', async () => {
    const input = await chargerInputDepuisSupabase('periode-1')
    expect(input.calendrier).toBeUndefined()
  })
})
