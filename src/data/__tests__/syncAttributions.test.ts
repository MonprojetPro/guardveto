// ============================================================
// GUARDVETO — P6 verrou n°7, étape 3 : fiabiliser `attributions` (V2)
// ============================================================
// Trois preuves :
//
//   1. BYTE-IDENTIQUE — le constructeur PUR partagé
//      (`construireLignesAttributions`) produit EXACTEMENT les mêmes lignes
//      que l'implémentation historique inline de persisterResultat (copiée
//      ci-dessous en référence, verbatim).
//
//   2. JUGE DE PAIX DU CUTOVER — après une génération simulée PUIS une édition
//      simulée, la V1 (`gardes` + miroir `garde_placements`) et la V2
//      (`attributions`) décrivent EXACTEMENT le même planning : les lignes V2
//      reconstruites depuis la V1 (chemin de synchro) sont égales aux lignes
//      V2 écrites depuis le planning moteur (chemin de génération) — y compris
//      le `vendredi_soir` explicite en V2, dérivé du week-end via relations.
//
//   3. DÉTECTEUR DE DÉRIVE — `comparerAttributionsV1V2` détecte lignes
//      manquantes, orphelines et mauvais occupant ; silence quand tout est
//      aligné.
// ============================================================

import { describe, it, expect } from 'vitest'
import {
  construireLignesAttributions,
  construireLignesPourJours,
  comparerAttributionsV1V2,
  calculerHoraires,
  toUTCString,
  addDaysISO,
  jourParisDe,
  type AttributionRow,
  type ContexteLignesAttributions,
  type AttributionLue,
} from '@/data/attributionRows'
import { joursImpactesGarde } from '@/data/syncAttributions'
import {
  structureParDefaut,
  horairesResolus,
  type StructureCreneauxResolue,
} from '@/engine/structure-creneaux'
import type { PlanningPartiel } from '@/engine/types'
import type { GardeRow, PlacementRow } from '@/engine/validation/gardesVersPlanning'

// ── Contexte commun ──────────────────────────────────────────

const CTX: ContexteLignesAttributions = {
  cabinetId: 'cab-1',
  planningId: 'per-1',
  snapshotId: 'snap-1',
  structure: structureParDefaut(),
  creneauIdParCode: new Map([
    ['semaine_soir', 'cren-ss'],
    ['vendredi_soir', 'cren-vs'],
    ['weekend', 'cren-we'],
    ['ferie', 'cren-fe'],
  ]),
}

/** Tri stable pour comparer des ensembles de lignes. */
function triees(rows: AttributionRow[]): AttributionRow[] {
  return [...rows].sort((a, b) =>
    JSON.stringify(a).localeCompare(JSON.stringify(b)),
  )
}

// ── Planning MOTEUR simulé (une semaine, hiver → UTC+1) ─────
// Lun 05/01 + mar 06/01 semaine_soir ; mer 07/01 semaine_soir SUR FÉRIÉ
// (le moteur n'émet jamais de slot 'ferie' — reclassifié 'ferie' en V1) ;
// ven 09/01 vendredi_soir (rôles INVERSÉS du WE — R8 par défaut) ;
// sam 10/01 weekend ; + un créneau SUR-MESURE 3 places le jeudi 08/01.

const FERIES = new Set(['2026-01-07'])

const PLANNING_MOTEUR: PlanningPartiel = {
  attributions: [
    { date: '2026-01-05', type: 'semaine_soir', placements: [
      { role: 'premier', vetId: 'vet-A' }, { role: 'second', vetId: 'vet-B' },
    ]},
    { date: '2026-01-06', type: 'semaine_soir', placements: [
      { role: 'premier', vetId: 'vet-C' }, { role: 'second', vetId: null },
    ]},
    { date: '2026-01-07', type: 'semaine_soir', placements: [
      { role: 'premier', vetId: 'vet-D' }, { role: 'second', vetId: 'vet-A' },
    ]},
    { date: '2026-01-08', type: 'garde_jour', placements: [
      { role: 'chirurgien', vetId: 'vet-B' },
      { role: 'assistant', vetId: 'vet-C' },
      { role: 'renfort', vetId: 'vet-D' },
    ]},
    { date: '2026-01-09', type: 'vendredi_soir', placements: [
      { role: 'premier', vetId: 'vet-B' }, { role: 'second', vetId: 'vet-A' },
    ]},
    { date: '2026-01-10', type: 'weekend', placements: [
      { role: 'premier', vetId: 'vet-A' }, { role: 'second', vetId: 'vet-B' },
    ]},
  ],
}

/** Options sur-mesure : rôles du catalogue du créneau 'garde_jour'. */
const ROLES_PAR_CODE = { garde_jour: ['chirurgien', 'assistant', 'renfort'] }

/**
 * Réplique locale de mapTypeGardeEnDb (route generate) : moteur → type V1.
 * vendredi_soir : JETÉ côté V1 (fusionné dans le week-end).
 */
function typeV1(type: string, date: string): string {
  if (type === 'weekend') return 'weekend'
  if (type === 'semaine_soir') return FERIES.has(date) ? 'ferie' : 'semaine'
  return type
}

/** V1 simulée depuis le planning moteur : gardes + miroir garde_placements. */
function versV1(planning: PlanningPartiel): {
  gardes: GardeRow[]
  placementsParGarde: Record<string, PlacementRow[]>
} {
  const gardes: GardeRow[] = []
  const placementsParGarde: Record<string, PlacementRow[]> = {}
  let i = 0
  for (const a of planning.attributions) {
    if (a.type === 'vendredi_soir') continue // V1 n'a PAS de ligne vendredi
    const id = `garde-${i++}`
    gardes.push({
      id,
      date: a.date,
      type: typeV1(a.type, a.date),
      premier_id: a.placements[0]?.vetId ?? null,
      second_id: a.placements[1]?.vetId ?? null,
    })
    placementsParGarde[id] = a.placements.map((p, idx) => ({
      garde_id: id,
      place_index: idx,
      role: p.role,
      veterinaire_id: p.vetId,
    }))
  }
  return { gardes, placementsParGarde }
}

const TOUS_JOURS = [
  '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08',
  '2026-01-09', '2026-01-10',
]

// ============================================================
// 1. BYTE-IDENTIQUE avec l'implémentation historique
// ============================================================

/**
 * RÉFÉRENCE HISTORIQUE — copie VERBATIM de la boucle de persisterResultat
 * (avant extraction vers attributionRows.ts), y compris ses helpers privés.
 * Ne pas « améliorer » : ce bloc fige le comportement d'origine.
 */
function referenceHistorique(
  planning: PlanningPartiel,
  ctx: ContexteLignesAttributions,
): AttributionRow[] {
  function toUTCStringHist(dateISO: string, heureLocale: string): string {
    const naive = new Date(`${dateISO}T${heureLocale}:00.000`)
    const formatter = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      timeZoneName: 'shortOffset',
    })
    const parts = formatter.formatToParts(naive)
    const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC+1'
    const offsetMatch = offsetPart.match(/UTC([+-]\d+)/)
    const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : 1
    const utcMs = naive.getTime() - offsetHours * 60 * 60 * 1000
    return new Date(utcMs).toISOString()
  }

  function calculerHorairesHist(
    date: string,
    type: string,
    structure: StructureCreneauxResolue,
  ): { dateDebut: string; dateFin: string } {
    function addDaysISOHist(iso: string, days: number): string {
      const d = new Date(`${iso}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + days)
      return d.toISOString().slice(0, 10)
    }
    const { heureDebut, heureFin, offsetJoursFin } = horairesResolus(structure, type)
    return {
      dateDebut: toUTCStringHist(date, heureDebut),
      dateFin:   toUTCStringHist(addDaysISOHist(date, offsetJoursFin), heureFin),
    }
  }

  const rows: AttributionRow[] = []
  for (const a of planning.attributions) {
    const creneauId = ctx.creneauIdParCode.get(a.type) ?? null
    const { dateDebut, dateFin } = calculerHorairesHist(a.date, a.type, ctx.structure)
    for (const p of a.placements) {
      if (!p.vetId) continue
      rows.push({
        cabinet_id:       ctx.cabinetId,
        planning_id:      ctx.planningId,
        creneau_id:       creneauId,
        veterinaire_id:   p.vetId,
        role:             p.role,
        type_presence:    'sur_place',
        date_debut_reel:  dateDebut,
        date_fin_reel:    dateFin,
        snapshot_id:      ctx.snapshotId,
      })
    }
  }
  return rows
}

describe('construireLignesAttributions — byte-identique avec persisterResultat historique', () => {
  it('produit exactement les mêmes lignes (mêmes valeurs, même ordre) — hiver', () => {
    expect(construireLignesAttributions(PLANNING_MOTEUR, CTX))
      .toEqual(referenceHistorique(PLANNING_MOTEUR, CTX))
  })

  it('produit exactement les mêmes lignes — été (UTC+2, DST)', () => {
    const planningEte: PlanningPartiel = {
      attributions: [
        { date: '2026-07-06', type: 'semaine_soir', placements: [
          { role: 'premier', vetId: 'vet-A' }, { role: 'second', vetId: 'vet-B' },
        ]},
        { date: '2026-07-11', type: 'weekend', placements: [
          { role: 'premier', vetId: 'vet-C' }, { role: 'second', vetId: 'vet-D' },
        ]},
      ],
    }
    expect(construireLignesAttributions(planningEte, CTX))
      .toEqual(referenceHistorique(planningEte, CTX))
  })

  it('horodatages conformes au référentiel (weekend = sam 08:30 → lun 08:30, 48 h)', () => {
    // ⚠️ Pas d'instant UTC absolu ici : toUTCString (héritée telle quelle de
    // persisterResultat) parse la date naïve dans le fuseau de la MACHINE —
    // correcte sur Vercel (UTC), décalée d'1 h sur un poste réglé sur Paris.
    // Quirk PRÉ-EXISTANT, identique génération/synchro (donc sans dérive V1↔V2).
    // On fige les invariants indépendants de l'environnement : jours + durée.
    const h = calculerHoraires('2026-01-10', 'weekend', CTX.structure)
    expect(jourParisDe(h.dateDebut)).toBe('2026-01-10')
    expect(jourParisDe(h.dateFin)).toBe('2026-01-12')
    const dureeH = (new Date(h.dateFin).getTime() - new Date(h.dateDebut).getTime()) / 3_600_000
    expect(dureeH).toBe(48)
  })
})

// ============================================================
// 2. JUGE DE PAIX — V1 + garde_placements ≡ V2 (génération + édition)
// ============================================================

describe('égalité V1 ↔ V2 (juge de paix du cutover)', () => {
  it('après GÉNÉRATION simulée : la reconstruction V1 → V2 égale la persistance moteur → V2', () => {
    // Chemin GÉNÉRATION : moteur → lignes V2 (persisterResultat).
    const lignesGeneration = construireLignesAttributions(PLANNING_MOTEUR, CTX)

    // Chemin SYNCHRO : V1 (gardes sans vendredi + miroir) → lignes V2.
    const { gardes, placementsParGarde } = versV1(PLANNING_MOTEUR)
    const lignesSync = construireLignesPourJours(gardes, TOUS_JOURS, CTX, {
      rolesParCode: ROLES_PAR_CODE,
      placementsParGarde,
      // relations: undefined → couple historique (inversion R8), comme le moteur.
    })

    // ÉGALITÉ EXACTE : y compris le vendredi_soir explicite (dérivé du WE en
    // V1, natif dans le planning moteur) et le créneau sur-mesure 3 places.
    expect(triees(lignesSync)).toEqual(triees(lignesGeneration))
    expect(lignesSync.length).toBe(12) // 2+1+2+3 natifs + 2 vendredi + 2 weekend
  })

  it('après ÉDITION simulée du week-end : les lignes V2 du vendredi lié SUIVENT (inversion)', () => {
    const { gardes, placementsParGarde } = versV1(PLANNING_MOTEUR)

    // Édition manuelle : on échange l'équipe du week-end (vet-C prend le 1er rôle).
    const we = gardes.find((g) => g.type === 'weekend')!
    we.premier_id = 'vet-C'
    we.second_id = 'vet-D'

    // Jours impactés par la mutation d'un week-end : le samedi ET la veille.
    const jours = joursImpactesGarde('2026-01-10', 'weekend')
    expect(jours).toEqual(['2026-01-09', '2026-01-10'])

    const lignes = construireLignesPourJours(gardes, jours, CTX, {
      rolesParCode: ROLES_PAR_CODE,
      placementsParGarde,
    })

    // Week-end : nouvelle équipe, rôles natifs.
    const weRows = lignes.filter((l) => l.creneau_id === 'cren-we')
    expect(weRows).toHaveLength(2)
    expect(weRows.find((l) => l.role === 'premier')?.veterinaire_id).toBe('vet-C')
    expect(weRows.find((l) => l.role === 'second')?.veterinaire_id).toBe('vet-D')

    // Vendredi lié : MÊME équipe, rôles INVERSÉS (R8 par défaut).
    const venRows = lignes.filter((l) => l.creneau_id === 'cren-vs')
    expect(venRows).toHaveLength(2)
    expect(venRows.find((l) => l.role === 'premier')?.veterinaire_id).toBe('vet-D')
    expect(venRows.find((l) => l.role === 'second')?.veterinaire_id).toBe('vet-C')
    // Et il tombe bien la veille du samedi.
    expect(venRows.every((l) => jourParisDe(l.date_debut_reel) === '2026-01-09')).toBe(true)

    // Rien d'autre dans la fenêtre resynchronisée.
    expect(lignes).toHaveLength(4)
  })

  it('édition d\'un soir de semaine : fenêtre limitée au jour, ferie V1 → creneau semaine_soir', () => {
    const { gardes, placementsParGarde } = versV1(PLANNING_MOTEUR)

    // Édition du mercredi FÉRIÉ (stocké type='ferie' en V1) : vet-B remplace vet-D.
    const fer = gardes.find((g) => g.type === 'ferie')!
    expect(fer.date).toBe('2026-01-07')
    fer.premier_id = 'vet-B'

    const jours = joursImpactesGarde('2026-01-07', 'ferie')
    expect(jours).toEqual(['2026-01-07'])

    const lignes = construireLignesPourJours(gardes, jours, CTX, {
      rolesParCode: ROLES_PAR_CODE,
      placementsParGarde,
    })
    // Le moteur n'émet jamais 'ferie' : la V2 de ce jour reste en semaine_soir
    // (18:30 → +1j 08:30), EXACTEMENT comme à la génération.
    expect(lignes).toHaveLength(2)
    expect(lignes.every((l) => l.creneau_id === 'cren-ss')).toBe(true)
    expect(lignes.find((l) => l.role === 'premier')?.veterinaire_id).toBe('vet-B')
    expect(lignes[0].date_debut_reel).toBe(toUTCString('2026-01-07', '18:30'))
  })

  it('un jour bordé par un week-end du LENDEMAIN ne perd pas son vendredi dérivé', () => {
    const { gardes, placementsParGarde } = versV1(PLANNING_MOTEUR)
    // Resynchro du SEUL vendredi 09/01 : le week-end du 10/01 (lendemain) doit
    // fournir la dérivation, sans réécrire le samedi lui-même.
    const lignes = construireLignesPourJours(gardes, ['2026-01-09'], CTX, {
      rolesParCode: ROLES_PAR_CODE,
      placementsParGarde,
    })
    expect(lignes).toHaveLength(2)
    expect(lignes.every((l) => l.creneau_id === 'cren-vs')).toBe(true)
    expect(lignes.find((l) => l.role === 'premier')?.veterinaire_id).toBe('vet-B')
    expect(lignes.find((l) => l.role === 'second')?.veterinaire_id).toBe('vet-A')
  })
})

// ============================================================
// 3. DÉTECTEUR DE DÉRIVE V1 ↔ V2
// ============================================================

/** Lignes V2 « en base » simulées depuis le planning moteur. */
function lignesLues(rows: AttributionRow[]): AttributionLue[] {
  return rows.map((r) => ({
    veterinaire_id: r.veterinaire_id,
    role: r.role,
    date_debut_reel: r.date_debut_reel,
  }))
}

describe('comparerAttributionsV1V2 — détecteur de dérive', () => {
  const lignesV2 = lignesLues(construireLignesAttributions(PLANNING_MOTEUR, CTX))

  it('silencieux quand V1 et V2 décrivent le même planning', () => {
    expect(comparerAttributionsV1V2(PLANNING_MOTEUR, lignesV2)).toEqual([])
  })

  it('détecte une ligne V2 MANQUANTE (édition V1 non synchronisée)', () => {
    const tronquees = lignesV2.filter(
      (l) => !(l.veterinaire_id === 'vet-C' && jourParisDe(l.date_debut_reel) === '2026-01-06'),
    )
    const div = comparerAttributionsV1V2(PLANNING_MOTEUR, tronquees)
    expect(div).toHaveLength(1)
    expect(div[0]).toMatchObject({
      date: '2026-01-06', veterinaireId: 'vet-C', role: 'premier', nature: 'manquant',
    })
  })

  it('détecte une ligne V2 ORPHELINE (V2 en avance / résidu)', () => {
    const gonflees = [
      ...lignesV2,
      { veterinaire_id: 'vet-Z', role: 'premier', date_debut_reel: toUTCString('2026-01-06', '18:30') },
    ]
    const div = comparerAttributionsV1V2(PLANNING_MOTEUR, gonflees)
    expect(div).toHaveLength(1)
    expect(div[0]).toMatchObject({
      date: '2026-01-06', veterinaireId: 'vet-Z', nature: 'orphelin',
    })
  })

  it('détecte un MAUVAIS OCCUPANT (manquant + orphelin sur le même jour)', () => {
    const alterees = lignesV2.map((l) =>
      l.veterinaire_id === 'vet-A' && jourParisDe(l.date_debut_reel) === '2026-01-05'
        ? { ...l, veterinaire_id: 'vet-D' }
        : l,
    )
    const div = comparerAttributionsV1V2(PLANNING_MOTEUR, alterees)
    expect(div).toHaveLength(2)
    const natures = div.map((d) => `${d.veterinaireId}:${d.nature}`).sort()
    expect(natures).toEqual(['vet-A:manquant', 'vet-D:orphelin'])
  })

  it('insensible aux horodatages exacts (changement d\'horaires ≠ dérive d\'équipe)', () => {
    // Mêmes équipes, heures décalées (profil modifié après génération) → RAS.
    const decalees = lignesV2.map((l) => ({
      ...l,
      date_debut_reel: l.date_debut_reel.replace('T17:30', 'T18:45').replace('T07:30', 'T08:45'),
    }))
    expect(comparerAttributionsV1V2(PLANNING_MOTEUR, decalees)).toEqual([])
  })
})

// ============================================================
// Helpers de bord de fenêtre
// ============================================================

describe('fenêtres jour (helpers)', () => {
  it('addDaysISO traverse les mois', () => {
    expect(addDaysISO('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('jourParisDe rattache une nuit UTC au bon jour Paris', () => {
    // 18:30 Paris le 05/01 = 17:30 UTC le 05/01 → jour Paris 05/01.
    expect(jourParisDe('2026-01-05T17:30:00.000Z')).toBe('2026-01-05')
    // 23:30 UTC le 05/01 = 00:30 Paris le 06/01 → jour Paris 06/01.
    expect(jourParisDe('2026-01-05T23:30:00.000Z')).toBe('2026-01-06')
  })
})
