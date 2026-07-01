// ============================================================
// GUARDVETO — persisterResultat
// ============================================================
// Convertit le planning produit par le solver en attributions V2
// et les insère en base (table `attributions`), puis prend un
// snapshot des règles actives (table `snapshots_regles` via RPC
// `prendre_snapshot`).
//
// Horaires appliqués (Europe/Paris) :
//   semaine_soir / vendredi_soir : début = 18h30, fin = +1j 08h30
//   weekend                      : début = 08h30 (samedi), fin = +2j 08h30
//   ferie                        : début = 08h30, fin = +1j 08h30
//
// Note de transition V1 → V2 :
//   - Cette fonction écrit dans `attributions` (table V2).
//   - La route continue d'écrire dans `gardes` (table V1) en
//     parallèle jusqu'à la fin de la migration F1-002.
// ============================================================

import { createClient } from '@/lib/supabase/server'
import type { PlanningPartiel, TypeGardeEngine } from '@/engine/types'
import { premierId, secondId } from '@/engine/attribution'
import { horairesResolus, type StructureCreneauxResolue } from '@/engine/structure-creneaux'
import { chargerStructureCabinet } from '@/data/chargerStructureCabinet'

// ── Types internes ───────────────────────────────────────────

interface AttributionRow {
  cabinet_id: string
  planning_id: string
  creneau_id: string | null
  veterinaire_id: string
  role: 'premier' | 'second'
  type_presence: 'sur_place'
  date_debut_reel: string
  date_fin_reel: string
  snapshot_id: string | null
}

// ── Mapping TypeGardeEngine → code creneaux_catalogue ────────

function typeEngineVersCodeCreneau(type: TypeGardeEngine): string {
  switch (type) {
    case 'vendredi_soir': return 'vendredi_soir'
    case 'weekend':       return 'weekend'
    case 'ferie':         return 'ferie'
    case 'semaine_soir':  return 'semaine_soir'
  }
}

// ── Calcul des horodatages (Europe/Paris) ────────────────────

/**
 * Retourne une date ISO 8601 UTC correspondant à l'heure locale
 * Europe/Paris pour la date et le décalage horaire donnés.
 *
 * On utilise l'API Intl pour déduire l'offset Paris au moment
 * de la date (gestion automatique heure d'été / heure d'hiver).
 */
function toUTCString(dateISO: string, heureLocale: string): string {
  // heureLocale = 'HH:MM' (ex: '18:30', '08:30')
  const [hh, mm] = heureLocale.split(':').map(Number)
  // Construire la date en heure locale Paris
  // On passe par un Date UTC puis on ajuste l'offset
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

/**
 * Calcule date_debut_reel et date_fin_reel pour une attribution,
 * selon le type de créneau.
 *
 * Mapping identique à la migration F1-002 (020260616170002_migrate_gardes.sql).
 */
function calculerHoraires(
  date: string,
  type: TypeGardeEngine,
  structure: StructureCreneauxResolue,
): { dateDebut: string; dateFin: string } {
  function addDaysISO(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }

  // Horaires résolus pour CE cabinet (A1 : structure par défaut + surcharge
  // cabinet). Repli automatique sur le défaut si le cabinet n'a rien personnalisé.
  const { heureDebut, heureFin, offsetJoursFin } = horairesResolus(structure, type)
  return {
    dateDebut: toUTCString(date, heureDebut),
    dateFin:   toUTCString(addDaysISO(date, offsetJoursFin), heureFin),
  }
}

// ── Chargement du catalogue de créneaux ─────────────────────

type CreneauCatalogueRow = { id: string; code: string }

async function chargerCreneauxCatalogue(): Promise<Map<string, string>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('creneaux_catalogue')
    .select('id, code')

  if (error || !data) return new Map()

  const map = new Map<string, string>()
  for (const row of data as CreneauCatalogueRow[]) {
    map.set(row.code, row.id)
  }
  return map
}

// ── API publique ─────────────────────────────────────────────

export interface PersistenceResultat {
  snapshotId: string
  nbAttributions: number
}

/**
 * persisterResultat — Convertit le planning du solver en attributions V2
 * et les insère en base (idempotent via ON CONFLICT DO NOTHING sur l'index
 * idx_attributions_garde_role).
 *
 * Ensuite, prend un snapshot des règles actives du cabinet pour
 * garantir la traçabilité de la génération (F8-001).
 *
 * @param planning    Planning produit par genererPlanningPur()
 * @param periodeId   UUID de la période (= planning_id dans attributions)
 * @param cabinetId   UUID du cabinet (lu depuis app_metadata — règle C1)
 * @throws            Si l'insertion ou le snapshot échoue
 */
export async function persisterResultat(
  planning: PlanningPartiel,
  periodeId: string,
  cabinetId: string
): Promise<PersistenceResultat> {
  const supabase = await createClient()

  // 1. Charger le catalogue de créneaux (pour résoudre creneau_id)
  const creneauMap = await chargerCreneauxCatalogue()

  // 1b. Structure des créneaux résolue pour ce cabinet (horaires par défaut +
  //     surcharge cabinet A1). Vide → défauts : comportement inchangé.
  const structure = await chargerStructureCabinet(supabase, cabinetId)

  // 2. Prendre un snapshot des règles actives AVANT l'insertion
  //    (F8-002 : le snapshot_id doit être connu au moment de construire les lignes)
  const { data: snapshotId, error: snapshotErr } = await supabase.rpc('prendre_snapshot', {
    p_planning_id: periodeId,
    p_cabinet_id:  cabinetId,
  })

  if (snapshotErr || !snapshotId) {
    throw new Error(
      `Erreur snapshot des règles : ${snapshotErr?.message ?? 'snapshotId null'}`
    )
  }

  const snapshotIdStr = snapshotId as string

  // 3. Supprimer les attributions existantes de cette période (régénération)
  const { error: deleteErr } = await supabase
    .from('attributions')
    .delete()
    .eq('planning_id', periodeId)
    .eq('cabinet_id', cabinetId)

  if (deleteErr) {
    throw new Error(`Erreur suppression des attributions existantes : ${deleteErr.message}`)
  }

  // 4. Construire les lignes à insérer
  //    Une ligne par (attribution × rôle occupé), avec snapshot_id (F8-002)
  const rows: AttributionRow[] = []

  for (const a of planning.attributions) {
    const codeCreneau = typeEngineVersCodeCreneau(a.type)
    const creneauId = creneauMap.get(codeCreneau) ?? null
    const { dateDebut, dateFin } = calculerHoraires(a.date, a.type, structure)

    const premier = premierId(a)
    if (premier) {
      rows.push({
        cabinet_id:       cabinetId,
        planning_id:      periodeId,
        creneau_id:       creneauId,
        veterinaire_id:   premier,
        role:             'premier',
        type_presence:    'sur_place',
        date_debut_reel:  dateDebut,
        date_fin_reel:    dateFin,
        snapshot_id:      snapshotIdStr,
      })
    }

    const second = secondId(a)
    if (second) {
      rows.push({
        cabinet_id:       cabinetId,
        planning_id:      periodeId,
        creneau_id:       creneauId,
        veterinaire_id:   second,
        role:             'second',
        type_presence:    'sur_place',
        date_debut_reel:  dateDebut,
        date_fin_reel:    dateFin,
        snapshot_id:      snapshotIdStr,
      })
    }
  }

  // 5. Insérer en bloc (idempotent via index unique idx_attributions_garde_role)
  if (rows.length > 0) {
    const { error: insertErr } = await supabase
      .from('attributions')
      .insert(rows)

    if (insertErr) {
      throw new Error(`Erreur insertion des attributions : ${insertErr.message}`)
    }
  }

  // 6. Lier la période à son snapshot (F8-002 : periodes.snapshot_id)
  const { error: updatePeriodeErr } = await supabase
    .from('periodes')
    .update({ snapshot_id: snapshotIdStr })
    .eq('id', periodeId)

  if (updatePeriodeErr) {
    throw new Error(
      `Erreur mise à jour periodes.snapshot_id : ${updatePeriodeErr.message}`
    )
  }

  return {
    snapshotId: snapshotIdStr,
    nbAttributions: rows.length,
  }
}
