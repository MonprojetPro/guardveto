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
 * resoudreProfilId — id du profil EFFECTIF d'un cabinet : celui demandé
 * (`profilId`), sinon le profil DÉFAUT du cabinet (`est_defaut = true`).
 *
 * SOURCE UNIQUE de résolution du profil (P5 slice 3) : utilisée par le loader
 * du catalogue ET par la lecture de l'effectif porté par le profil, pour que
 * les deux photographient le MÊME profil. `undefined` si le cabinet n'a aucun
 * profil défaut (cas théorique) → le moteur retombe sur le mapping en dur.
 */
export async function resoudreProfilId(
  supabase: SupabaseClient,
  cabinetId: string,
  profilId?: string,
): Promise<string | undefined> {
  if (profilId) return profilId
  const { data: def } = await supabase
    .from('profils_planning')
    .select('id')
    .eq('cabinet_id', cabinetId)
    .eq('est_defaut', true)
    .maybeSingle()
  return (def as { id: string } | null)?.id ?? undefined
}

/**
 * chargerEffectifProfil — effectif de garde la nuit en semaine (1 ou 2) porté
 * par un profil (P5 slice 3), ou `undefined` si non réglé / colonne absente /
 * erreur. Best-effort : jamais de throw (repli saison en aval).
 */
export async function chargerEffectifProfil(
  supabase: SupabaseClient,
  profilId: string,
): Promise<number | undefined> {
  const { data } = await supabase
    .from('profils_planning')
    .select('nb_vetos_semaine_soir')
    .eq('id', profilId)
    .maybeSingle()
  const v = (data as { nb_vetos_semaine_soir?: number | null } | null)?.nb_vetos_semaine_soir
  return typeof v === 'number' ? v : undefined
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
  const profil = await resoudreProfilId(supabase, cabinetId, profilId)
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

/**
 * Relations entre créneaux d'un cabinet, SCOPÉES À UN PROFIL (RG1) —
 * même résolution de profil que le catalogue (`resoudreProfilId`, source
 * unique) pour que catalogue et relations photographient le MÊME profil.
 * Vide si aucune. Best-effort : jamais de throw.
 *
 * ⚠️ RG1 (tranche 1) : chargées mais PAS encore consommées par le moteur —
 * le branchement (hard-constraints, scoring, solver, validateur) = tranche 2.
 */
export async function chargerRelationsCreneau(
  supabase: SupabaseClient,
  cabinetId?: string,
  profilId?: string,
): Promise<RelationCreneau[]> {
  if (!cabinetId) return []

  const profil = await resoudreProfilId(supabase, cabinetId, profilId)
  if (!profil) return []

  const { data, error } = await supabase
    .from('relation_creneau')
    .select('id, source_id, cible_id, genre, actif')
    .eq('cabinet_id', cabinetId)
    .eq('profil_id', profil)

  if (error || !data) return []

  return (data as RelationCreneauRow[]).map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    cibleId: r.cible_id,
    genre: r.genre as GenreRelationCreneau,
    actif: r.actif,
  }))
}
