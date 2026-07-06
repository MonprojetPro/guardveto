// ============================================================
// GUARDVETO — PATCH /api/gardes/[id]
// ============================================================
// Modification manuelle d'une garde (admin uniquement).
// Marque la garde comme modifie_manuellement=true.
// Si force=true : déverrouille la garde, logue dans audit_log
//                et recalcule les bonus/malus de la période.
//
// Le cycle d'application (update + audit + bilan + agenda + email) est
// factorisé dans `appliquerChangementGarde` (réutilisé aussi par la
// gestion de crise — POST /api/absences/[id]/reparer).
//
// GARDE-FOU MÉTIER (backlog n°12) — validation AU MOMENT DE L'ÉCRITURE :
// avant d'appliquer, on refuse (sauf confirmation explicite) d'affecter un
// vétérinaire INACTIF (compte désactivé) ou en CONGÉ VALIDÉ sur la date de la
// garde. Le helper `appliquerChangementGarde` ne fait volontairement AUCUN
// contrôle métier (contrat) : c'est la route appelante qui décide. La crise
// (POST /api/absences/[id]/reparer) valide de son côté via proposerReparation —
// ce garde-fou ne concerne donc QUE l'édition manuelle.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { appliquerChangementGarde } from '@/lib/gardes/appliquer-changement'

/**
 * Contrôle métier « ce véto est-il légalement affectable sur cette date ? » au
 * moment du geste. Retourne la liste d'avertissements (vide = tout va bien) :
 *   • véto INACTIF (compte désactivé) ;
 *   • véto en CONGÉ VALIDÉ couvrant la date de la garde.
 *
 * On ne valide QUE les vétos réellement affectés (premier_id / second_id du
 * corps, non nuls et dédupliqués). Lecture RLS-aware (bornée au cabinet).
 */
async function avertissementsAffectation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  gardeDate: string,
  premier_id: string | null,
  second_id: string | null,
): Promise<string[]> {
  const cibles = [...new Set([premier_id, second_id].filter((v): v is string => Boolean(v)))]
  if (cibles.length === 0) return []

  const warnings: string[] = []

  // 1. Statut actif + identité des vétos affectés.
  const { data: vetsDb } = await supabase
    .from('veterinaires')
    .select('id, prenom, nom, actif')
    .in('id', cibles)

  type VetRow = { id: string; prenom: string; nom: string; actif: boolean }
  const vets = (vetsDb as VetRow[] | null) ?? []
  const nomDe = (id: string) => {
    const v = vets.find((x) => x.id === id)
    return v ? `${v.prenom} ${v.nom}`.trim() : 'Ce vétérinaire'
  }

  for (const v of vets) {
    if (!v.actif) {
      warnings.push(`${v.prenom} ${v.nom}`.trim() + ' a un compte désactivé (inactif) : il/elle ne devrait plus être de garde.')
    }
  }

  // 2. Congés VALIDÉS couvrant la date de la garde (indisponibilité incluse).
  const { data: congesDb } = await supabase
    .from('conges')
    .select('veterinaire_id, type')
    .eq('statut', 'valide')
    .in('veterinaire_id', cibles)
    .lte('date_debut', gardeDate)
    .gte('date_fin', gardeDate)

  type CongeRow = { veterinaire_id: string; type: string }
  for (const c of (congesDb as CongeRow[] | null) ?? []) {
    const motif = c.type === 'indisponibilite' ? 'indisponible' : 'en congé validé'
    warnings.push(`${nomDe(c.veterinaire_id)} est ${motif} le ${gardeDate}.`)
  }

  return warnings
}

// La route attend la synchro agenda + l'envoi email avant de répondre
export const maxDuration = 60

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: gardeId } = await params
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

  // ── Validation du corps ─────────────────────────────────
  let premier_id: string | null
  let second_id: string | null
  let force: boolean
  let confirmerAvertissements: boolean

  try {
    const body = await req.json()
    premier_id = body?.premier_id ?? null
    second_id = body?.second_id ?? null
    force = body?.force === true
    // Confirmation explicite « affecter quand même » malgré un avertissement métier.
    confirmerAvertissements = body?.confirmerAvertissements === true
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 })
  }

  // ── Garde-fou métier : véto inactif / en congé validé (backlog n°12) ──
  // On charge la date de la garde puis on vérifie les vétos affectés. Sans
  // confirmation explicite, on RENVOIE les avertissements (409) au lieu
  // d'appliquer en silence — l'UI d'édition les affiche et propose de forcer.
  if (!confirmerAvertissements) {
    const { data: gardeDate } = await supabase
      .from('gardes')
      .select('date')
      .eq('id', gardeId)
      .single()

    if (gardeDate?.date) {
      const warnings = await avertissementsAffectation(
        supabase, gardeDate.date, premier_id, second_id,
      )
      if (warnings.length > 0) {
        return NextResponse.json(
          {
            error: warnings.length === 1
              ? warnings[0]
              : `${warnings.length} points de vigilance sur cette affectation.`,
            warnings,
            needsConfirmation: true,
          },
          { status: 409 },
        )
      }
    }
  }

  // ── Application (helper partagé) ─────────────────────────
  const res = await appliquerChangementGarde({
    supabase,
    gardeId,
    premier_id,
    second_id,
    force,
    auteurVetId: vet.id,
  })

  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.status })
  }

  return NextResponse.json({ success: true })
}
