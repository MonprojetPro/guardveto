// ============================================================
// GUARDVETO — P3b : créneaux SUR-MESURE réellement planifiables
// ============================================================
// Deux preuves indissociables :
//   1. ÉQUIVALENCE : le catalogue par DÉFAUT (4 types seed) produit un planning
//      BYTE-IDENTIQUE au chemin legacy (sans catalogue) — le filet manquant
//      relevé par la recon du 2026-07-06 (les goldens n'exerçaient que le legacy).
//   2. SUR-MESURE : un code inconnu du trio historique génère de vrais slots,
//      remplis en respectant les règles (R22 une garde/jour, congés), vus par
//      le validateur INDÉPENDANT (couverture + violations si non pourvus).
// ============================================================

import { describe, it, expect } from 'vitest'
import { genererPlanningPur, type SolverInput } from '@/engine/solver'
import { validerPlanning, type ValidationInput } from '@/engine/validation/validerPlanning'
import type { VetEngine, PlanningPartiel } from '@/engine/types'
import type { CreneauModele } from '@/engine/creneau-modele'
import { estAttribue, vetsAttribues } from '@/engine/attribution'

// ── Période : 4 semaines d'hiver (lundi → dimanche) ──
const DATE_DEBUT = '2026-01-05' // lundi
const DATE_FIN = '2026-02-01' // dimanche

// ── Fixtures ──────────────────────────────────────────────

function creneau(partiel: Partial<CreneauModele> & { id: string }): CreneauModele {
  return {
    code: null,
    nom: partiel.id,
    joursSemaine: [],
    surFeries: false,
    heureDebut: '18:30',
    heureFin: '08:30',
    offsetJoursFin: 1,
    nbPlaces: 2,
    roles: ['premier', 'second'],
    actif: true,
    ordre: 1,
    ...partiel,
  }
}

/** Le catalogue par défaut, identique au seed SQL (P1). */
function catalogueDefaut(): CreneauModele[] {
  return [
    creneau({ id: 'ss', code: 'semaine_soir', nom: 'Soir de semaine', joursSemaine: [1, 2, 3, 4], ordre: 1 }),
    creneau({ id: 'vs', code: 'vendredi_soir', nom: 'Soir du vendredi', joursSemaine: [5], ordre: 2 }),
    creneau({ id: 'we', code: 'weekend', nom: 'Week-end', joursSemaine: [6], offsetJoursFin: 2, ordre: 3 }),
    creneau({ id: 'fe', code: 'ferie', nom: 'Jour férié', joursSemaine: [], surFeries: true, ordre: 4 }),
  ]
}

const vets: VetEngine[] = Array.from({ length: 6 }, (_, i) => ({
  id: `v${i + 1}`,
  nom: `Nom${i + 1}`,
  prenom: `Prenom${i + 1}`,
  statut: 'associe',
  dernier_recours: false,
  contraintes: [],
  conges: [],
}))

function inputBase(creneaux?: CreneauModele[]): SolverInput {
  return {
    dateDebut: DATE_DEBUT,
    dateFin: DATE_FIN,
    saison: 'hiver',
    vets,
    bonusMalus: {},
    creneaux,
  }
}

/** Empreinte byte-à-byte d'un planning (dates, types, rôles, vétos — tout). */
function empreinte(p: PlanningPartiel): string {
  return [...p.attributions]
    .sort((a, b) => (a.date + a.type < b.date + b.type ? -1 : 1))
    .map((a) => `${a.date}|${a.type}|${a.placements.map((pl) => `${pl.role}=${pl.vetId}`).join(',')}`)
    .join('\n')
}

// ============================================================
// 1. ÉQUIVALENCE catalogue défaut ↔ legacy (byte-identique)
// ============================================================

describe('P3b — le catalogue par défaut reste BYTE-IDENTIQUE au legacy', () => {
  const resLegacy = genererPlanningPur(inputBase(undefined))
  const resCatalogue = genererPlanningPur(inputBase(catalogueDefaut()))

  it('les deux chemins réussissent', () => {
    expect(resLegacy.success).toBe(true)
    expect(resCatalogue.success).toBe(true)
  })

  it('empreintes STRICTEMENT identiques (dates, types, rôles, vétos)', () => {
    if (!resLegacy.success || !resCatalogue.success) return
    expect(empreinte(resCatalogue.planning)).toBe(empreinte(resLegacy.planning))
  })
})

// ============================================================
// 2. SUR-MESURE — garde de jour en plus des gardes du soir
// ============================================================

const gardeJour = creneau({
  id: 'gj',
  code: 'garde_jour',
  nom: 'Garde de jour',
  joursSemaine: [1, 2, 3, 4], // lun-jeu, en PLUS de semaine_soir les mêmes jours
  heureDebut: '08:30',
  heureFin: '18:30',
  offsetJoursFin: 0,
  nbPlaces: 1,
  roles: ['titulaire'],
  ordre: 5,
})

describe('P3b — un créneau sur-mesure est réellement planifié', () => {
  const catalogue = [...catalogueDefaut(), gardeJour]
  const result = genererPlanningPur(inputBase(catalogue))

  it('le solveur réussit avec le créneau sur-mesure', () => {
    expect(result.success).toBe(true)
  })

  it('chaque lun-jeu porte SA garde de jour, pourvue, avec le rôle du catalogue', () => {
    if (!result.success) return
    const gardesJour = result.planning.attributions.filter((a) => a.type === 'garde_jour')
    expect(gardesJour).toHaveLength(16) // 4 semaines × 4 jours
    for (const g of gardesJour) {
      expect(g.placements).toHaveLength(1)
      expect(g.placements[0].role).toBe('titulaire')
      expect(g.placements[0].vetId).not.toBeNull()
    }
  })

  it('R22 : jamais le même véto sur la garde de jour ET la garde du soir du même jour', () => {
    if (!result.success) return
    for (const gj of result.planning.attributions.filter((a) => a.type === 'garde_jour')) {
      const soir = result.planning.attributions.find(
        (a) => a.date === gj.date && a.type === 'semaine_soir',
      )
      expect(soir).toBeDefined()
      const vetJour = gj.placements[0].vetId!
      expect(estAttribue(soir!, vetJour)).toBe(false)
    }
  })

  it('équité v1 : les gardes de jour sont étalées entre les vétos', () => {
    if (!result.success) return
    const compte = new Map<string, number>()
    for (const g of result.planning.attributions.filter((a) => a.type === 'garde_jour')) {
      const v = g.placements[0].vetId!
      compte.set(v, (compte.get(v) ?? 0) + 1)
    }
    const valeurs = vets.map((v) => compte.get(v.id) ?? 0)
    expect(Math.max(...valeurs) - Math.min(...valeurs)).toBeLessThanOrEqual(2)
  })

  it('le validateur INDÉPENDANT ne trouve AUCUNE violation', () => {
    if (!result.success) return
    const validationInput: ValidationInput = {
      dateDebut: DATE_DEBUT,
      dateFin: DATE_FIN,
      saison: 'hiver',
      vets,
      creneaux: catalogue,
    }
    expect(validerPlanning(result.planning, validationInput)).toEqual([])
  })

  it('le validateur DÉTECTE une garde de jour supprimée (couverture sur-mesure)', () => {
    if (!result.success) return
    const ampute: PlanningPartiel = {
      attributions: result.planning.attributions.filter(
        (a) => !(a.type === 'garde_jour' && a.date === '2026-01-05'),
      ),
    }
    const validationInput: ValidationInput = {
      dateDebut: DATE_DEBUT,
      dateFin: DATE_FIN,
      saison: 'hiver',
      vets,
      creneaux: [...catalogueDefaut(), gardeJour],
    }
    const violations = validerPlanning(ampute, validationInput)
    expect(violations.some((v) => v.regle === 'COUVERTURE' && v.type === 'garde_jour')).toBe(true)
  })
})

// ============================================================
// 3. WEEK-END FRACTIONNÉ — le cas d'entrée des cabinets non pilotes
// ============================================================

describe('P3b — week-end fractionné samedi/dimanche (weekend historique désactivé)', () => {
  const catalogue = [
    creneau({ id: 'ss', code: 'semaine_soir', nom: 'Soir de semaine', joursSemaine: [1, 2, 3, 4], ordre: 1 }),
    creneau({ id: 'vs', code: 'vendredi_soir', nom: 'Soir du vendredi', joursSemaine: [5], ordre: 2 }),
    creneau({ id: 'we', code: 'weekend', nom: 'Week-end', joursSemaine: [6], actif: false, ordre: 3 }),
    creneau({ id: 'sam', code: 'samedi_garde', nom: 'Samedi', joursSemaine: [6], nbPlaces: 2, roles: ['premier', 'second'], ordre: 4 }),
    creneau({ id: 'dim', code: 'dimanche_garde', nom: 'Dimanche', joursSemaine: [0], nbPlaces: 1, roles: ['premier'], ordre: 5 }),
  ]
  const result = genererPlanningPur(inputBase(catalogue))

  it('le solveur réussit', () => {
    expect(result.success).toBe(true)
  })

  it('chaque samedi et chaque dimanche sont couverts par leur créneau propre', () => {
    if (!result.success) return
    const samedis = result.planning.attributions.filter((a) => a.type === 'samedi_garde')
    const dimanches = result.planning.attributions.filter((a) => a.type === 'dimanche_garde')
    expect(samedis).toHaveLength(4)
    expect(dimanches).toHaveLength(4)
    for (const s of samedis) expect(vetsAttribues(s)).toHaveLength(2)
    for (const d of dimanches) expect(vetsAttribues(d)).toHaveLength(1)
    // plus AUCUNE garde weekend atomique
    expect(result.planning.attributions.some((a) => a.type === 'weekend')).toBe(false)
  })

  it('le validateur INDÉPENDANT valide le planning fractionné', () => {
    if (!result.success) return
    const validationInput: ValidationInput = {
      dateDebut: DATE_DEBUT,
      dateFin: DATE_FIN,
      saison: 'hiver',
      vets,
      creneaux: catalogue,
    }
    expect(validerPlanning(result.planning, validationInput)).toEqual([])
  })
})

// ============================================================
// 3b. GATE DE PUBLICATION — reconstruction gardes V1 → planning
// ============================================================
// La re-validation continue reconstruit le planning depuis la table `gardes`.
// Un type sur-mesure doit passer TEL QUEL (pas d'aplatissement en semaine_soir)
// et retrouver ses rôles du catalogue — sinon violations fantômes au gate.

describe('P3b — gardesVersPlanningPartiel reconstruit les types sur-mesure', () => {
  it('type sur-mesure : passthrough + rôles du catalogue (positionnel)', async () => {
    const { gardesVersPlanningPartiel } = await import('@/engine/validation/gardesVersPlanning')
    const planning = gardesVersPlanningPartiel(
      [
        { id: 'g1', date: '2026-01-05', type: 'semaine', premier_id: 'v1', second_id: 'v2' },
        { id: 'g2', date: '2026-01-05', type: 'sm_garde_jour', premier_id: 'v3', second_id: null },
      ],
      { rolesParCode: { sm_garde_jour: ['titulaire'] } },
    )
    const gj = planning.attributions.find((a) => a.type === 'sm_garde_jour')
    expect(gj).toBeDefined()
    expect(gj!.placements).toEqual([{ role: 'titulaire', vetId: 'v3' }])
    // la garde de semaine du même jour reste distincte (pas de collision)
    expect(planning.attributions.filter((a) => a.date === '2026-01-05')).toHaveLength(2)
  })

  it('le miroir garde_placements restaure les places au-delà des 2 colonnes V1', async () => {
    const { gardesVersPlanningPartiel } = await import('@/engine/validation/gardesVersPlanning')
    const planning = gardesVersPlanningPartiel(
      [{ id: 'g3', date: '2026-01-10', type: 'sm_samedi', premier_id: 'v1', second_id: 'v2' }],
      {
        rolesParCode: { sm_samedi: ['premier', 'second', 'troisieme'] },
        placementsParGarde: {
          g3: [
            { garde_id: 'g3', place_index: 2, role: 'troisieme', veterinaire_id: 'v3' },
            { garde_id: 'g3', place_index: 0, role: 'premier', veterinaire_id: 'v1' },
            { garde_id: 'g3', place_index: 1, role: 'second', veterinaire_id: 'v2' },
          ],
        },
      },
    )
    expect(planning.attributions[0].placements).toEqual([
      { role: 'premier', vetId: 'v1' },
      { role: 'second', vetId: 'v2' },
      { role: 'troisieme', vetId: 'v3' },
    ])
  })
})

// ============================================================
// 4. CONGÉS respectés sur un créneau sur-mesure
// ============================================================

describe('P3b — un congé bloque aussi les créneaux sur-mesure', () => {
  const vetsAvecConge: VetEngine[] = vets.map((v) =>
    v.id === 'v1'
      ? { ...v, conges: [{ date_debut: DATE_DEBUT, date_fin: DATE_FIN }] }
      : v,
  )
  const catalogue = [...catalogueDefaut(), gardeJour]
  const result = genererPlanningPur({ ...inputBase(catalogue), vets: vetsAvecConge })

  it('v1 (en congé toute la période) n\'a AUCUNE garde, sur-mesure comprise', () => {
    expect(result.success).toBe(true)
    if (!result.success) return
    for (const a of result.planning.attributions) {
      expect(estAttribue(a, 'v1')).toBe(false)
    }
  })
})
