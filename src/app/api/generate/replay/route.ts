// ============================================================
// GUARDVETO — API Route POST /api/generate/replay
// ============================================================
// Test de déterminisme en production : rejoue le solver avec les
// règles snapshotées au moment de la génération originale.
//
// Pipeline :
//   1. Charger le snapshot depuis snapshots_regles (RLS filtre par cabinet)
//   2. Charger le contexte courant via resoudreContexte
//   3. Remplacer les contraintes du contexte par celles du snapshot
//   4. Lancer genererPlanningPur (même seed → même résultat attendu)
//   5. Retourner le résultat (V1 simplifiée : sans comparaison d'empreinte
//      exacte car les attributions V1 ne sont pas dans le même format)
//
// Accès : admin uniquement (même guard que /api/generate)
// Corps : { planningId: string }
// Réponse succès  : { success: true, nbAttributions, snapshotId, dureeMs }
// Réponse impasse : { success: false, joursNonCouverts, dureeMs }
//
// NOTE V1 SIMPLIFIÉE : cette route retourne le résultat du replay
// sans comparer l'empreinte bit-à-bit avec le planning original,
// car les attributions stockées en base (format V2) nécessiteraient
// une reconstruction du PlanningPartiel qui dépasse le périmètre
// de F8-002. La comparaison d'empreinte exacte est prévue en F8-003.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { genererPlanningPur } from '@/engine/solver'
import { resoudreContexte } from '@/data/resoudreContexte'
import { normaliserContraintesVets } from '@/engine/normaliserContraintes'
import { buildEquityWeights } from '@/engine/equity-weights'
import {
  mapperReglesCabinet,
  extraireEquityRules,
  extraireStructureConfig,
  type RegleCabinetRow,
} from '@/data/mapReglesCabinet'
import type { ContexteSimulation, ContrainteEngine } from '@/engine/types'
import type { CreneauModele } from '@/engine/creneau-modele'

// Laisse le temps au solver LNS
export const maxDuration = 60

// ── Types internes ────────────────────────────────────────

/**
 * Forme LEGACY (schéma v1) du snapshot : un tableau de contraintes_veto.
 * Conservée pour rejouer les snapshots pris AVANT le Chantier C1.
 */
interface SnapshotRegleLegacy {
  id: string
  type: string
  brique_type: string
  config: Record<string, unknown>
  actif: boolean
}

/** Ligne `creneau_modele` telle que figée dans le snapshot (schéma v3). */
interface CreneauModeleSnapshotRow {
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

/**
 * Forme versionnée du snapshot (schéma >= 2) : photo fidèle des `regles_cabinet`
 * (briques par-véto + équité `equilibrer` + structure R8/R9) + l'effectif figé.
 * À partir du schéma v3 (P5 slice 3d), la STRUCTURE (catalogue de créneaux du
 * profil) est aussi figée → le replay reconstruit les créneaux depuis le snapshot
 * au lieu du catalogue vivant. C'est ce que le moteur consomme réellement.
 */
interface SnapshotVersionne {
  schema: number
  regles_cabinet: RegleCabinetRow[]
  effectif?: { nb_vetos_semaine_soir?: number | null }
  structure?: {
    profil_id?: string | null
    creneau_modele?: CreneauModeleSnapshotRow[]
  }
}

/** Postgres TIME 'HH:MM:SS' → 'HH:MM' (identique à chargerCreneauModele). */
function hhmm(t: string): string {
  return (t ?? '').slice(0, 5)
}

/** Reconstruit le catalogue moteur depuis les lignes figées du snapshot (v3). */
function creneauxDepuisSnapshot(rows: CreneauModeleSnapshotRow[]): CreneauModele[] {
  return rows.map((r) => ({
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

// ── Handler principal ────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  // ── Authentification ─────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Non authentifié. Veuillez vous connecter.' },
      { status: 401 }
    )
  }

  // ── Vérification rôle admin ──────────────────────────────
  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return NextResponse.json(
      { error: 'Accès réservé aux administrateurs.' },
      { status: 403 }
    )
  }

  // ── Extraction du cabinet_id (règle C1 : app_metadata uniquement) ──
  const cabinetId = user.app_metadata?.cabinet_id as string | undefined
  if (!cabinetId) {
    return NextResponse.json(
      { error: 'Cabinet non configuré pour cet utilisateur (app_metadata.cabinet_id manquant).' },
      { status: 403 }
    )
  }

  // ── Validation du corps ─────────────────────────────────
  let planningId: string
  try {
    const body = await req.json()
    planningId = body?.planningId
    if (!planningId || typeof planningId !== 'string') {
      return NextResponse.json(
        { error: 'Corps invalide. Attendu : { planningId: string }' },
        { status: 400 }
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'Corps de requête non parsable (JSON attendu).' },
      { status: 400 }
    )
  }

  // ── 1. Charger le snapshot associé au planning ──────────
  // RLS garantit l'isolation cabinet : seul le snapshot du cabinet actif est visible.
  // Chaque génération EMPILE un snapshot (prendre_snapshot insère sans supprimer),
  // donc un planning régénéré en a plusieurs : on rejoue LE PLUS RÉCENT (celui de
  // la dernière génération). `.single()` planterait ici sur multi-lignes.
  const { data: snapshotRow, error: snapshotErr } = await supabase
    .from('snapshots_regles')
    .select('id, regles_json')
    .eq('planning_id', planningId)
    .order('cree_le', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (snapshotErr || !snapshotRow) {
    return NextResponse.json(
      { error: `Snapshot introuvable pour ce planning : ${snapshotErr?.message ?? 'aucun résultat'}` },
      { status: 404 }
    )
  }

  const snapshotId = snapshotRow.id as string
  const rawRegles = snapshotRow.regles_json ?? []

  // ── 2. Charger le contexte courant ──────────────────────
  let contexte: ContexteSimulation
  try {
    contexte = await resoudreContexte(planningId, cabinetId)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    )
  }

  if (contexte.vets.length === 0) {
    return NextResponse.json(
      { error: 'Aucun vétérinaire actif trouvé. Impossible de rejouer le planning.' },
      { status: 422 }
    )
  }

  // ── 3. Reconstruire le contexte de replay à partir du snapshot ─
  // Principe : on rejoue les RÈGLES telles qu'archivées à la génération,
  // sur le MONDE courant (vétos, congés, calendrier d'aujourd'hui). Seules
  // les règles de planification sont rejouées à l'identique.
  //
  // Deux formes de snapshot possibles :
  //   • v2 (Chantier C1) : objet { schema:2, regles_cabinet:[...], effectif }
  //     → reconstruction FIDÈLE via les mêmes mappers que le loader :
  //       briques par-véto + équité (`equilibrer`) + structure R8/R9 +
  //       effectif configurable. C'est le chemin nominal.
  //   • legacy v1 : tableau de contraintes_veto → on patche le `config`
  //     des contraintes par id (ancien comportement, équité/structure NON
  //     rejouées car absentes du snapshot — fidélité partielle, best-effort).
  let contexteReplay: ContexteSimulation

  if (!Array.isArray(rawRegles) && ((rawRegles as SnapshotVersionne)?.schema ?? 0) >= 2) {
    // ── Chemin versionné (v2/v3) : reconstruction fidèle depuis regles_cabinet ──
    const snap = rawRegles as SnapshotVersionne
    const rows = Array.isArray(snap.regles_cabinet) ? snap.regles_cabinet : []

    // Catalogue des briques connues (même socle de validation que le loader).
    const { data: briquesDb } = await supabase.from('briques_regles').select('id')
    const briquesConnues = new Set<string>(
      ((briquesDb as { id: string }[] | null) ?? []).map((b) => b.id),
    )

    const { contraintesParVet } = mapperReglesCabinet(rows, briquesConnues)
    const equityWeights = buildEquityWeights(extraireEquityRules(rows))
    const structureConfig = extraireStructureConfig(rows)
    const effectif = snap.effectif?.nb_vetos_semaine_soir

    // Réinjecter les contraintes snapshotées PAR VÉTO, puis re-normaliser à la
    // source (parade anti-cécité params : tous les consommateurs reçoivent des
    // règles dépliées — cf. resoudreContexte).
    const vetsRejoues = contexte.vets.map((v) => ({
      ...v,
      contraintes: contraintesParVet.get(v.id) ?? [],
    }))

    // STRUCTURE figée (v3) : si le snapshot contient le catalogue du profil, on
    // rejoue CE catalogue au lieu du catalogue vivant (rejouabilité fidèle même
    // après évolution du profil). Absent (v2) → on garde les créneaux courants.
    const creneauxSnapshot =
      snap.structure?.creneau_modele && snap.structure.creneau_modele.length > 0
        ? creneauxDepuisSnapshot(snap.structure.creneau_modele)
        : undefined

    contexteReplay = {
      ...contexte,
      vets: normaliserContraintesVets(vetsRejoues),
      equityWeights,
      structureConfig,
      // Effectif d'alors si capturé, sinon on garde celui du contexte courant.
      nbVetosSemaineSoir:
        typeof effectif === 'number' ? effectif : contexte.nbVetosSemaineSoir,
      // Catalogue d'alors si figé (v3), sinon le catalogue courant.
      creneaux: creneauxSnapshot ?? contexte.creneaux,
    }
  } else {
    // ── Chemin legacy v1 : patch des configs par id (fidélité partielle) ──
    const legacy = (Array.isArray(rawRegles) ? rawRegles : []) as SnapshotRegleLegacy[]
    const snapshotContraintesParId = new Map<string, SnapshotRegleLegacy>(
      legacy.map((r) => [r.id, r]),
    )

    const vetsAvecSnapshotContraintes = contexte.vets.map((v) => {
      const contraintesSnapshot = v.contraintes.map((c): ContrainteEngine => {
        const snap = snapshotContraintesParId.get(c.id)
        if (!snap) return c // contrainte ajoutée après la génération → conserver
        return { ...c, config: snap.config as typeof c.config }
      })
      return { ...v, contraintes: contraintesSnapshot }
    })

    contexteReplay = {
      ...contexte,
      vets: vetsAvecSnapshotContraintes,
    }
  }

  // ── 4. Rejouer le solver ─────────────────────────────────
  const t0 = Date.now()
  const result = genererPlanningPur(contexteReplay)
  const dureeMs = Date.now() - t0

  if (!result.success) {
    // Même forme d'impasse que /api/generate : diagnostic éphémère complet.
    return NextResponse.json({
      success: false,
      diagnostic: result.diagnostic ?? null,
      joursNonCouverts: result.joursNonCouverts,
      dureeMs,
    })
  }

  // ── 5. Retourner le résultat (V1 simplifiée) ────────────
  // La comparaison d'empreinte exacte (bit-à-bit avec le planning original)
  // nécessite de reconstruire un PlanningPartiel depuis les attributions en base.
  // Cette reconstruction est prévue en F8-003. Pour F8-002, on retourne le
  // résultat du replay sans comparaison.
  return NextResponse.json({
    success: true,
    nbAttributions: result.planning.attributions.length * 2, // × 2 : premier + second
    snapshotId,
    dureeMs,
  })
}
