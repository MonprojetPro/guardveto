// ============================================================
// GUARDVETO — API Route POST /api/generate
// ============================================================
// Charge le contexte depuis Supabase, lance le solver LNS,
// puis persiste les attributions en base (statut brouillon).
//
// Pipeline V2 (F6-002) :
//   resoudreContexte → genererPlanningPur → persisterResultat
//
// Transition V1 → V2 :
//   - Écrit dans `attributions` (V2) via persisterResultat
//   - Écrit aussi dans `gardes` (V1) pour la période de transition
//     jusqu'à la fin de la migration F1-002
//
// Accès : admin uniquement
// Corps : { periodeId: string }
// Réponse succès  : { success: true, nbGardes, snapshotId, dureeMs }
// Réponse impasse : { success: false, joursNonCouverts[], dureeMs }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { genererPlanningPur } from '@/engine/solver'
import { estJourFerie } from '@/engine/utils'
import { supprimerEvenementsCalendrier } from '@/lib/sync-calendrier'
import { resoudreContexte } from '@/data/resoudreContexte'
import { persisterResultat } from '@/data/persisterResultat'
import type { TypeGardeEngine } from '@/engine/types'

// Laisse le temps au solver LNS + nettoyage agenda (évite le timeout serverless)
export const maxDuration = 60

// ── Helpers ──────────────────────────────────────────────

/**
 * Convertit le type interne du moteur vers le type de la table gardes (V1).
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
  // app_metadata n'est modifiable que par le service_role — jamais par l'utilisateur.
  // Utiliser user_metadata serait une escalade de privilèges triviale.
  const cabinetId = user.app_metadata?.cabinet_id as string | undefined
  if (!cabinetId) {
    return NextResponse.json(
      { error: 'Cabinet non configuré pour cet utilisateur (app_metadata.cabinet_id manquant).' },
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

  // ── Chargement du contexte (V2 : inclut le calendrier) ─────
  let contexte
  try {
    contexte = await resoudreContexte(periodeId, cabinetId)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 404 }
    )
  }

  if (contexte.vets.length === 0) {
    return NextResponse.json(
      { error: 'Aucun vétérinaire actif trouvé. Impossible de générer le planning.' },
      { status: 422 }
    )
  }

  // ── Génération du planning (solver LNS) ─────────────────────
  const result = genererPlanningPur(contexte)

  if (!result.success) {
    // Impasse : retourne le rapport sans modifier la base
    return NextResponse.json({
      success: false,
      joursNonCouverts: result.joursNonCouverts,
      dureeMs: result.dureeMs,
    })
  }

  // ── Persistence V2 (attributions) ───────────────────────────
  let persistenceResult
  try {
    persistenceResult = await persisterResultat(result.planning, periodeId, cabinetId)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  // ── Persistence V1 (gardes) — transition F1-002 ─────────────
  // La table `gardes` reste la source de vérité pour les composants
  // UI existants jusqu'à la fin de la migration V1 → V2 (F1-002).

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
      cabinet_id: cabinetId,
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
    snapshotId: persistenceResult.snapshotId,
    dureeMs: result.dureeMs,
  })
}
