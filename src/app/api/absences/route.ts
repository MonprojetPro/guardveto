// ============================================================
// GUARDVETO — POST /api/absences
// ============================================================
// LOT 3 (gestion de crise) — DÉCLARATION d'une absence imprévue après
// publication d'un planning, + PROPOSITION de réparation pour chaque
// créneau de garde impacté.
//
// Cette route NE MODIFIE PAS le planning : elle déclare l'absence (statut
// 'active') et renvoie, pour chaque garde future du véto absent, le meilleur
// remplaçant LÉGAL (via proposerReparation — Lot 2). L'admin choisit ensuite,
// et c'est POST /api/absences/[id]/reparer qui applique réellement.
//
// Accès : admin uniquement, scopé cabinet (app_metadata.cabinet_id — règle C1).
// Corps  : { veterinaire_id, date_debut, date_fin, motif, commentaire? }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { proposerReparation, type CreneauCrise } from '@/engine/crise/reparer'
import {
  recenserCreneauxImpactes,
  chargerContextePourPeriode,
  besoinSecondCreneau,
  type ContexteCrisePeriode,
} from '@/lib/crise/contexte'
import type { MotifAbsence } from '@/types'

// Le recensement + N proposerReparation (purs) restent rapides, mais on charge
// le contexte (resoudreContexte) par période → on laisse de la marge.
export const maxDuration = 60

const MOTIFS_VALIDES: MotifAbsence[] = ['maladie', 'urgence', 'autre']

function estDateISO(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

export async function POST(req: NextRequest) {
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

  // ── Validation du corps ─────────────────────────────────
  let veterinaire_id: string
  let date_debut: string
  let date_fin: string
  let motif: MotifAbsence
  let commentaire: string | null

  try {
    const body = await req.json()
    veterinaire_id = body?.veterinaire_id
    date_debut = body?.date_debut
    date_fin = body?.date_fin
    motif = body?.motif
    commentaire = typeof body?.commentaire === 'string' ? body.commentaire : null

    if (typeof veterinaire_id !== 'string' || !veterinaire_id) {
      return NextResponse.json({ error: 'veterinaire_id requis.' }, { status: 400 })
    }
    if (!estDateISO(date_debut) || !estDateISO(date_fin)) {
      return NextResponse.json({ error: 'date_debut et date_fin requises (yyyy-MM-dd).' }, { status: 400 })
    }
    if (date_fin < date_debut) {
      return NextResponse.json({ error: 'date_fin doit être ≥ date_debut.' }, { status: 422 })
    }
    if (!MOTIFS_VALIDES.includes(motif)) {
      return NextResponse.json({ error: `motif invalide (attendu : ${MOTIFS_VALIDES.join(', ')}).` }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Corps de requête non parsable (JSON attendu).' }, { status: 400 })
  }

  // ── Le véto absent appartient-il bien au cabinet ? (la RLS le borne déjà) ──
  const { data: absent } = await supabase
    .from('veterinaires')
    .select('id')
    .eq('id', veterinaire_id)
    .eq('cabinet_id', cabinetId)
    .single()

  if (!absent) {
    return NextResponse.json({ error: 'Vétérinaire introuvable dans ce cabinet.' }, { status: 404 })
  }

  // ── Insertion de l'absence (statut 'active') ─────────────
  // cabinet_id dérivé serveur (jamais du client). declaree_par = admin courant.
  const { data: absence, error: insertErr } = await supabase
    .from('absences')
    .insert({
      cabinet_id: cabinetId,
      veterinaire_id,
      date_debut,
      date_fin,
      motif,
      commentaire,
      statut: 'active',
      declaree_par: vet.id,
    })
    .select('*')
    .single()

  if (insertErr || !absence) {
    return NextResponse.json(
      { error: `Erreur lors de la déclaration de l'absence : ${insertErr?.message ?? 'inconnue'}` },
      { status: 500 },
    )
  }

  // ── Créneaux impactés (gardes futures du véto, statut diffusé) ──
  let impactes
  try {
    impactes = await recenserCreneauxImpactes(supabase, cabinetId, veterinaire_id, date_debut, date_fin)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }

  // ── Proposition de réparation par créneau ────────────────
  // Cache du contexte par période (resoudreContexte est coûteux : 1 par période).
  const ctxCache = new Map<string, ContexteCrisePeriode>()

  const creneauxImpactes = []
  for (const imp of impactes) {
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
      besoinSecond: besoinSecondCreneau(imp.typeEngine, imp.saison, ctx.nbVetosSemaineSoir, ctx.placesNuitSemaine),
    }

    const resultat = proposerReparation({
      creneau,
      absentId: veterinaire_id,
      vets: ctx.vets,
      planningComplet: ctx.planningComplet,
      calendrier: ctx.calendrier,
      structure: ctx.structure,
      equityWeights: ctx.equityWeights,
      roleAvantageFinancier: ctx.roleAvantageFinancier,
      // #17 — lookback inter-périodes (même jonction qu'à la génération).
      contexteAnterieur: ctx.contexteAnterieur,
    })

    creneauxImpactes.push({
      gardeId: imp.gardeId,
      date: imp.date,
      type: imp.type, // type DB (pour l'affichage)
      role: imp.role,
      meilleur: resultat.meilleur,
      candidats: resultat.candidats,
      // Présent UNIQUEMENT si aucun remplaçant légal (ex : week-end non réparable
      // à l'unité). Le diagnostic explique la règle en cause ; meilleur = null.
      ...(resultat.diagnostic ? { diagnostic: resultat.diagnostic } : {}),
    })
  }

  return NextResponse.json({ absence, creneauxImpactes })
}
