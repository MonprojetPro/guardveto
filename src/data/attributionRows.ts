// ============================================================
// GUARDVETO — Lignes `attributions` (V2) : constructeur PUR partagé
// ============================================================
// (P6 — verrou n°7, étape 3 : rendre `attributions` V2 fiable et lisible)
//
// LE PROBLÈME. `persisterResultat` écrivait V2 correctement à la GÉNÉRATION,
// mais chaque mutation ultérieure (édition manuelle, crise, échange, dépannage)
// n'écrivait QUE la V1 (`gardes` + `garde_placements`) → V2 divergeait à la
// première édition. Pour synchroniser V2 partout SANS dupliquer la logique de
// conversion, ce module extrait le cœur PUR :
//
//   PlanningPartiel (forme moteur) ──► lignes `attributions` (V2)
//
// Deux producteurs de PlanningPartiel s'y branchent :
//   - la GÉNÉRATION (persisterResultat) : le planning sort du solver ;
//   - la SYNCHRO post-mutation (syncAttributions) : le planning est RECONSTRUIT
//     depuis la V1 via `gardesVersPlanningPartiel` — le MÊME module que la
//     re-validation, donc la même sémantique (vendredi dérivé via relations,
//     'ferie' V1 → 'semaine_soir' moteur, placements sur-mesure du miroir).
//
// PURETÉ. Zéro dépendance Supabase/Next : testable en isolation (vitest).
// Le calcul d'horodatage (toUTCString/calculerHoraires) est DÉPLACÉ ici depuis
// persisterResultat — à l'identique, byte pour byte (le test
// syncAttributions.test.ts fige l'équivalence avec l'implémentation historique).
// ============================================================

import type { PlanningPartiel, AttributionGarde } from '@/engine/types'
import {
  horairesResolus,
  type StructureCreneauxResolue,
} from '@/engine/structure-creneaux'
import {
  gardesVersPlanningPartiel,
  type GardeRow,
  type OptionsSurMesure,
} from '@/engine/validation/gardesVersPlanning'

// ── Types ────────────────────────────────────────────────────

/** Une ligne prête pour l'insert dans `attributions` (V2). */
export interface AttributionRow {
  cabinet_id: string
  planning_id: string
  creneau_id: string | null
  veterinaire_id: string
  /** Label libre depuis P3b (rôles du catalogue) — CHECK SQL levé en migration. */
  role: string
  type_presence: 'sur_place'
  date_debut_reel: string
  date_fin_reel: string
  snapshot_id: string | null
}

/** Contexte de conversion (résolu par l'appelant — génération ou synchro). */
export interface ContexteLignesAttributions {
  cabinetId: string
  /** UUID de la période (= planning_id dans attributions). */
  planningId: string
  /** Snapshot des règles lié à la période (traçabilité F8) — null si aucun. */
  snapshotId: string | null
  /** Horaires résolus du profil (chargerStructureProfil / structureParDefaut). */
  structure: StructureCreneauxResolue
  /** creneaux_catalogue résolu : code → id (créneau sur-mesure absent → null). */
  creneauIdParCode: Map<string, string>
}

// ── Calcul des horodatages (Europe/Paris) ────────────────────
// Déplacé depuis persisterResultat (2026-07-07) — logique STRICTEMENT identique.

/**
 * Retourne une date ISO 8601 UTC correspondant à l'heure locale
 * Europe/Paris pour la date et le décalage horaire donnés.
 *
 * On utilise l'API Intl pour déduire l'offset Paris au moment
 * de la date (gestion automatique heure d'été / heure d'hiver).
 */
export function toUTCString(dateISO: string, heureLocale: string): string {
  // heureLocale = 'HH:MM' (ex: '18:30', '08:30')
  const naive = new Date(`${dateISO}T${heureLocale}:00.000`)

  // Offset Europe/Paris en minutes (positif = en avance sur UTC)
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    timeZoneName: 'shortOffset',
  })
  const parts = formatter.formatToParts(naive)
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC+1'
  // offsetPart : 'UTC+1', 'UTC+2', etc.
  const offsetMatch = offsetPart.match(/UTC([+-]\d+)/)
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : 1

  // Date UTC = date locale - offset
  const utcMs = naive.getTime() - offsetHours * 60 * 60 * 1000
  return new Date(utcMs).toISOString()
}

/** Avance une date ISO yyyy-mm-dd de `days` jours (UTC, pur). */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Calcule date_debut_reel et date_fin_reel pour une attribution,
 * selon le type de créneau.
 *
 * Mapping identique à la migration F1-002 (020260616170002_migrate_gardes.sql).
 */
export function calculerHoraires(
  date: string,
  type: string,
  structure: StructureCreneauxResolue,
): { dateDebut: string; dateFin: string } {
  // Horaires résolus pour CE cabinet (A1 : structure par défaut + surcharge
  // cabinet). Repli automatique sur le défaut si le cabinet n'a rien personnalisé.
  const { heureDebut, heureFin, offsetJoursFin } = horairesResolus(structure, type)
  return {
    dateDebut: toUTCString(date, heureDebut),
    dateFin:   toUTCString(addDaysISO(date, offsetJoursFin), heureFin),
  }
}

// ── Conversion PlanningPartiel → lignes `attributions` ──────

/**
 * construireLignesAttributions — cœur PUR de la persistance V2.
 *
 * Une ligne par PLACE POURVUE (P3b : label de rôle réel), avec snapshot_id.
 * Miroir EXACT de la boucle historique de persisterResultat (étape 4) :
 * même ordre d'itération, même résolution de creneau_id, mêmes horodatages.
 */
export function construireLignesAttributions(
  planning: PlanningPartiel,
  ctx: ContexteLignesAttributions,
): AttributionRow[] {
  const rows: AttributionRow[] = []

  for (const a of planning.attributions) {
    // Le type moteur EST le code du catalogue (identité). Un code sur-mesure
    // n'existe pas dans `creneaux_catalogue` (table V2 des 4 types fixes) →
    // creneau_id null, prévu par le schéma (« créneau manuel non catalogué »).
    const creneauId = ctx.creneauIdParCode.get(a.type) ?? null
    const { dateDebut, dateFin } = calculerHoraires(a.date, a.type, ctx.structure)

    // Généralisé P3b : une ligne par PLACE pourvue, avec son label réel.
    // Défaut [premier, second] → exactement les deux lignes historiques.
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

// ── Reconstruction V1 → lignes V2, bornée à des JOURS ───────

/**
 * construireLignesPourJours — lignes V2 attendues pour un SOUS-ENSEMBLE de
 * jours, reconstruites depuis la V1 (`gardes` + miroir `garde_placements`).
 *
 * SÉMANTIQUE = celle de la re-validation (`gardesVersPlanningPartiel`) :
 *   - 'semaine' / 'ferie' (V1) → type moteur 'semaine_soir' — le moteur ne
 *     produit JAMAIS de slot 'ferie' (reclassification purement V1/scoring),
 *     donc la génération a bien écrit ces jours en creneau 'semaine_soir' ;
 *   - 'weekend' (samedi) → 'weekend' natif + 'vendredi_soir' la veille,
 *     DÉRIVÉ via les relations (défaut → inversion R8 historique) ;
 *   - code sur-mesure → passthrough, placements du miroir garde_placements.
 *
 * `gardes` DOIT contenir toutes les gardes des jours demandés ET les week-ends
 * du lendemain de chaque jour demandé (leur vendredi dérivé atterrit dans la
 * fenêtre). Les attributions reconstituées HORS des jours demandés sont
 * écartées (filtre sur a.date).
 */
export function construireLignesPourJours(
  gardes: GardeRow[],
  jours: readonly string[],
  ctx: ContexteLignesAttributions,
  options?: OptionsSurMesure,
): AttributionRow[] {
  const joursSet = new Set(jours)
  const planning = gardesVersPlanningPartiel(gardes, options)
  const bornees: AttributionGarde[] = planning.attributions.filter((a) =>
    joursSet.has(a.date),
  )
  return construireLignesAttributions({ attributions: bornees }, ctx)
}

// ── Comparaison V1 ↔ V2 (détecteur de dérive) ────────────────

/** Ligne V2 minimale lue en base pour le contrôle de cohérence. */
export interface AttributionLue {
  veterinaire_id: string
  role: string
  date_debut_reel: string
}

/** Une divergence V1 ↔ V2 détectée (multiset jour × véto × rôle). */
export interface DivergenceV1V2 {
  /** Jour (Europe/Paris) du début de l'attribution concernée. */
  date: string
  veterinaireId: string
  role: string
  /** 'manquant' = attendu d'après V1 mais absent de V2 ; 'orphelin' = présent en V2 sans contrepartie V1. */
  nature: 'manquant' | 'orphelin'
}

/** Jour calendaire Europe/Paris ('yyyy-mm-dd') d'un horodatage ISO. */
export function jourParisDe(isoTimestamp: string): string {
  // fr-CA → format ISO yyyy-mm-dd directement.
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoTimestamp))
}

/**
 * comparerAttributionsV1V2 — confronte le planning ATTENDU (reconstruit depuis
 * la V1) aux lignes RÉELLES de la table `attributions`.
 *
 * Comparaison sur le MULTISET (jour Paris, véto, rôle) — volontairement PAS sur
 * les horodatages exacts : un cabinet qui modifie ses horaires de profil après
 * génération décalerait tous les timestamps sans que le planning (qui, quel
 * jour, quel rôle) ait changé. Le jour de début suffit à détecter toute dérive
 * d'équipe (le vendredi V2 explicite tombe sur SON jour, distinct du samedi).
 */
export function comparerAttributionsV1V2(
  planningV1: PlanningPartiel,
  lignesV2: readonly AttributionLue[],
): DivergenceV1V2[] {
  type Info = { date: string; veterinaireId: string; role: string }
  const compte = new Map<string, { n: number; info: Info }>()

  const incr = (info: Info, delta: number) => {
    const cle = `${info.date}|${info.veterinaireId}|${info.role}`
    const cur = compte.get(cle)
    if (cur) cur.n += delta
    else compte.set(cle, { n: delta, info })
  }

  // Attendu (V1 reconstruite) : +1 par place pourvue.
  for (const a of planningV1.attributions) {
    for (const p of a.placements) {
      if (!p.vetId) continue
      incr({ date: a.date, veterinaireId: p.vetId, role: p.role }, +1)
    }
  }

  // Réel (V2) : -1 par ligne.
  for (const l of lignesV2) {
    incr(
      { date: jourParisDe(l.date_debut_reel), veterinaireId: l.veterinaire_id, role: l.role },
      -1,
    )
  }

  const out: DivergenceV1V2[] = []
  for (const { n, info } of compte.values()) {
    if (n === 0) continue
    const nature: DivergenceV1V2['nature'] = n > 0 ? 'manquant' : 'orphelin'
    for (let i = 0; i < Math.abs(n); i++) {
      out.push({ date: info.date, veterinaireId: info.veterinaireId, role: info.role, nature })
    }
  }
  out.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.veterinaireId.localeCompare(b.veterinaireId)))
  return out
}
