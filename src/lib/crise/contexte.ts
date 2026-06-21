// ============================================================
// GUARDVETO — Gestion de crise : assemblage du contexte moteur
// ============================================================
// Outils PARTAGÉS par les deux routes de crise (POST /api/absences et
// POST /api/absences/[id]/reparer) pour :
//   1. retrouver les CRÉNEAUX IMPACTÉS par une absence (gardes futures du
//      véto absent, dans les périodes du cabinet) ;
//   2. assembler le contexte que `proposerReparation` attend, en passant
//      EXACTEMENT la même config (vets + calendrier + structure + équité)
//      que la génération — via `resoudreContexte`. Sans ça, on recréerait
//      le piège connu : des « remplaçants légaux » qui violent en réalité
//      R8/R9 (cf. r8r9-reglables-deux-gardiens / moteur-cecite-params-nesting).
//
// ⚠️ Mapping type DB → moteur (identique à la route disponibilites) :
//   gardes.type 'weekend'           → engine 'weekend'
//   gardes.type 'semaine' | 'ferie' → engine 'semaine_soir'
//   (vendredi_soir est fusionné dans 'weekend' côté V1 — cf. persisterResultat).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { resoudreContexte } from '@/data/resoudreContexte'
import type {
  VetEngine,
  AttributionGarde,
  TypeGardeEngine,
  RoleGarde,
  CalendrierResolu,
  Saison,
} from '@/engine/types'
import type { EquityWeights } from '@/engine/equity-weights'
import { DEFAULT_STRUCTURE_CONFIG, type StructureConfig } from '@/engine/structure-config'

// ── Type DB → moteur ─────────────────────────────────────

/** Type DB des gardes (V1). */
export type TypeGardeDb = 'semaine' | 'weekend' | 'ferie'

/** Mappe le type DB d'une garde vers le type moteur (cf. route disponibilites). */
export function mapDbTypeToEngine(type: string): Extract<TypeGardeEngine, 'semaine_soir' | 'weekend'> {
  return type === 'weekend' ? 'weekend' : 'semaine_soir'
}

// ── Un créneau impacté par l'absence ─────────────────────

/** Une garde future du véto absent + le rôle qu'il y tenait. */
export interface CreneauImpacte {
  gardeId: string
  date: string
  /** Type DB tel que stocké dans `gardes` (pour l'affichage / le re-check). */
  type: TypeGardeDb
  /** Type moteur dérivé (pour proposerReparation). */
  typeEngine: Extract<TypeGardeEngine, 'semaine_soir' | 'weekend'>
  /** Rôle libéré par l'absence sur ce créneau. */
  role: RoleGarde
  /** Saison de la période (pour l'effectif / équité). */
  saison: Saison
  /** Période de la garde. */
  periodeId: string
}

// ── Contexte moteur par période ──────────────────────────

/** Contexte moteur (cohérent génération) pour UNE période. */
export interface ContexteCrisePeriode {
  vets: VetEngine[]
  planningComplet: AttributionGarde[]
  calendrier?: CalendrierResolu
  structure: StructureConfig
  equityWeights?: EquityWeights
  saison: Saison
  /**
   * Effectif semaine configurable (1 ou 2). Absent → repli saison (hiver=2/été=1).
   * ⚠️ DOIT être threadé jusqu'au créneau (besoinSecond) : sinon un cabinet en
   * effectif=2 l'été verrait R17 bloquer à tort le remplacement d'un 2nd semaine
   * (le repli saison dirait « pas de 2nd l'été »). Cohérence avec la génération.
   */
  nbVetosSemaineSoir?: number
}

/**
 * besoinSecondCreneau — un créneau a-t-il besoin d'un 2nd, selon l'effectif
 * configuré de la période ? Weekend → toujours. semaine_soir → effectif ≥ 2
 * (config si fournie, sinon repli saison hiver=2/été=1). Doit refléter EXACTEMENT
 * la logique du solver (`effectifSemaine`) pour que la réparation soit cohérente.
 */
export function besoinSecondCreneau(
  typeEngine: Extract<TypeGardeEngine, 'semaine_soir' | 'weekend'>,
  saison: Saison,
  nbVetosSemaineSoir?: number,
): boolean {
  if (typeEngine === 'weekend') return true
  const effectif = nbVetosSemaineSoir ?? (saison === 'hiver' ? 2 : 1)
  return effectif >= 2
}

// ── Helpers internes ─────────────────────────────────────

interface GardeRow {
  id: string
  date: string
  type: TypeGardeDb
  premier_id: string | null
  second_id: string | null
  periode_id: string
}

/**
 * Charge TOUTES les gardes d'une période et les mappe en AttributionGarde[]
 * (planning publié complet) pour le moteur. Source : table `gardes` (V1).
 */
function gardesToPlanningComplet(gardes: GardeRow[]): AttributionGarde[] {
  return gardes.map((g): AttributionGarde => ({
    date: g.date,
    type: mapDbTypeToEngine(g.type),
    premier_id: g.premier_id,
    second_id: g.second_id,
  }))
}

// ── API publique ─────────────────────────────────────────

/**
 * recenserCreneauxImpactes — gardes FUTURES du véto absent, dans la fenêtre
 * [date_debut, date_fin] de l'absence, scopées cabinet, statut publié/verrouillé.
 *
 * RÈGLE MÉTIER : on ne touche JAMAIS au passé → date >= aujourd'hui ET
 * date >= date_debut de l'absence. On ne considère que les gardes où le véto
 * absent est réellement 1er OU 2nd (le rôle libéré est déduit en conséquence).
 *
 * @param supabase     client serveur (RLS-aware, cabinet borné)
 * @param cabinetId    cabinet courant
 * @param absentId     véto absent
 * @param dateDebut    début de l'absence (ISO yyyy-MM-dd)
 * @param dateFin      fin de l'absence (ISO yyyy-MM-dd)
 * @param aujourdhui   date du jour (ISO yyyy-MM-dd) — injectable pour les tests
 */
export async function recenserCreneauxImpactes(
  supabase: SupabaseClient,
  cabinetId: string,
  absentId: string,
  dateDebut: string,
  dateFin: string,
  aujourdhui: string = new Date().toISOString().slice(0, 10),
): Promise<CreneauImpacte[]> {
  // Borne basse = max(début absence, aujourd'hui) — on ne répare jamais le passé.
  const borneBasse = dateDebut > aujourdhui ? dateDebut : aujourdhui

  // Gardes du cabinet où le véto absent est 1er OU 2nd, dans la fenêtre future.
  const { data: gardesDb, error } = await supabase
    .from('gardes')
    .select('id, date, type, premier_id, second_id, periode_id, periodes!inner(saison, statut)')
    .eq('cabinet_id', cabinetId)
    .gte('date', borneBasse)
    .lte('date', dateFin)
    .or(`premier_id.eq.${absentId},second_id.eq.${absentId}`)
    .order('date')

  if (error) {
    throw new Error(`Erreur lecture des gardes impactées : ${error.message}`)
  }

  type Row = GardeRow & { periodes: { saison: Saison; statut: string } | { saison: Saison; statut: string }[] }

  const impactes: CreneauImpacte[] = []
  for (const g of ((gardesDb as Row[] | null) ?? [])) {
    const per = Array.isArray(g.periodes) ? g.periodes[0] : g.periodes
    // On ne répare que des plannings DIFFUSÉS (publié/verrouillé) — un brouillon
    // se régénère, il n'a pas de « crise ».
    if (per?.statut !== 'publie' && per?.statut !== 'verrouille') continue

    // Le véto absent peut être 1er, 2nd, ou les deux (cas limite) → un créneau par rôle.
    const roles: RoleGarde[] = []
    if (g.premier_id === absentId) roles.push('premier')
    if (g.second_id === absentId) roles.push('second')

    for (const role of roles) {
      impactes.push({
        gardeId: g.id,
        date: g.date,
        type: g.type,
        typeEngine: mapDbTypeToEngine(g.type),
        role,
        saison: per.saison,
        periodeId: g.periode_id,
      })
    }
  }

  return impactes
}

/**
 * chargerContextePourPeriode — assemble le contexte moteur (cohérent avec la
 * génération) pour UNE période : vets + calendrier + structure + équité via
 * `resoudreContexte`, et le planning publié complet via les gardes V1.
 *
 * Mise en cache externe possible par l'appelant (Map<periodeId, …>) pour ne
 * pas recharger N fois quand plusieurs créneaux d'une même période sont touchés.
 */
export async function chargerContextePourPeriode(
  supabase: SupabaseClient,
  periodeId: string,
  cabinetId: string,
): Promise<ContexteCrisePeriode> {
  // 1. Contexte « génération » (vets + calendrier + structure + équité).
  //    `autoriserVerrouille:true` : un planning à réparer est publié OU verrouillé.
  //    La génération interdit le verrouillé (on ne régénère pas un planning figé) ;
  //    la crise, elle, doit pouvoir RÉPARER un créneau d'un planning verrouillé.
  //    Sans ce flag, resoudreContexte throw « période verrouillée » alors que
  //    recenserCreneauxImpactes a justement accepté les périodes verrouillées.
  const contexte = await resoudreContexte(periodeId, cabinetId, {
    autoriserVerrouille: true,
  })

  // 2. Planning publié COMPLET de la période (source de vérité UI = gardes V1).
  const { data: gardesDb, error } = await supabase
    .from('gardes')
    .select('id, date, type, premier_id, second_id, periode_id')
    .eq('periode_id', periodeId)
    .eq('cabinet_id', cabinetId)

  if (error) {
    throw new Error(`Erreur lecture du planning publié : ${error.message}`)
  }

  const planningComplet = gardesToPlanningComplet(((gardesDb as GardeRow[] | null) ?? []))

  return {
    vets: contexte.vets,
    planningComplet,
    calendrier: contexte.calendrier,
    structure: contexte.structureConfig ?? DEFAULT_STRUCTURE_CONFIG,
    equityWeights: contexte.equityWeights,
    saison: contexte.saison,
    nbVetosSemaineSoir: contexte.nbVetosSemaineSoir,
  }
}
