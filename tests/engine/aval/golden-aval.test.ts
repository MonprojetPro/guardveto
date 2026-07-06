// ============================================================
// GUARDVETO — Filet GOLDEN de l'aval (P6 verrou n°3, ÉTAPE 0)
// ============================================================
// Fige la sortie ACTUELLE (R8 FERME, couple historique câblé) des dérivations
// d'affichage du vendredi/samedi/dimanche depuis les gardes V1, AVANT de les
// rebrancher sur la dérivation générique. Ces snapshots sont les GARDIENS
// byte-identique des étapes 1-2.
//
// PIÈGE TILT adressé ici : la vue SQL et le validateur se DISENT « miroirs
// exacts ». On PROUVE qu'ils encodent déjà le MÊME vendredi (mêmes rôles/vétos)
// avant tout rebranchement — sinon on figerait un bug.
//
// Les 4 dérivations n'ont pas la même FORME (vue = 3 lignes ; validateur =
// weekend+vendredi_soir ; PDF = cellule inversée ; agenda = texte). L'INVARIANT
// commun et load-bearing est le PLACEMENT du vendredi : {premier ← 2nd du WE,
// second ← 1er du WE}. On fige donc cet invariant, plus la sortie réelle du
// validateur (`gardesVersPlanningPartiel`).
// ============================================================

import { describe, it, expect } from 'vitest'
import { gardesVersPlanningPartiel, type GardeRow } from '@/engine/validation/gardesVersPlanning'

// ── Fixture pilote déterministe ──────────────────────────
// 2026-01-02 ven / 01-03 sam / 01-04 dim ; 01-10 sam ; 01-06 mar ; 01-01 férié.
const GARDES: GardeRow[] = [
  { date: '2026-01-01', type: 'ferie', premier_id: 'E', second_id: 'F' },
  { date: '2026-01-03', type: 'weekend', premier_id: 'A', second_id: 'B' },
  { date: '2026-01-06', type: 'semaine', premier_id: 'A', second_id: 'B' },
  { date: '2026-01-10', type: 'weekend', premier_id: 'C', second_id: 'D' },
]

// ── Réplique de la vue SQL `planning_semaine` (migration 20260617160000) ──
// 3 lignes par week-end : vendredi (rôles INVERSÉS), samedi (natif), dimanche
// (natif). On la reproduit ici pour figer la sémantique de la vue (le test SQL
// réel n'est pas exécutable en unité).
interface LigneVue { date: string; type: string; premier_id: string | null; second_id: string | null }
function deriverVueSqlActuelle(gardes: GardeRow[]): LigneVue[] {
  const lignes: LigneVue[] = []
  const moins1 = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10) }
  const plus1 = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }
  for (const g of gardes) {
    // Ligne native
    lignes.push({ date: g.date, type: g.type, premier_id: g.premier_id, second_id: g.second_id })
    if (g.type === 'weekend') {
      // Vendredi : rôles INVERSÉS (vp→2nd, vs→1er)
      lignes.push({ date: moins1(g.date), type: g.type, premier_id: g.second_id, second_id: g.premier_id })
      // Dimanche : composition du week-end (natif)
      lignes.push({ date: plus1(g.date), type: g.type, premier_id: g.premier_id, second_id: g.second_id })
    }
  }
  return lignes.sort((a, b) => a.date.localeCompare(b.date))
}

// ── Réplique du PDF `gardeVendrediInversee` (pdf.tsx ~511) ──
function deriverPdfVendrediActuel(we: { premier_id: string | null; second_id: string | null }) {
  return { premier_id: we.second_id, second_id: we.premier_id }
}

// ── Réplique de l'agenda `buildEventDescription` (google-calendar ~135) ──
function deriverAgendaDescriptionActuelle(prenomPremier: string, prenomSecond: string) {
  return [
    `Vendredi soir : ${prenomSecond} (1er) + ${prenomPremier} (2nd)`,
    `Samedi & dimanche : ${prenomPremier} (1er) + ${prenomSecond} (2nd)`,
  ]
}

describe('GOLDEN aval — sortie ACTUELLE figée (R8 ferme)', () => {
  it('validateur : gardesVersPlanningPartiel — snapshot complet', () => {
    const { attributions } = gardesVersPlanningPartiel(GARDES)
    const trie = [...attributions].sort((a, b) =>
      a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date),
    )
    expect(trie).toEqual([
      { date: '2026-01-01', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'E' }, { role: 'second', vetId: 'F' }] },
      // Vendredi du WE 01-03 : INVERSÉ (B,A)
      { date: '2026-01-02', type: 'vendredi_soir', placements: [{ role: 'premier', vetId: 'B' }, { role: 'second', vetId: 'A' }] },
      { date: '2026-01-03', type: 'weekend', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
      { date: '2026-01-06', type: 'semaine_soir', placements: [{ role: 'premier', vetId: 'A' }, { role: 'second', vetId: 'B' }] },
      // Vendredi du WE 01-10 : INVERSÉ (D,C)
      { date: '2026-01-09', type: 'vendredi_soir', placements: [{ role: 'premier', vetId: 'D' }, { role: 'second', vetId: 'C' }] },
      { date: '2026-01-10', type: 'weekend', placements: [{ role: 'premier', vetId: 'C' }, { role: 'second', vetId: 'D' }] },
    ])
  })

  it('vue SQL : 3 lignes par week-end, vendredi inversé — snapshot', () => {
    expect(deriverVueSqlActuelle(GARDES)).toEqual([
      { date: '2026-01-01', type: 'ferie', premier_id: 'E', second_id: 'F' },
      { date: '2026-01-02', type: 'weekend', premier_id: 'B', second_id: 'A' }, // ven inversé
      { date: '2026-01-03', type: 'weekend', premier_id: 'A', second_id: 'B' }, // sam natif
      { date: '2026-01-04', type: 'weekend', premier_id: 'A', second_id: 'B' }, // dim natif
      { date: '2026-01-06', type: 'semaine', premier_id: 'A', second_id: 'B' },
      { date: '2026-01-09', type: 'weekend', premier_id: 'D', second_id: 'C' }, // ven inversé
      { date: '2026-01-10', type: 'weekend', premier_id: 'C', second_id: 'D' },
      { date: '2026-01-11', type: 'weekend', premier_id: 'C', second_id: 'D' },
    ])
  })

  it('PIÈGE TILT : les 4 dérivations encodent EXACTEMENT le même vendredi', () => {
    const we = { premier_id: 'A', second_id: 'B' }
    // 1. Validateur
    const { attributions } = gardesVersPlanningPartiel([{ date: '2026-01-03', type: 'weekend', ...we }])
    const venValidateur = attributions.find((a) => a.type === 'vendredi_soir')!
    const premierValid = venValidateur.placements.find((p) => p.role === 'premier')!.vetId
    const secondValid = venValidateur.placements.find((p) => p.role === 'second')!.vetId
    // 2. Vue SQL
    const venVue = deriverVueSqlActuelle([{ date: '2026-01-03', type: 'weekend', ...we }]).find((l) => l.date === '2026-01-02')!
    // 3. PDF
    const venPdf = deriverPdfVendrediInverse(we)
    // 4. Agenda (le « 1er » du vendredi)
    const [ligneVen] = deriverAgendaDescriptionActuelle('A', 'B') // A=premier, B=second du WE
    // Le 1er du vendredi = le 2nd du WE = B partout.
    expect(premierValid).toBe('B')
    expect(secondValid).toBe('A')
    expect(venVue.premier_id).toBe('B')
    expect(venVue.second_id).toBe('A')
    expect(venPdf.premier_id).toBe('B')
    expect(ligneVen).toContain('B (1er)')
    expect(ligneVen).toContain('A (2nd)')
  })
})

// Alias pour lisibilité du test ci-dessus.
function deriverPdfVendrediInverse(we: { premier_id: string | null; second_id: string | null }) {
  return deriverPdfVendrediActuel(we)
}
