// ============================================================
// GUARDVETO — POST /api/absences/[id]/volontaire
// ============================================================
// LOT 4 (gestion de crise) — Mode 2 : APPEL AUX VOLONTAIRES.
// Plutôt que l'admin IMPOSE un remplaçant (Mode 1 = /reparer), un vétérinaire
// se porte VOLONTAIRE pour couvrir un créneau libéré par une absence : « je
// prends ce créneau ».
//
// Corps : { gardeId, role }   (role ∈ 'premier' | 'second')
// Le volontaire est TOUJOURS le véto connecté lui-même (jamais un autre).
//
// ────────────────────────────────────────────────────────────
// SÉCURITÉ (anti-collision + anti-triche) — 4 verrous AVANT toute écriture :
//   1. Auth : utilisateur authentifié + rattaché au cabinet de l'absence
//      (cabinet_id lu dans app_metadata — jamais du client). Le volontaire =
//      son propre veterinaire_id (il ne peut PAS s'engager pour autrui).
//   2. Le créneau est ENCORE un créneau impacté de CETTE absence ET encore
//      attribué à l'absent sur ce rôle. Si déjà pourvu entre-temps → 409.
//   3. Légalité re-vérifiée via proposerReparation (le moteur EXACT de la
//      génération) : le volontaire doit figurer dans `candidats`. Sinon 400.
//   4. (intégré au 2/3) on rejoue tout côté serveur : un lien email forwardé
//      ne contourne aucun contrôle.
//
// ────────────────────────────────────────────────────────────
// AUTORISATION ÉCRITURE `gardes` (point audité par CERBÈRE) :
//   La RLS de `gardes` réserve l'écriture aux admins → le client RLS du véto
//   volontaire ne peut PAS écrire la garde. On gère ça en DEUX temps :
//     • TOUTE la validation (auth, cabinet, identité, créneau, éligibilité) se
//       fait avec le client RLS-aware du véto (`createClient()`). RLS borne
//       déjà ses lectures à son cabinet (défense en profondeur : une donnée
//       d'un autre cabinet revient simplement « introuvable »).
//     • SEULEMENT APRÈS que les 4 verrous sont passés, on exécute l'écriture
//       privilégiée (`appliquerChangementGarde`) avec un client SERVICE_ROLE
//       créé côté serveur, jamais exposé. Le service role n'est utilisé que
//       pour l'opération NARROW que la logique métier vient d'autoriser — il
//       ne sert JAMAIS aux lectures de validation (sinon on perdrait le filet
//       RLS). C'est le même modèle de confiance que /reparer (où l'admin a le
//       droit RLS), rendu explicite et borné pour un véto non-admin.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { proposerReparation, type CreneauCrise } from '@/engine/crise/reparer'
import { appliquerChangementGarde } from '@/lib/gardes/appliquer-changement'
import {
  recenserCreneauxImpactes,
  chargerContextePourPeriode,
  besoinSecondCreneau,
} from '@/lib/crise/contexte'
import { sendDepannageConfirme } from '@/lib/notifications'
import type { RoleGarde } from '@/engine/types'

export const maxDuration = 60

// ── Client service_role (écriture privilégiée APRÈS validation stricte) ──
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Variables Supabase service manquantes.')
  return createServiceClient(url, key)
}

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
  const supabase = await createClient() // client RLS-aware DU VÉTO (validation)

  // ── 1a. Auth : utilisateur authentifié ───────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  // ── 1b. Le véto connecté (volontaire = lui-même, jamais un autre) ──
  const { data: moi } = await supabase
    .from('veterinaires')
    .select('id, cabinet_id, actif')
    .eq('user_id', user.id)
    .single()

  if (!moi) {
    return NextResponse.json({ error: 'Profil vétérinaire introuvable.' }, { status: 403 })
  }
  if (moi.actif === false) {
    return NextResponse.json({ error: 'Compte vétérinaire inactif.' }, { status: 403 })
  }
  const volontaireId = moi.id as string

  // ── 1c. Cabinet (app_metadata uniquement — règle C1) ─────
  const cabinetId = user.app_metadata?.cabinet_id as string | undefined
  if (!cabinetId) {
    return NextResponse.json(
      { error: 'Cabinet non configuré pour cet utilisateur (app_metadata.cabinet_id manquant).' },
      { status: 403 },
    )
  }
  // Cohérence app_metadata ↔ profil DB (anti-incohérence de provisioning).
  if (moi.cabinet_id && moi.cabinet_id !== cabinetId) {
    return NextResponse.json({ error: 'Incohérence de cabinet.' }, { status: 403 })
  }

  // ── Validation du corps ──────────────────────────────────
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

  // ── L'absence existe et appartient au cabinet du véto ────
  // (RLS borne déjà la lecture ; le filtre cabinet_id est une ceinture+bretelles.)
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

  // Le volontaire ne peut pas être le véto absent lui-même.
  if (volontaireId === absentId) {
    return NextResponse.json(
      { error: 'Vous êtes le vétérinaire absent : vous ne pouvez pas vous porter volontaire.' },
      { status: 400 },
    )
  }

  // ── 2. Le créneau est-il ENCORE impacté + encore tenu par l'absent ? ──
  // Source de vérité serveur : on recalcule l'ensemble des créneaux impactés et
  // on n'accepte que { gardeId, role } qui en fait toujours partie. Si la garde
  // a été pourvue entre-temps (l'absent n'y est plus sur ce rôle), elle n'est
  // plus dans `impactes` → 409 « déjà pourvu ».
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
      { error: 'Ce créneau a déjà été pourvu ou n\'est plus à pourvoir pour cette absence.' },
      { status: 409 },
    )
  }

  // ── 3. Légalité : le volontaire doit être un candidat LÉGAL ──
  // On rejoue proposerReparation avec EXACTEMENT la config de génération (vets +
  // calendrier + structure R8/R9 + équité), sinon on recrée le piège des « faux
  // légaux » (cf. r8r9-reglables-deux-gardiens / moteur-cecite-params-nesting).
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

  const eligible = resultat.candidats.some((c) => c.vetId === volontaireId)
  if (!eligible) {
    const reglesLibelles = resultat.diagnostic?.reglesEnCause
      ?.map((r) => r.libelle)
      .filter(Boolean)
      .join(', ')
    const raison = reglesLibelles
      ? `vous n'êtes pas éligible pour ce créneau (${reglesLibelles})`
      : `vous n'êtes pas éligible pour ce créneau (règle de planning)`
    return NextResponse.json({ error: `Volontariat refusé : ${raison}.` }, { status: 400 })
  }

  // ════════════════════════════════════════════════════════════
  // À PARTIR D'ICI : les 4 verrous sont passés. On bascule sur le
  // client SERVICE_ROLE pour l'écriture privilégiée UNIQUEMENT.
  // ════════════════════════════════════════════════════════════
  let service
  try {
    service = getServiceClient()
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  // ── Garde actuelle (via service : on lit l'état le plus frais) ──
  // Re-contrôle anti-collision FINAL juste avant écriture : l'absent doit
  // TOUJOURS être sur ce rôle (course entre le recensement et maintenant).
  const { data: gardeActuelle } = await service
    .from('gardes')
    .select('id, premier_id, second_id, cabinet_id')
    .eq('id', corps.gardeId)
    .single()

  if (!gardeActuelle || gardeActuelle.cabinet_id !== cabinetId) {
    return NextResponse.json({ error: 'Garde introuvable.' }, { status: 404 })
  }

  const tenuParAbsent =
    corps.role === 'premier'
      ? gardeActuelle.premier_id === absentId
      : gardeActuelle.second_id === absentId
  if (!tenuParAbsent) {
    return NextResponse.json(
      { error: 'Ce créneau vient d\'être pourvu par quelqu\'un d\'autre.' },
      { status: 409 },
    )
  }

  // On remplace UNIQUEMENT le rôle libéré ; l'autre rôle reste tel quel.
  const premier_id = corps.role === 'premier' ? volontaireId : gardeActuelle.premier_id
  const second_id = corps.role === 'second' ? volontaireId : gardeActuelle.second_id

  // ── Application via le cycle PARTAGÉ (update + audit + bilan + agenda + email).
  //    force:true (planning publié/verrouillé). auteur = le volontaire lui-même.
  //    Le helper reçoit le client SERVICE → l'écriture `gardes` passe la RLS.
  const appRes = await appliquerChangementGarde({
    supabase: service,
    gardeId: corps.gardeId,
    premier_id,
    second_id,
    force: true,
    auteurVetId: volontaireId,
  })

  if (!appRes.ok) {
    return NextResponse.json(
      { error: `Échec de l'application : ${appRes.error}` },
      { status: appRes.status },
    )
  }

  // ── Trace de compensation (qui a dépanné qui) — via service (cohérence) ──
  const { error: compErr } = await service.from('compensations').insert({
    cabinet_id: cabinetId,
    absence_id: absenceId,
    garde_id: corps.gardeId,
    remplacant_id: volontaireId,
    remplace_id: absentId,
    role: corps.role,
    statut: 'a_compenser',
  })

  if (compErr) {
    return NextResponse.json(
      { error: `Garde réattribuée mais trace de compensation non écrite : ${compErr.message}` },
      { status: 500 },
    )
  }

  // ── Clôture de l'absence si plus aucun créneau impacté ───
  // On recompte les créneaux impactés APRÈS l'écriture : si l'absent n'est plus
  // sur aucune garde future → 'resolue'.
  let statutFinal = absence.statut as string
  try {
    const restants = await recenserCreneauxImpactes(
      service,
      cabinetId,
      absentId,
      absence.date_debut as string,
      absence.date_fin as string,
    )
    if (restants.length === 0) {
      const { error: updErr } = await service
        .from('absences')
        .update({ statut: 'resolue' })
        .eq('id', absenceId)
        .eq('cabinet_id', cabinetId)
      if (!updErr) statutFinal = 'resolue'
    }
  } catch (err) {
    // Non bloquant : la garde est réattribuée et tracée. La clôture pourra se
    // faire plus tard (ex : autre volontaire / admin). On loggue seulement.
    console.error(
      '[volontaire] Erreur recompte créneaux pour clôture absence:',
      err instanceof Error ? err.message : String(err),
    )
  }

  // ── Confirmation au volontaire (best-effort, jamais bloquant) ──
  try {
    await sendDepannageConfirme(service, volontaireId, {
      gardeId: corps.gardeId,
      date: imp.date,
      type: imp.type, // type DB (pour l'affichage email)
      role: corps.role,
    })
  } catch (err) {
    console.error(
      '[volontaire] Erreur envoi confirmation dépannage:',
      err instanceof Error ? err.message : String(err),
    )
  }

  return NextResponse.json({
    success: true,
    absenceId,
    statut: statutFinal,
    gardeId: corps.gardeId,
    role: corps.role,
    remplacant_id: volontaireId,
  })
}
