// ============================================================
// GUARDVETO — P5 slice 3b : précédence de l'effectif (période > profil > saison)
// ============================================================
// Prouve, par FAITS DIRECTS (cf. parades anti-cécité params), que
// chargerInputDepuisSupabase résout `nbVetosSemaineSoir` dans le bon ordre :
//
//   1. SURCHARGE PÉRIODE  — si periodes.nb_vetos_semaine_soir est réglé, il gagne
//      (et le profil n'est même pas lu : court-circuit).
//   2. PROFIL             — sinon, l'effectif porté par le profil de la période.
//   3. REPLI SAISON       — sinon undefined au niveau loader → le solver applique
//      la saison (hiver=2/été=1). On assert ici la FRONTIÈRE loader (undefined).
//
// Byte-identique : toutes les périodes existantes portent déjà une valeur
// explicite (backfill P1-B) → elles tombent TOUJOURS dans le cas 1.
//
// Le client Supabase est mocké : un query-builder chaînable qui répond selon
// (table + colonnes du select), robuste au réordonnancement des requêtes.
// ============================================================

import { describe, it, expect, vi } from 'vitest'

// Scénario piloté par test (lu par le mock).
let scenario: {
  periodeEffectif: number | null
  profilIdPeriode: string | null
  profilEffectif: number | null
}

function dataFor(table: string, cols: string): unknown {
  switch (table) {
    case 'periodes':
      // Step 1 (charge la période) : select riche incluant 'saison' + 'profil_id'.
      if (cols.includes('saison')) {
        return {
          id: 'periode-1', saison: 'hiver',
          date_debut: '2026-01-05', date_fin: '2026-03-29',
          statut: 'brouillon', profil_id: scenario.profilIdPeriode,
        }
      }
      // Lecture ciblée de l'effectif de la période.
      if (cols.includes('nb_vetos_semaine_soir')) {
        return { nb_vetos_semaine_soir: scenario.periodeEffectif }
      }
      // periodePrecedente (select 'id') → aucune période précédente.
      return null
    case 'profils_planning':
      // chargerEffectifProfil : effectif porté par le profil.
      if (cols.includes('nb_vetos_semaine_soir')) {
        return { nb_vetos_semaine_soir: scenario.profilEffectif }
      }
      // resoudreProfilId (select 'id', est_defaut) → profil défaut du cabinet.
      return { id: 'profil-defaut' }
    case 'cabinets':
      return { zone_scolaire: 'A', region_feries: 'metropole' }
    // Tables sans effet sur l'effectif — vides.
    default:
      return []
  }
}

function makeBuilder(table: string) {
  let selectCols = ''
  const b: Record<string, unknown> = {}
  const chain = () => b
  b.select = (cols?: string) => { selectCols = cols ?? ''; return b }
  b.eq = chain; b.lte = chain; b.gte = chain; b.lt = chain
  b.or = chain; b.order = chain; b.limit = chain
  const resolved = () => ({ data: dataFor(table, selectCols), error: null })
  b.single = () => Promise.resolve(resolved())
  b.maybeSingle = () => Promise.resolve(resolved())
  // Thenable : `await supabase.from(t).select()...` sans terminateur.
  b.then = (r: (v: { data: unknown; error: null }) => unknown) => r(resolved())
  return b
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: (t: string) => makeBuilder(t) })),
}))

import { chargerInputDepuisSupabase } from '@/engine/loader'

describe('chargerInputDepuisSupabase — précédence effectif (période > profil > saison)', () => {
  it('1. surcharge période : la valeur de la période gagne sur celle du profil', async () => {
    scenario = { periodeEffectif: 1, profilIdPeriode: null, profilEffectif: 2 }
    const input = await chargerInputDepuisSupabase('periode-1', 'cabinet-1')
    expect(input.nbVetosSemaineSoir).toBe(1)
  })

  it('2. profil : sans surcharge période, l’effectif vient du profil', async () => {
    scenario = { periodeEffectif: null, profilIdPeriode: null, profilEffectif: 2 }
    const input = await chargerInputDepuisSupabase('periode-1', 'cabinet-1')
    expect(input.nbVetosSemaineSoir).toBe(2)
  })

  it('2bis. profil explicitement choisi sur la période : son effectif s’applique', async () => {
    scenario = { periodeEffectif: null, profilIdPeriode: 'profil-ete', profilEffectif: 1 }
    const input = await chargerInputDepuisSupabase('periode-1', 'cabinet-1')
    expect(input.nbVetosSemaineSoir).toBe(1)
  })

  it('3. repli saison : ni période ni profil réglés → undefined au niveau loader', async () => {
    scenario = { periodeEffectif: null, profilIdPeriode: null, profilEffectif: null }
    const input = await chargerInputDepuisSupabase('periode-1', 'cabinet-1')
    expect(input.nbVetosSemaineSoir).toBeUndefined()
  })
})
