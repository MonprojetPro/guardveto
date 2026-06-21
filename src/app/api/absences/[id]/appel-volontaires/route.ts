// ============================================================
// GUARDVETO — POST /api/absences/[id]/appel-volontaires
// ============================================================
// LOT 4 (gestion de crise) — Mode 2 : ENVOI de l'appel aux volontaires.
//
// L'admin, plutôt que d'IMPOSER un remplaçant (Mode 1 = /reparer), DEMANDE :
// il déclenche l'envoi d'un email à tous les vétos LÉGAUX d'UN créneau libéré
// par une absence. Chaque véto reçoit un lien « Je prends ce créneau » qui
// pointe vers /crise/volontaire (page de confirmation) puis vers l'endpoint
// POST /api/absences/[id]/volontaire (qui revalide tout côté serveur).
//
// Corps : { gardeId, role }   (role ∈ 'premier' | 'second')
//   → ALIGNÉ EXACTEMENT sur ce que CriseModal envoie (LOT 5).
//
// Cette route N'APPLIQUE AUCUNE modification du planning : elle envoie
// seulement des emails. Elle renvoie { envoyes: N } (nb d'emails partis), ou
// un message clair si aucun candidat légal n'existe (rien à envoyer).
//
// ────────────────────────────────────────────────────────────
// SÉCURITÉ — mêmes garde-fous que /reparer :
//   1. Auth : admin uniquement (role_app = 'admin').
//   2. Cabinet : cabinet_id lu dans app_metadata (jamais du client) ; l'absence
//      doit appartenir au cabinet de l'admin.
//   3. Le créneau { gardeId, role } doit être ENCORE un créneau impacté de
//      CETTE absence (source de vérité serveur via recenserCreneauxImpactes).
//      Si déjà pourvu / plus à pourvoir → 409.
//   4. Candidats LÉGAUX recalculés via proposerReparation avec EXACTEMENT la
//      config de génération (vets + calendrier + structure R8/R9 + équité), pour
//      ne pas solliciter de « faux légaux » (cf. r8r9-reglables-deux-gardiens /
//      moteur-cecite-params-nesting).
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { proposerReparation, type CreneauCrise } from '@/engine/crise/reparer'
import {
  recenserCreneauxImpactes,
  chargerContextePourPeriode,
  besoinSecondCreneau,
} from '@/lib/crise/contexte'
import { sendAppelVolontaires } from '@/lib/notifications'
import type { RoleGarde } from '@/engine/types'

export const maxDuration = 60

interface Corps {
  gardeId: string
  role: RoleGarde
}

function estCorps(v: unknown): v is Corps {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return typeof c.gardeId === 'string' && (c.role === 'premier' || c.role === 'second')
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

  // ── Validation du corps (aligné CriseModal : { gardeId, role }) ──
  let corps: Corps
  try {
    const body = await req.json()
    if (!estCorps(body)) {
      return NextResponse.json(
        { error: 'Corps invalide. Attendu : { gardeId, role }.' },
        { status: 400 },
      )
    }
    corps = body
  } catch {
    return NextResponse.json({ error: 'Corps de requête non parsable (JSON attendu).' }, { status: 400 })
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
  if (absence.statut === 'resolue') {
    return NextResponse.json({ error: 'Cette absence est déjà entièrement résolue.' }, { status: 409 })
  }

  const absentId = absence.veterinaire_id as string

  // ── Le créneau est-il ENCORE impacté + tenu par l'absent ? ──
  // Source de vérité serveur : on recalcule l'ensemble des créneaux impactés et
  // on n'accepte que { gardeId, role } qui en fait toujours partie. Si la garde
  // a été pourvue entre-temps → 409 (rien à appeler).
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

  const imp = impactes.find((i) => i.gardeId === corps.gardeId && i.role === corps.role)
  if (!imp) {
    return NextResponse.json(
      { error: "Ce créneau a déjà été pourvu ou n'est plus à pourvoir pour cette absence." },
      { status: 409 },
    )
  }

  // ── Candidats LÉGAUX (même config qu'à la génération) ────
  // On rejoue proposerReparation avec EXACTEMENT la config de génération (vets +
  // calendrier + structure R8/R9 + équité). Les candidats retournés sont les
  // seuls vétos qu'on a le droit de solliciter (pas de « faux légaux »).
  const ctx = await chargerContextePourPeriode(supabase, imp.periodeId, cabinetId)

  const creneau: CreneauCrise = {
    date: imp.date,
    type: imp.typeEngine,
    role: imp.role,
    saison: imp.saison,
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
  })

  const candidatIds = resultat.candidats.map((c) => c.vetId)

  // ── Aucun candidat légal → rien à envoyer (message honnête) ──
  if (candidatIds.length === 0) {
    const reglesLibelles = resultat.diagnostic?.reglesEnCause
      ?.map((r) => r.libelle)
      .filter(Boolean)
      .join(', ')
    const raison = reglesLibelles
      ? `aucun vétérinaire ne peut couvrir ce créneau sans enfreindre une règle (${reglesLibelles})`
      : `aucun vétérinaire ne peut couvrir ce créneau sans enfreindre une règle`
    return NextResponse.json(
      {
        envoyes: 0,
        error: `Aucun appel envoyé : ${raison}. Ce créneau est à traiter manuellement.`,
      },
      { status: 422 },
    )
  }

  // ── Envoi des emails (best-effort interne — jamais bloquant) ──
  // sendAppelVolontaires résout les emails depuis `veterinaires`, construit le
  // lien absolu /crise/volontaire et envoie à chaque candidat légal.
  const { sent, errors } = await sendAppelVolontaires(
    supabase,
    candidatIds,
    {
      gardeId: corps.gardeId,
      date: imp.date,
      type: imp.type, // type DB (pour l'affichage email)
      role: corps.role,
    },
    { id: absenceId, veterinaire_id: absentId },
  )

  return NextResponse.json({
    envoyes: sent,
    erreurs: errors,
    gardeId: corps.gardeId,
    role: corps.role,
  })
}
