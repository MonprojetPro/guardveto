// ============================================================
// GUARDVETO — POST /api/bilan
// ============================================================
// Calcule les bonus/malus de fin de période et les sauvegarde
// dans la table bonus_malus.
//
// Accès : admin uniquement
// Corps : { periodeId: string }
// Réponse succès : { success: true, bilans: BilanVet[] }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resoudreCabinetId } from '@/lib/supabase/cabinet'
import { queryCompteurs, queryTotalWE } from '@/hooks/useCompteurs'
import { calculerBilans } from '@/engine/bilan'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  // ── Auth + rôle admin ────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const { data: vet } = await supabase
    .from('veterinaires')
    .select('role_app')
    .eq('user_id', user.id)
    .single()

  if (vet?.role_app !== 'admin') {
    return NextResponse.json({ error: 'Accès réservé aux administrateurs.' }, { status: 403 })
  }

  // ── cabinet_id dérivé côté serveur (jamais du client) ────
  let cabinetId: string
  try {
    cabinetId = await resoudreCabinetId(supabase)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Cabinet introuvable.' },
      { status: 403 }
    )
  }

  // ── Validation du corps ──────────────────────────────────
  let periodeId: string
  try {
    const body = await req.json()
    periodeId = body?.periodeId
    if (!periodeId || typeof periodeId !== 'string') {
      return NextResponse.json({ error: 'Corps invalide. Attendu : { periodeId: string }' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Corps de requête non parsable.' }, { status: 400 })
  }

  // ── Vérification de la période ───────────────────────────
  const { data: periode } = await supabase
    .from('periodes')
    .select('id, statut')
    .eq('id', periodeId)
    .single()

  if (!periode) {
    return NextResponse.json({ error: 'Période introuvable.' }, { status: 404 })
  }

  if (periode.statut === 'brouillon') {
    return NextResponse.json(
      { error: 'Le bilan ne peut être calculé que pour une période publiée ou verrouillée.' },
      { status: 422 }
    )
  }

  // ── Chargement des compteurs ─────────────────────────────
  // Une erreur de LECTURE doit stopper net : le bilan calculé ici part en
  // base dans `bonus_malus`, et le moteur le relit à la génération suivante
  // pour rattraper les écarts. Un compteur partiel écrit ici deviendrait un
  // planning injuste, sans que rien ne l'ait jamais signalé.
  const [{ compteurs, erreur: errCompteurs }, { totalWE, erreur: errWE }] = await Promise.all([
    queryCompteurs(supabase, periodeId),
    queryTotalWE(supabase, periodeId),
  ])

  const erreurLecture = errCompteurs ?? errWE
  if (erreurLecture) {
    return NextResponse.json(
      {
        error:
          `Impossible de lire les compteurs de la période — le bilan n'a PAS été enregistré : ${erreurLecture}`,
      },
      { status: 500 }
    )
  }

  if (compteurs.length === 0) {
    return NextResponse.json(
      { error: 'Aucun compteur disponible — la période ne contient pas de gardes.' },
      { status: 422 }
    )
  }

  // ── Calcul des bilans ────────────────────────────────────
  const bilans = calculerBilans(compteurs, totalWE)

  // ── Upsert en base ───────────────────────────────────────
  const rows = bilans.map((b) => ({
    cabinet_id: cabinetId,
    veterinaire_id: b.veterinaire_id,
    periode_id: periodeId,
    ecart_we: b.ecart_we,
    ecart_semaine: b.ecart_semaine,
    ecart_feries: b.ecart_feries,
    ecart_grands_we: b.ecart_grands_we,
  }))

  const { error: upsertErr } = await supabase
    .from('bonus_malus')
    .upsert(rows, { onConflict: 'cabinet_id,veterinaire_id,periode_id' })

  if (upsertErr) {
    return NextResponse.json(
      { error: `Erreur lors de la sauvegarde : ${upsertErr.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, bilans })
}
