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

  // ── LE SOCLE, PUIS L'AFFINAGE (2026-08-04) ──────────────────────────────
  // Les créneaux ne sont plus dupliqués par période type : il existe UN socle
  // par cabinet (`profil_id IS NULL`) qui décrit ce qui est possible, et chaque
  // période type dit ensuite combien de vétérinaires elle veut sur chacun.
  // MiKL : « la structure donne l'ensemble des possibilités, les périodes types
  // les affinent par période ».
  const { data, error } = await supabase
    .from('creneau_modele')
    .select('id, code, nom, jours_semaine, sur_feries, heure_debut, heure_fin, offset_jours_fin, nb_places, roles, actif, ordre')
    .eq('cabinet_id', cabinetId)
    .is('profil_id', null)
    .order('ordre')

  if (error || !data) return []

  const socle = (data as CreneauModeleRow[]).map((r) => ({
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

  // Quelle période type affine ? Celle demandée, sinon celle par défaut du
  // cabinet (les plannings d'avant la règle du 2026-08-04 n'en désignent
  // aucune). Sans période type résolue, le socle s'applique tel quel.
  const profil = await resoudreProfilId(supabase, cabinetId, profilId)
  if (!profil) return socle

  return appliquerAffinage(socle, await chargerAffinage(supabase, profil))
}

/** Les choix d'une période type : `creneau_id` → nombre de vétérinaires voulu. */
export async function chargerAffinage(
  supabase: SupabaseClient,
  profilId: string,
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('periode_type_creneau')
    .select('creneau_id, nb_vetos')
    .eq('profil_id', profilId)
  const m = new Map<string, number>()
  for (const r of (data ?? []) as { creneau_id: string; nb_vetos: number }[]) {
    m.set(r.creneau_id, r.nb_vetos)
  }
  return m
}

/**
 * Combien de places une période type utilise RÉELLEMENT sur un créneau du socle.
 *
 * `null` = le créneau disparaît de cette période (pas de garde de ce type).
 * Le socle dit ce qui est POSSIBLE ; la période type dit ce qu'elle en veut ;
 * on ne dépasse jamais le premier.
 *
 * ⚠️ SOURCE UNIQUE — la même question se pose à trois endroits : ici pour le
 * moteur, et deux fois dans `data/v2/reglesStructure.ts` (les créneaux d'une
 * période type, et ce que l'écran de structure annonce des places). Recopier
 * `Math.min` à trois endroits, c'est garantir qu'un jour deux d'entre eux ne
 * diront plus la même chose — et l'écran annoncerait alors des gardes que le
 * moteur ne pose pas. Toute la règle tient ici, et nulle part ailleurs.
 */
export function placesEffectives(nbPlacesSocle: number, voulu: number | undefined): number | null {
  if (voulu === undefined) return nbPlacesSocle // période type neuve : tout le possible
  if (voulu <= 0) return null // pas de garde de ce type sur cette période
  return Math.min(voulu, nbPlacesSocle)
}

/**
 * Applique les choix d'une période type au socle. FONCTION PURE — testée sans
 * base, parce que c'est ici que se joue « il n'y a pas de garde ce jour-là ».
 *
 * ⚠️ `nb_vetos = 0` RETIRE le créneau (MiKL : « laisse la possibilité qu'il n'y
 * ait rien… faut que le planning en tienne compte »). On le sort de la liste
 * plutôt que de le laisser à zéro place : un créneau à 0 place traverserait
 * tout le moteur en émettant zéro slot, mais resterait compté par les écrans,
 * le diagnostic d'impasse et le validateur comme un type de garde du cabinet.
 * Absent, il ne peut mentir nulle part.
 *
 * Un créneau SANS ligne d'affinage garde le nombre de places du socle : c'est
 * l'état d'une période type neuve, qui part de tout ce qui est possible.
 */
export function appliquerAffinage(
  socle: CreneauModele[],
  affinage: ReadonlyMap<string, number>,
): CreneauModele[] {
  const resultat: CreneauModele[] = []
  for (const c of socle) {
    const n = placesEffectives(c.nbPlaces, affinage.get(c.id))
    if (n === null) continue
    if (n === c.nbPlaces) { resultat.push(c); continue }
    // Les rôles sont tronqués avec les places : le socle nomme les places
    // disponibles, en garder plus produirait des libellés sans slot.
    resultat.push({ ...c, nbPlaces: n, roles: c.roles.slice(0, n) })
  }
  return resultat
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

  // Les enchaînements appartiennent au SOCLE depuis le 2026-08-04 : ils
  // décrivent la structure (« le vendredi et le week-end, même binôme »), pas
  // un choix de saison. Ils suivent donc les créneaux, et une période type qui
  // retire un créneau (0 véto) neutralise mécaniquement les liaisons qui le
  // visaient — le filtrage ci-dessous.
  const { data, error } = await supabase
    .from('relation_creneau')
    .select('id, source_id, cible_id, genre, actif')
    .eq('cabinet_id', cabinetId)
    .is('profil_id', null)

  if (error || !data) return []

  const relations = (data as RelationCreneauRow[]).map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    cibleId: r.cible_id,
    genre: r.genre as GenreRelationCreneau,
    actif: r.actif,
  }))

  // Une liaison dont un bout n'existe pas sur cette période type est une
  // liaison morte : la garder ferait raisonner le moteur sur un créneau qu'il
  // ne posera jamais.
  const profil = await resoudreProfilId(supabase, cabinetId, profilId)
  if (!profil) return relations
  const affinage = await chargerAffinage(supabase, profil)
  const retires = new Set(
    [...affinage.entries()].filter(([, n]) => n <= 0).map(([id]) => id),
  )
  if (retires.size === 0) return relations
  return relations.filter((r) => !retires.has(r.sourceId) && !retires.has(r.cibleId))
}
