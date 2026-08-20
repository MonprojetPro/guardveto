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
  CodeCreneau,
  RoleGarde,
  CalendrierResolu,
  Saison,
} from '@/engine/types'
import type { EquityWeights } from '@/engine/equity-weights'
import { DEFAULT_STRUCTURE_CONFIG, type StructureConfig } from '@/engine/structure-config'

// ── Type DB → moteur ─────────────────────────────────────

/** Type DB des gardes : 'semaine'/'weekend'/'ferie' (V1) ou code sur-mesure (P3b). */
export type TypeGardeDb = string

/**
 * Mappe le type DB d'une garde vers le type moteur (cf. route disponibilites).
 * Généralisé P3b : un code SUR-MESURE passe TEL QUEL (le code EST le type
 * moteur) — fini l'aplatissement silencieux en 'semaine_soir' qui faisait
 * évaluer les règles d'un soir de semaine sur une garde de jour.
 */
export function mapDbTypeToEngine(type: string): CodeCreneau {
  if (type === 'weekend') return 'weekend'
  if (type === 'semaine' || type === 'ferie') return 'semaine_soir'
  return type
}

// ── Un créneau impacté par l'absence ─────────────────────

/** Une garde future du véto absent + le rôle qu'il y tenait. */
export interface CreneauImpacte {
  gardeId: string
  date: string
  /** Type DB tel que stocké dans `gardes` (pour l'affichage / le re-check). */
  type: TypeGardeDb
  /** Type moteur dérivé (pour proposerReparation). */
  typeEngine: CodeCreneau
  /** Rôle libéré par l'absence sur ce créneau. */
  role: RoleGarde
  /** Saison de la période (pour l'effectif / équité). */
  saison: Saison
  /** Période de la garde. */
  periodeId: string
  /**
   * Les JOURS du calendrier réellement couverts par l'absence sur ce créneau.
   *
   * Une garde de week-end est une ligne unique posée le SAMEDI qui occupe en
   * réalité vendredi, samedi et dimanche. Tant qu'on cherchait sur la seule
   * date de la ligne, une absence déclarée sur le seul vendredi ou le seul
   * dimanche ne trouvait AUCUN créneau : le système répondait « rien à
   * réparer » et le vétérinaire restait de garde, sans que personne ne soit
   * prévenu. C'était le trou le plus dangereux, parce que silencieux.
   *
   * Toujours au moins un jour. Plusieurs = l'absence couvre plusieurs jours
   * du bloc, l'admin choisira le périmètre (le jour seul ou le bloc entier).
   */
  joursTouches: string[]
  /**
   * Le créneau occupe-t-il plusieurs jours du calendrier ? Vrai pour un
   * week-end, faux pour un soir de semaine. C'est ce qui décide si la
   * question « ce seul jour ou tout le bloc ? » a un sens à poser.
   */
  blocMultiJours: boolean
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
  /**
   * Places déclarées par le créneau « soir de semaine » de la période type
   * (2026-08-04). Sans surcharge de planning, c'est LUI qui décide de l'effectif
   * d'une nuit — le repli saison ne s'applique plus qu'aux contextes sans
   * structure de gardes. Absent = pas de créneau semaine_soir au catalogue.
   */
  placesNuitSemaine?: number
  /**
   * R11b — rôle à avantage financier (réglage cabinet). Threadé au classement
   * des candidats (scorerCandidatLNS) pour que la crise trie avec le MÊME
   * critère d'équité que la génération. undefined → défaut moteur ('premier').
   */
  roleAvantageFinancier?: string | null
  /**
   * #17 — lookback inter-périodes (attributions figées de la période précédente).
   * Threadé à proposerReparation pour que la réparation d'un créneau en début de
   * période juge le rythme (R10/espacement) sur la MÊME jonction que la génération.
   * undefined → byte-identique.
   */
  contexteAnterieur?: AttributionGarde[]
}

/**
 * besoinSecondCreneau — un créneau a-t-il besoin d'un 2nd ? Weekend → toujours.
 * semaine_soir → effectif ≥ 2.
 *
 * ⚠️ Doit refléter EXACTEMENT la résolution du solver, sinon la réparation
 * d'une absence ne remplace pas ce que la génération avait posé. Depuis le
 * 2026-08-04 : surcharge du planning si elle existe, sinon les places du
 * créneau « soir de semaine » de la période type, sinon (aucune structure) le
 * repli saison.
 *
 * `placesNuitSemaine` est optionnel pour ne pas casser les appelants qui n'ont
 * pas de catalogue sous la main : sans lui, le comportement reste l'ancien.
 */
export function besoinSecondCreneau(
  typeEngine: CodeCreneau,
  saison: Saison,
  nbVetosSemaineSoir?: number,
  placesNuitSemaine?: number,
): boolean {
  if (typeEngine === 'weekend') return true
  if (typeEngine === 'semaine_soir') {
    if (typeof nbVetosSemaineSoir === 'number') return nbVetosSemaineSoir >= 2
    if (typeof placesNuitSemaine === 'number') return placesNuitSemaine >= 2
    return saison === 'hiver'
  }
  // Type SUR-MESURE : le besoin d'un 2nd = la garde en avait un (colonne V1).
  // On ne peut pas le déduire du type seul ; le caller passe l'info réelle via
  // le créneau (second_id présent). Repli conservateur : pas de 2nd exigé.
  return false
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
    placements: [
      { role: 'premier', vetId: g.premier_id },
      { role: 'second', vetId: g.second_id },
    ],
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

  // ⚠️ On interroge `planning_semaine`, PAS `gardes`.
  //
  // `gardes` ne dit que la date de la LIGNE : un week-end y vit sur le seul
  // samedi, alors qu'il occupe le calendrier du vendredi soir au lundi matin.
  // Chercher là-dedans, c'était rater toute absence déclarée sur un vendredi
  // ou un dimanche — en silence, ce qui est le pire des cas : le système
  // annonçait « aucun créneau impacté » et le vétérinaire restait de garde.
  //
  // La vue, elle, matérialise chaque jour réellement occupé, applique
  // l'inversion des rôles du vendredi quand le cabinet l'a configurée, et
  // n'invente pas de vendredi quand le binôme est découplé. C'est la seule
  // source qui répond juste à « qui est de garde CE jour-là ».
  const { data: joursDb, error } = await supabase
    .from('planning_semaine')
    .select('id, date, type, premier_id, second_id, periode_id, saison, periode_statut')
    .gte('date', borneBasse)
    .lte('date', dateFin)
    .or(`premier_id.eq.${absentId},second_id.eq.${absentId}`)
    .order('date')

  if (error) {
    throw new Error(`Erreur lecture des gardes impactées : ${error.message}`)
  }

  interface JourRow {
    id: string
    date: string
    type: TypeGardeDb
    premier_id: string | null
    second_id: string | null
    periode_id: string
    saison: Saison
    periode_statut: string
  }

  // Le RÔLE natif (celui que porte la ligne `gardes`) reste nécessaire : c'est
  // lui que `proposerReparation` répare. Le rôle affiché un vendredi peut être
  // l'inverse — réparer d'après l'affichage remplacerait la mauvaise place.
  const jours = ((joursDb as JourRow[] | null) ?? []).filter(
    (j) => j.periode_statut === 'publie' || j.periode_statut === 'verrouille',
  )
  if (jours.length === 0) return []

  const { data: gardesDb, error: erreurGardes } = await supabase
    .from('gardes')
    .select('id, date, type, premier_id, second_id, periode_id')
    .eq('cabinet_id', cabinetId)
    .in('id', [...new Set(jours.map((j) => j.id))])

  if (erreurGardes) {
    throw new Error(`Erreur lecture des gardes impactées : ${erreurGardes.message}`)
  }

  const gardesParId = new Map<string, GardeRow>()
  for (const g of ((gardesDb as GardeRow[] | null) ?? [])) gardesParId.set(g.id, g)

  // Un créneau par (garde, rôle natif) — comme avant — mais en portant
  // désormais la liste des jours que l'absence touche vraiment.
  const parCle = new Map<string, CreneauImpacte>()
  for (const j of jours) {
    // Le scope cabinet vient de la jointure sur `gardes` : la vue ne porte pas
    // de cabinet_id, et une garde absente de la liste n'appartient pas au
    // cabinet courant (ou a disparu entre les deux lectures).
    const garde = gardesParId.get(j.id)
    if (!garde) continue

    // Rôles natifs libérés par l'absence. Le véto peut être 1er, 2nd, ou les
    // deux (cas limite) → un créneau par rôle.
    const roles: RoleGarde[] = []
    if (garde.premier_id === absentId) roles.push('premier')
    if (garde.second_id === absentId) roles.push('second')

    for (const role of roles) {
      const cle = `${garde.id}|${role}`
      const deja = parCle.get(cle)
      if (deja) {
        if (!deja.joursTouches.includes(j.date)) deja.joursTouches.push(j.date)
        continue
      }
      parCle.set(cle, {
        gardeId: garde.id,
        date: garde.date,
        type: garde.type,
        typeEngine: mapDbTypeToEngine(garde.type),
        role,
        saison: j.saison,
        periodeId: garde.periode_id,
        joursTouches: [j.date],
        blocMultiJours: garde.type === 'weekend',
      })
    }
  }

  const impactes = [...parCle.values()]
  for (const c of impactes) c.joursTouches.sort()
  impactes.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.role.localeCompare(b.role)))
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
    placesNuitSemaine: contexte.creneaux?.find(
      (c) => c.code === 'semaine_soir' && c.actif,
    )?.nbPlaces,
    roleAvantageFinancier: contexte.roleAvantageFinancier,
    // #17 — lookback inter-périodes (résolu par resoudreContexte, best-effort).
    contexteAnterieur: contexte.contexteAnterieur,
  }
}
