// ============================================================
// GUARDVETO — Chargeur de la structure des créneaux PAR CABINET (A1)
// ============================================================
// Lit la surcouche `creneaux_cabinet` (horaires propres au cabinet) et la
// fusionne avec les horaires par défaut (structure-creneaux) pour produire
// une StructureCreneauxResolue.
//
// BEST-EFFORT (même philosophie que nb_vetos_semaine_soir dans loader.ts) :
//   - pas de cabinetId → défaut
//   - table absente / erreur / cabinet sans ligne → défaut
// Aucune contrainte d'ordre de déploiement : tant qu'un cabinet ne
// personnalise rien, le comportement est strictement inchangé.
//
// Prend le client Supabase en paramètre (server OU client déjà instancié)
// pour rester utilisable des deux côtés (persistance ET synchro agenda).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { TypeGardeEngine } from '@/engine/types'
import {
  type StructureCreneauxResolue,
  type HorairesCreneau,
  structureParDefaut,
  resoudreStructure,
} from '@/engine/structure-creneaux'
import { chargerCreneauModele } from '@/data/chargerCreneauModele'

interface CreneauCabinetRow {
  code: string
  heure_debut: string        // Postgres TIME → 'HH:MM:SS'
  heure_fin: string
  offset_jours_fin: number
  actif: boolean
}

const CODES_VALIDES: TypeGardeEngine[] = ['semaine_soir', 'vendredi_soir', 'weekend', 'ferie']

/** Postgres TIME renvoie 'HH:MM:SS' ; la structure travaille en 'HH:MM'. */
function hhmm(t: string): string {
  return t.slice(0, 5)
}

/**
 * Structure des créneaux résolue pour un cabinet (horaires par défaut +
 * surcharges du cabinet). Retombe sur le défaut en l'absence de config.
 */
export async function chargerStructureCabinet(
  supabase: SupabaseClient,
  cabinetId?: string,
): Promise<StructureCreneauxResolue> {
  if (!cabinetId) return structureParDefaut()

  const { data, error } = await supabase
    .from('creneaux_cabinet')
    .select('code, heure_debut, heure_fin, offset_jours_fin, actif')
    .eq('cabinet_id', cabinetId)

  if (error || !data || data.length === 0) return structureParDefaut()

  const overrides: Partial<Record<TypeGardeEngine, Partial<HorairesCreneau>>> = {}
  for (const row of data as CreneauCabinetRow[]) {
    if (!CODES_VALIDES.includes(row.code as TypeGardeEngine)) continue
    overrides[row.code as TypeGardeEngine] = {
      heureDebut: hhmm(row.heure_debut),
      heureFin: hhmm(row.heure_fin),
      offsetJoursFin: row.offset_jours_fin,
    }
  }
  return resoudreStructure(overrides)
}

// ── Structure horaire PAR PROFIL (P5 slice 4b) ───────────────

/**
 * chargerStructureProfil — structure horaire résolue depuis le CATALOGUE DU
 * PROFIL (`creneau_modele`), source PAR PROFIL. Remplace la lecture cabinet-large
 * (`creneaux_cabinet`) pour la persistance et l'agenda : un profil « Été » peut
 * ainsi porter des horaires distincts d'« Hiver ».
 *
 * Généralisé P3b : TOUT code non-null du catalogue porte ses horaires — les 4
 * types connus (surcharge du défaut) comme les créneaux SUR-MESURE (entrée
 * ajoutée, l'aval sait maintenant les horodater). Un créneau à code null reste
 * ignoré (jamais planifié). Repli défaut si pas de cabinet / catalogue vide.
 *
 * BYTE-IDENTIQUE pour le catalogue par défaut : mêmes 4 codes, mêmes horaires.
 */
export async function chargerStructureProfil(
  supabase: SupabaseClient,
  cabinetId?: string,
  profilId?: string,
): Promise<StructureCreneauxResolue> {
  if (!cabinetId) return structureParDefaut()

  const creneaux = await chargerCreneauModele(supabase, cabinetId, profilId)
  if (creneaux.length === 0) return structureParDefaut()

  const overrides: Record<string, Partial<HorairesCreneau>> = {}
  for (const c of creneaux) {
    if (!c.code) continue
    overrides[c.code] = {
      heureDebut: c.heureDebut,   // déjà 'HH:MM' (chargerCreneauModele)
      heureFin: c.heureFin,
      offsetJoursFin: c.offsetJoursFin,
    }
  }
  return resoudreStructure(overrides)
}

/**
 * Variante « par période » : résout le cabinet + le profil de la période, puis
 * délègue à chargerStructureProfil. Point d'accès des consommateurs qui ne
 * connaissent que la période (persistance, agenda).
 */
export async function chargerStructureProfilPeriode(
  supabase: SupabaseClient,
  periodeId: string,
): Promise<StructureCreneauxResolue> {
  const { data } = await supabase
    .from('periodes')
    .select('cabinet_id, profil_id')
    .eq('id', periodeId)
    .single()
  const per = data as { cabinet_id?: string; profil_id?: string | null } | null
  return chargerStructureProfil(supabase, per?.cabinet_id, per?.profil_id ?? undefined)
}
