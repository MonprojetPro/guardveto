// ============================================================
// GUARDVETO — POST /api/absences/[id]/reparer
// ============================================================
// LOT 3 (gestion de crise) — APPLIQUE les remplacements choisis par l'admin
// pour réparer le planning suite à une absence.
//
// Pour chaque décision { gardeId, role, remplacant_id } :
//   1. re-vérifie via proposerReparation que le remplaçant est LÉGAL pour ce
//      créneau (anti-triche / anti-collision : on ne fait jamais confiance au
//      client). Si illégal → 400 avec la raison, RIEN n'est appliqué pour cette
//      décision (les autres déjà appliquées restent — l'absence n'est pas close).
//   2. applique le changement via le MÊME cycle que PATCH /api/gardes/[id]
//      (helper partagé appliquerChangementGarde) — force:true (planning publié).
//   3. écrit une ligne `compensations` (qui a dépanné qui).
//
// Quand TOUS les créneaux impactés sont réparés → absences.statut = 'resolue'.
//
// Accès : admin uniquement, scopé cabinet (l'absence doit appartenir au cabinet).
// Corps  : { decisions: [{ gardeId, role, remplacant_id }] }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { proposerReparation, type CreneauCrise } from '@/engine/crise/reparer'
import { appliquerChangementGarde } from '@/lib/gardes/appliquer-changement'
import {
  recenserCreneauxImpactes,
  chargerContextePourPeriode,
  besoinSecondCreneau,
  type ContexteCrisePeriode,
} from '@/lib/crise/contexte'
import type { RoleGarde } from '@/engine/types'

export const maxDuration = 60

interface Decision {
  gardeId: string
  role: RoleGarde
  remplacant_id: string
}

function estDecision(v: unknown): v is Decision {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return (
    typeof d.gardeId === 'string' &&
    (d.role === 'premier' || d.role === 'second') &&
    typeof d.remplacant_id === 'string'
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: absenceId } = await params
  const supabase = await createClient()

  // ── Auth + rôle admin ───────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('id, role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 })
  }

  // ── Cabinet (app_metadata uniquement — règle C1) ─────────
  const cabinetId = user.app_metadata?.cabinet_id as string | undefined
  if (!cabinetId) {
    return NextResponse.json(
      { error: 'Cabinet non configuré pour cet utilisateur (app_metadata.cabinet_id manquant).' },
      { status: 403 },
    )
  }

  // ── L'absence existe et appartient au cabinet ────────────
  const { data: absence } = await supabase
    .from('absences')
    .select('id, cabinet_id, veterinaire_id, date_debut, date_fin, statut')
    .eq('id', absenceId)
    .eq('cabinet_id', cabinetId)
    .single()

  if (!absence) {
    return NextResponse.json({ error: 'Absence introuvable dans ce cabinet.' }, { status: 404 })
  }
  if (absence.statut === 'annulee') {
    return NextResponse.json({ error: 'Cette absence est annulée.' }, { status: 422 })
  }

  // ── Validation du corps ─────────────────────────────────
  let decisions: Decision[]
  try {
    const body = await req.json()
    const raw = body?.decisions
    if (!Array.isArray(raw) || raw.length === 0 || !raw.every(estDecision)) {
      return NextResponse.json(
        { error: 'Corps invalide. Attendu : { decisions: [{ gardeId, role, remplacant_id }] }' },
        { status: 400 },
      )
    }
    decisions = raw
  } catch {
    return NextResponse.json({ error: 'Corps de requête non parsable (JSON attendu).' }, { status: 400 })
  }

  const absentId = absence.veterinaire_id as string

  // ── Recensement des créneaux impactés (source de vérité serveur) ──
  // On ne se fie PAS aux gardeId/role envoyés par le client : on recalcule
  // l'ensemble des créneaux que CETTE absence impacte, et on n'accepte que des
  // décisions qui correspondent à un de ces créneaux (anti-triche).
  let impactes
  try {
    impactes = await recenserCreneauxImpactes(
      supabase,
      cabinetId,
      absentId,
      absence.date_debut as string,
      absence.date_fin as string,
    )
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const ctxCache = new Map<string, ContexteCrisePeriode>()
  const resultatsDecisions: Array<{ gardeId: string; role: RoleGarde; remplacant_id: string }> = []

  for (const dec of decisions) {
    // 1. La décision doit correspondre à un créneau réellement impacté.
    const imp = impactes.find((i) => i.gardeId === dec.gardeId && i.role === dec.role)
    if (!imp) {
      return NextResponse.json(
        { error: `Décision rejetée : la garde ${dec.gardeId} (${dec.role}) n'est pas impactée par cette absence.` },
        { status: 400 },
      )
    }

    // 2. Le remplaçant ne peut pas être l'absent lui-même.
    if (dec.remplacant_id === absentId) {
      return NextResponse.json(
        { error: `Décision rejetée : le remplaçant ne peut pas être le vétérinaire absent.` },
        { status: 400 },
      )
    }

    // 3. VALIDATION MÉTIER : le remplaçant est-il LÉGAL sur ce créneau ?
    //    On rejoue proposerReparation avec la MÊME config qu'à la génération.
    let ctx = ctxCache.get(imp.periodeId)
    if (!ctx) {
      ctx = await chargerContextePourPeriode(supabase, imp.periodeId, cabinetId)
      ctxCache.set(imp.periodeId, ctx)
    }

    const creneau: CreneauCrise = {
      date: imp.date,
      type: imp.typeEngine,
      role: imp.role,
      saison: imp.saison,
      // Effectif configuré de la période (besoin d'un 2nd ?) — cohérent génération.
      besoinSecond: besoinSecondCreneau(imp.typeEngine, imp.saison, ctx.nbVetosSemaineSoir),
    }

    const resultat = proposerReparation({
      creneau,
      absentId,
      vets: ctx.vets,
      planningComplet: ctx.planningComplet,
      calendrier: ctx.calendrier,
      structure: ctx.structure,
      equityWeights: ctx.equityWeights,
      roleAvantageFinancier: ctx.roleAvantageFinancier,
    })

    const legal = resultat.candidats.some((c) => c.vetId === dec.remplacant_id)
    if (!legal) {
      const reglesLibelles = resultat.diagnostic?.reglesEnCause
        ?.map((r) => r.libelle)
        .filter(Boolean)
        .join(', ')
      const raison = reglesLibelles
        ? `aucun remplaçant légal pour ce créneau (${reglesLibelles})`
        : `le vétérinaire choisi n'est pas un remplaçant légal pour ce créneau`
      return NextResponse.json(
        { error: `Décision rejetée pour la garde du ${imp.date} (${imp.role}) : ${raison}.` },
        { status: 400 },
      )
    }

    // 4. Calcul des nouveaux assignés : on remplace UNIQUEMENT le rôle libéré,
    //    l'autre rôle reste tel quel (perturbation minimale).
    const { data: gardeActuelle } = await supabase
      .from('gardes')
      .select('id, premier_id, second_id')
      .eq('id', dec.gardeId)
      .eq('cabinet_id', cabinetId)
      .single()

    if (!gardeActuelle) {
      return NextResponse.json({ error: `Garde ${dec.gardeId} introuvable.` }, { status: 404 })
    }

    const premier_id = dec.role === 'premier' ? dec.remplacant_id : gardeActuelle.premier_id
    const second_id = dec.role === 'second' ? dec.remplacant_id : gardeActuelle.second_id

    // 5. Application via le cycle PARTAGÉ (update + audit + bilan + agenda + email).
    //    force:true car le planning est publié/verrouillé.
    const appRes = await appliquerChangementGarde({
      supabase,
      gardeId: dec.gardeId,
      premier_id,
      second_id,
      force: true,
      auteurVetId: vet.id,
      // Cabinet connu : on l'injecte (déterministe, indépendant de la session).
      cabinetId,
    })

    if (!appRes.ok) {
      return NextResponse.json(
        { error: `Échec de l'application sur la garde du ${imp.date} : ${appRes.error}` },
        { status: appRes.status },
      )
    }

    // 6. Trace de compensation (qui a dépanné qui).
    const { error: compErr } = await supabase.from('compensations').insert({
      cabinet_id: cabinetId,
      absence_id: absenceId,
      garde_id: dec.gardeId,
      remplacant_id: dec.remplacant_id,
      remplace_id: absentId,
      role: dec.role,
      statut: 'a_compenser',
    })

    if (compErr) {
      return NextResponse.json(
        { error: `Garde du ${imp.date} modifiée mais trace de compensation non écrite : ${compErr.message}` },
        { status: 500 },
      )
    }

    resultatsDecisions.push({ gardeId: dec.gardeId, role: dec.role, remplacant_id: dec.remplacant_id })
  }

  // ── L'absence est-elle entièrement réparée ? ─────────────
  // On compte les compensations actives (a_compenser/compensee) de cette absence
  // et on les compare à l'ensemble des créneaux impactés. Si tout est couvert →
  // statut 'resolue'.
  const { data: compsExistantes } = await supabase
    .from('compensations')
    .select('garde_id, role')
    .eq('absence_id', absenceId)
    .eq('cabinet_id', cabinetId)
    .neq('statut', 'annulee')

  const couverts = new Set(
    ((compsExistantes as { garde_id: string; role: string | null }[] | null) ?? []).map(
      (c) => `${c.garde_id}|${c.role ?? ''}`,
    ),
  )
  const tousCouverts = impactes.every((i) => couverts.has(`${i.gardeId}|${i.role}`))

  let statutFinal = absence.statut as string
  if (tousCouverts && impactes.length > 0) {
    const { error: updErr } = await supabase
      .from('absences')
      .update({ statut: 'resolue' })
      .eq('id', absenceId)
      .eq('cabinet_id', cabinetId)

    if (!updErr) statutFinal = 'resolue'
  }

  return NextResponse.json({
    success: true,
    absenceId,
    statut: statutFinal,
    decisionsAppliquees: resultatsDecisions,
    creneauxRestants: impactes
      .filter((i) => !couverts.has(`${i.gardeId}|${i.role}`))
      .map((i) => ({ gardeId: i.gardeId, date: i.date, role: i.role })),
  })
}
