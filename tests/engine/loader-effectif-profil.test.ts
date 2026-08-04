// ============================================================
// GUARDVETO — Résolution de l'effectif de nuit au niveau loader
// ============================================================
// ⚠️ CE TEST A CHANGÉ DE CONTRAT LE 2026-08-04.
//
// Il prouvait une précédence à TROIS maillons — période > période type > saison.
// Le maillon du milieu a été retiré : la période type réglait le nombre de vétos
// de la seule nuit de semaine, alors que sa structure de gardes règle déjà celui
// de TOUTES les gardes (`creneau_modele.nb_places`). Deux maîtres pour un seul
// créneau, dont un qui ne pouvait que raboter l'autre en silence.
//
// Ce que le loader résout DÉSORMAIS :
//
//   1. SURCHARGE PLANNING — si periodes.nb_vetos_semaine_soir est réglé, il
//      gagne. C'est le « cet été-là, on n'était que cinq », et il reste.
//   2. SINON undefined     — le loader ne tranche pas : en aval, le créneau de
//      la période type décide (chemin catalogue), ou la saison à défaut de
//      toute structure (chemin legacy). On assert ici la FRONTIÈRE loader.
//
// La période type n'est PLUS lue pour l'effectif, quelle qu'elle soit — c'est
// le fait direct que vérifient les cas 2 et 2bis (cf. parades anti-cécité
// params : on teste ce qui SORT, pas la présence d'un appel).
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
  // `.is()` depuis le 2026-08-04 : le socle se lit `.is('profil_id', null)`.
  b.eq = chain; b.lte = chain; b.gte = chain; b.lt = chain; b.is = chain
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

describe('chargerInputDepuisSupabase — effectif de nuit : la surcharge du planning, ou rien', () => {
  it('1. surcharge du planning : sa valeur gagne', async () => {
    scenario = { periodeEffectif: 1, profilIdPeriode: null, profilEffectif: 2 }
    const input = await chargerInputDepuisSupabase('periode-1', 'cabinet-1')
    expect(input.nbVetosSemaineSoir).toBe(1)
  })

  it('2. la période type n’est PLUS consultée, même quand elle porte un effectif', async () => {
    // Le mock répond 2 si on l'interroge. Obtenir `undefined` prouve qu'on ne
    // l'interroge plus — le fait direct, pas l'absence supposée d'un appel.
    scenario = { periodeEffectif: null, profilIdPeriode: null, profilEffectif: 2 }
    const input = await chargerInputDepuisSupabase('periode-1', 'cabinet-1')
    expect(input.nbVetosSemaineSoir).toBeUndefined()
  })

  it('2bis. idem quand la période type est explicitement désignée par le planning', async () => {
    scenario = { periodeEffectif: null, profilIdPeriode: 'profil-ete', profilEffectif: 1 }
    const input = await chargerInputDepuisSupabase('periode-1', 'cabinet-1')
    expect(input.nbVetosSemaineSoir).toBeUndefined()
  })

  it('3. rien de réglé → undefined : c’est le créneau (ou la saison) qui tranchera en aval', async () => {
    scenario = { periodeEffectif: null, profilIdPeriode: null, profilEffectif: null }
    const input = await chargerInputDepuisSupabase('periode-1', 'cabinet-1')
    expect(input.nbVetosSemaineSoir).toBeUndefined()
  })
})
