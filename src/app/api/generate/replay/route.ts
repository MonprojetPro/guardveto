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
import type { ContexteSimulation } from '@/engine/types'

// Laisse le temps au solver LNS
export const maxDuration = 60

// ── Types internes ────────────────────────────────────────

interface SnapshotRegle {
  id: string
  type: string
  brique_type: string
  config: Record<string, unknown>
  actif: boolean
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
  const { data: snapshotRow, error: snapshotErr } = await supabase
    .from('snapshots_regles')
    .select('id, regles_json')
    .eq('planning_id', planningId)
    .single()

  if (snapshotErr || !snapshotRow) {
    return NextResponse.json(
      { error: `Snapshot introuvable pour ce planning : ${snapshotErr?.message ?? 'aucun résultat'}` },
      { status: 404 }
    )
  }

  const snapshotId = snapshotRow.id as string
  const snapshotRegles = (snapshotRow.regles_json ?? []) as SnapshotRegle[]

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

  // ── 3. Remplacer les contraintes par celles du snapshot ─
  // On reconstruit un contexte de replay en substituant les contraintes
  // courantes par celles archivées dans le snapshot. Les vétérinaires,
  // congés et calendrier restent ceux du contexte courant (seules les
  // règles de planification sont rejouées à l'identique).
  //
  // Chaque véto du contexte garde ses contraintes originales du snapshot
  // (filtrage par veterinaire_id non nécessaire ici : les contraintes
  // du snapshot sont au niveau cabinet, pas par véto).
  const snapshotContraintesParId = new Map<string, SnapshotRegle>(
    snapshotRegles.map((r) => [r.id, r])
  )

  // Remplacer les contraintes de chaque véto par leurs versions snapshotées
  const vetsAvecSnapshotContraintes = contexte.vets.map((v) => {
    const contraintesSnapshot = v.contraintes
      .map((c) => {
        const snap = snapshotContraintesParId.get(c.id)
        if (!snap) return c // contrainte ajoutée après la génération → conserver telle quelle
        return {
          ...c,
          config: snap.config as typeof c.config,
        }
      })
    return { ...v, contraintes: contraintesSnapshot }
  })

  const contexteReplay: ContexteSimulation = {
    ...contexte,
    vets: vetsAvecSnapshotContraintes,
  }

  // ── 4. Rejouer le solver ─────────────────────────────────
  const t0 = Date.now()
  const result = genererPlanningPur(contexteReplay)
  const dureeMs = Date.now() - t0

  if (!result.success) {
    return NextResponse.json({
      success: false,
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
