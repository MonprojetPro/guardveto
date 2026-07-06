// ============================================================
// GUARDVETO — Chargeur de la structure horaire des créneaux PAR PROFIL
// ============================================================
// Résout les horaires des créneaux (début/fin/jour de fin) depuis le CATALOGUE
// DU PROFIL (`creneau_modele`) et les fusionne avec les horaires par défaut
// (structure-creneaux) pour produire une StructureCreneauxResolue.
//
// (Historique : ce module lisait aussi la surcouche cabinet-large
// `creneaux_cabinet` — supprimée le 2026-07-06, cf. NOTE ci-dessous.)
//
// BEST-EFFORT (même philosophie que nb_vetos_semaine_soir dans loader.ts) :
//   - pas de cabinetId → défaut
//   - catalogue vide / erreur → défaut
// Aucune contrainte d'ordre de déploiement : tant qu'un cabinet ne
// personnalise rien, le comportement est strictement inchangé.
//
// Prend le client Supabase en paramètre (server OU client déjà instancié)
// pour rester utilisable des deux côtés (persistance ET synchro agenda).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type StructureCreneauxResolue,
  type HorairesCreneau,
  structureParDefaut,
  resoudreStructure,
} from '@/engine/structure-creneaux'
import { chargerCreneauModele } from '@/data/chargerCreneauModele'

// NOTE (nettoyage dette technique 2026-07-06) : `chargerStructureCabinet` (lecture
// de la surcouche cabinet-large `creneaux_cabinet`) a été SUPPRIMÉE — plus aucun
// appelant (les horaires sont lus PAR PROFIL, cf. `chargerStructureProfil`
// ci-dessous). La table `creneaux_cabinet` est droppée par la migration
// 20260706200000. Ce module ne porte plus que la résolution PAR PROFIL.

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
