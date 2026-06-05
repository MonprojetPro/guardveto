// ============================================================
// GUARDVETO — API Route POST /api/generate
// ============================================================
// Charge les données depuis Supabase, lance le solver backtracking,
// puis insère les gardes générées en base (statut brouillon).
//
// Accès : admin uniquement
// Corps : { periodeId: string }
// Réponse succès  : { success: true, nbGardes, dureeMs }
// Réponse impasse : { success: false, joursNonCouverts[], dureeMs }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chargerInputDepuisSupabase } from '@/engine/loader'
import { genererPlanningPur } from '@/engine/solver'
import { estJourFerie } from '@/engine/utils'
import { supprimerEvenementsCalendrier } from '@/lib/sync-calendrier'
import type { TypeGardeEngine } from '@/engine/types'

// Laisse le temps au solver + nettoyage agenda (évite le timeout serverless)
export const maxDuration = 60

// ── Helpers ──────────────────────────────────────────────

/**
 * Convertit le type interne du moteur vers le type de la table gardes.
 * Les attributions `vendredi_soir` sont ignorées (stockées dans weekend).
 */
function mapTypeGardeEnDb(type: TypeGardeEngine, date: string): 'semaine' | 'weekend' | 'ferie' {
  if (type === 'weekend') return 'weekend'
  // semaine_soir sur un jour férié → type 'ferie' en DB
  if (estJourFerie(date)) return 'ferie'
  return 'semaine'
}

// ── Handler principal ────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  // ── Authentification ────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'Non authentifié. Veuillez vous connecter.' },
      { status: 401 }
    )
  }

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

  // ── Validation du corps ─────────────────────────────────
  let periodeId: string
  try {
    const body = await req.json()
    periodeId = body?.periodeId
    if (!periodeId || typeof periodeId !== 'string') {
      return NextResponse.json(
        { error: 'Corps invalide. Attendu : { periodeId: string }' },
        { status: 400 }
      )
    }
  } catch {
    return NextResponse.json(
      { error: 'Corps de requête non parsable (JSON attendu).' },
      { status: 400 }
    )
  }

  // ── Chargement des données ──────────────────────────────
  let input
  try {
    input = await chargerInputDepuisSupabase(periodeId)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    )
  }

  if (input.vets.length === 0) {
    return NextResponse.json(
      { error: 'Aucun vétérinaire actif trouvé. Impossible de générer le planning.' },
      { status: 422 }
    )
  }

  // ── Génération du planning ──────────────────────────────
  const result = genererPlanningPur(input)

  if (!result.success) {
    // Impasse : retourne le rapport sans modifier la base
    return NextResponse.json({
      success: false,
      joursNonCouverts: result.joursNonCouverts,
      dureeMs: result.dureeMs,
    })
  }

  // ── Insertion en base ───────────────────────────────────
  // 0. Supprimer les événements Google Agenda existants de cette période
  //    (sinon ils resteraient orphelins/en doublon après régénération)
  await supprimerEvenementsCalendrier(supabase, periodeId)

  // 1. Supprimer les gardes brouillon existantes pour cette période
  const { error: deleteErr } = await supabase
    .from('gardes')
    .delete()
    .eq('periode_id', periodeId)
    .eq('verrouille', false)

  if (deleteErr) {
    return NextResponse.json(
      { error: `Erreur suppression du brouillon précédent : ${deleteErr.message}` },
      { status: 500 }
    )
  }

  // 2. Préparer les gardes à insérer (vendredi_soir exclu — fusionné dans weekend)
  const gardesAInserer = result.planning.attributions
    .filter((a) => a.type !== 'vendredi_soir')
    .map((a) => ({
      periode_id: periodeId,
      date: a.date,
      type: mapTypeGardeEnDb(a.type, a.date),
      premier_id: a.premier_id,
      second_id: a.second_id,
      verrouille: false,
      modifie_manuellement: false,
    }))

  // 3. Insérer en bloc
  const { error: insertErr } = await supabase.from('gardes').insert(gardesAInserer)

  if (insertErr) {
    return NextResponse.json(
      { error: `Erreur insertion des gardes : ${insertErr.message}` },
      { status: 500 }
    )
  }

  // Régénérer = repartir sur un brouillon : le nouveau planning doit être
  // revérifié puis republié (ce qui re-notifie les vétérinaires du changement).
  await supabase
    .from('periodes')
    .update({ statut: 'brouillon', publie_at: null })
    .eq('id', periodeId)

  return NextResponse.json({
    success: true,
    nbGardes: gardesAInserer.length,
    dureeMs: result.dureeMs,
  })
}
