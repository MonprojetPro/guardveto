// ============================================================
// GUARDVETO — Chargeur du catalogue de créneaux PAR CABINET (Phase 1)
// ============================================================
// Lit `creneau_modele` (+ `relation_creneau`) et produit le catalogue du
// cabinet. BEST-EFFORT : pas de cabinetId / table absente / erreur → vide.
//
// ⚠️ P1 : ce loader existe mais n'est PAS encore consommé par le moteur
// (branchement en P2). Prend le client Supabase en paramètre.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CreneauModele,
  RelationCreneau,
  GenreRelationCreneau,
} from '@/engine/creneau-modele'

interface CreneauModeleRow {
  id: string
  code: string | null
  nom: string
  jours_semaine: number[] | null
  sur_feries: boolean
  heure_debut: string
  heure_fin: string
  offset_jours_fin: number
  nb_places: number
  roles: string[] | null
  actif: boolean
  ordre: number
}

interface RelationCreneauRow {
  id: string
  source_id: string
  cible_id: string
  genre: string
  actif: boolean
}

/** Postgres TIME 'HH:MM:SS' → 'HH:MM'. */
function hhmm(t: string): string {
  return t.slice(0, 5)
}

/**
 * Catalogue de créneaux d'un cabinet, SCOPÉ À UN PROFIL (P5). Vide si aucun.
 *
 * Un cabinet compose plusieurs profils de planning nommés ; le catalogue lu est
 * celui du profil `profilId` s'il est fourni, sinon celui du profil DÉFAUT du
 * cabinet (`est_defaut = true`). Sans profil résolu (cabinet sans profil défaut,
 * cas théorique) → `[]`, et le moteur retombe sur le mapping en dur — comme les
 * contextes legacy. Tant qu'un cabinet n'a que son profil défaut (seed), le
 * résultat est IDENTIQUE à avant l'introduction des profils.
 */
export async function chargerCreneauModele(
  supabase: SupabaseClient,
  cabinetId?: string,
  profilId?: string,
): Promise<CreneauModele[]> {
  if (!cabinetId) return []

  // Résoudre le profil : demandé, sinon le profil défaut du cabinet.
  let profil = profilId
  if (!profil) {
    const { data: def } = await supabase
      .from('profils_planning')
      .select('id')
      .eq('cabinet_id', cabinetId)
      .eq('est_defaut', true)
      .maybeSingle()
    profil = (def as { id: string } | null)?.id ?? undefined
  }
  if (!profil) return []

  const { data, error } = await supabase
    .from('creneau_modele')
    .select('id, code, nom, jours_semaine, sur_feries, heure_debut, heure_fin, offset_jours_fin, nb_places, roles, actif, ordre')
    .eq('cabinet_id', cabinetId)
    .eq('profil_id', profil)
    .order('ordre')

  if (error || !data) return []

  return (data as CreneauModeleRow[]).map((r) => ({
    id: r.id,
    code: r.code,
    nom: r.nom,
    joursSemaine: r.jours_semaine ?? [],
    surFeries: r.sur_feries,
    heureDebut: hhmm(r.heure_debut),
    heureFin: hhmm(r.heure_fin),
    offsetJoursFin: r.offset_jours_fin,
    nbPlaces: r.nb_places,
    roles: r.roles ?? [],
    actif: r.actif,
    ordre: r.ordre,
  }))
}

/** Relations entre créneaux d'un cabinet. Vide si aucune. */
export async function chargerRelationsCreneau(
  supabase: SupabaseClient,
  cabinetId?: string,
): Promise<RelationCreneau[]> {
  if (!cabinetId) return []

  const { data, error } = await supabase
    .from('relation_creneau')
    .select('id, source_id, cible_id, genre, actif')
    .eq('cabinet_id', cabinetId)

  if (error || !data) return []

  return (data as RelationCreneauRow[]).map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    cibleId: r.cible_id,
    genre: r.genre as GenreRelationCreneau,
    actif: r.actif,
  }))
}
