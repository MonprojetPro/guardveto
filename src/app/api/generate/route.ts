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
// Réponse succès  : { success: true, nbGardes, snapshotId, creneauxIgnores[], dureeMs }
// Réponse impasse : { success: false, joursNonCouverts[], creneauxIgnores[], dureeMs }
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { genererPlanningPur } from '@/engine/solver'
import { premierId, secondId } from '@/engine/attribution'
import { estJourFerie } from '@/engine/utils'
import { supprimerEvenementsParIds } from '@/lib/sync-calendrier'
import { resoudreContexte } from '@/data/resoudreContexte'
import { detecterCreneauxIgnores } from '@/engine/creneau-modele'
import { persisterResultat } from '@/data/persisterResultat'
import { construireGardePlacements } from '@/data/gardePlacements'
import { signalerIncidentTechnique } from '@/lib/notifications-inapp'
import type { TypeGardeEngine, CalendrierResolu } from '@/engine/types'

// Verrou de génération : au-delà de ce délai, un verrou est considéré périmé
// (crash serverless sans libération) — largement > maxDuration (60 s).
const VERROU_PERIME_MS = 3 * 60 * 1000

// Laisse le temps au solver LNS + nettoyage agenda (évite le timeout serverless)
export const maxDuration = 60

// ── Helpers ──────────────────────────────────────────────

/**
 * Convertit le type interne du moteur vers le type de la table gardes (V1).
 * Les attributions `vendredi_soir` sont ignorées (stockées dans weekend).
 * Zone-aware (fix audit 2026-07-03) : le calendrier du cabinet est utilisé —
 * MÊME source que le solver — sinon `gardes.type` divergeait du moteur pour
 * tout cabinet dont les fériés diffèrent du fallback national en dur.
 */
function mapTypeGardeEnDb(
  type: TypeGardeEngine,
  date: string,
  calendrier?: CalendrierResolu,
): 'semaine' | 'weekend' | 'ferie' {
  if (type === 'weekend') return 'weekend'
  // semaine_soir sur un jour férié → type 'ferie' en DB
  if (estJourFerie(date, calendrier)) return 'ferie'
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
  let confirmRepublication: boolean
  try {
    const body = await req.json()
    periodeId = body?.periodeId
    confirmRepublication = body?.confirmRepublication === true
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

  // ── Garde-fou régénération d'une période PUBLIÉE (Chantier B) ──
  // Régénérer écrase le planning publié, le repasse en brouillon, supprime les
  // événements Google Agenda et impose une republication (re-notifie les vétos).
  // On REFUSE de le faire en silence : sans confirmation explicite, on renvoie
  // un signal `requiresConfirmation` que l'UI transforme en dialogue.
  {
    const { data: periode } = await supabase
      .from('periodes')
      .select('statut')
      .eq('id', periodeId)
      .single()

    if (!periode) {
      return NextResponse.json({ error: 'Période introuvable.' }, { status: 404 })
    }

    if (periode.statut === 'publie' && !confirmRepublication) {
      const { count } = await supabase
        .from('gardes')
        .select('id', { count: 'exact', head: true })
        .eq('periode_id', periodeId)
        .eq('cabinet_id', cabinetId)

      return NextResponse.json({
        requiresConfirmation: true,
        statut: 'publie',
        nbGardes: count ?? 0,
      })
    }
  }

  // ── Verrou de génération (audit 2026-07-03, concurrence) ──────
  // Compare-and-swap sur periodes.generation_lock_at : une seule génération à
  // la fois par période. Un verrou plus vieux que VERROU_PERIME_MS est réputé
  // abandonné (crash serverless) et peut être volé.
  const cutoffVerrou = new Date(Date.now() - VERROU_PERIME_MS).toISOString()
  const { data: verrouAcquis, error: verrouErr } = await supabase
    .from('periodes')
    .update({ generation_lock_at: new Date().toISOString() })
    .eq('id', periodeId)
    .or(`generation_lock_at.is.null,generation_lock_at.lt.${cutoffVerrou}`)
    .select('id')

  if (verrouErr) {
    return NextResponse.json(
      { error: `Erreur d'acquisition du verrou de génération : ${verrouErr.message}` },
      { status: 500 }
    )
  }
  if (!verrouAcquis || verrouAcquis.length === 0) {
    return NextResponse.json(
      { error: 'Une génération est déjà en cours pour cette période. Attends quelques secondes puis réessaie.' },
      { status: 409 }
    )
  }

  try {
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

    // ── Créneaux du catalogue ignorés par le moteur (backlog n°4, tranche 1) ──
    // Un créneau sur-mesure (code inconnu) ou masqué par un autre le même jour
    // ne génère AUCUN slot — jusqu'ici en silence. On le dit à l'admin.
    const creneauxIgnores = contexte.creneaux
      ? detecterCreneauxIgnores(contexte.creneaux)
      : []

    // ── Génération du planning (solver LNS) ─────────────────────
    const result = genererPlanningPur(contexte)

    if (!result.success) {
      // Impasse : retourne le rapport complet sans modifier la base.
      // Le diagnostic (créneau bloquant + règles en cause + suggestions) est
      // ÉPHÉMÈRE — on ne persiste rien, on le renvoie tel quel à l'UI.
      return NextResponse.json({
        success: false,
        diagnostic: result.diagnostic ?? null,
        joursNonCouverts: result.joursNonCouverts,
        creneauxIgnores,
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

    // ── DÉPUBLICATION AVANT toute destruction (audit 2026-07-03) ─
    // On passe la période en brouillon AVANT le DELETE/INSERT : si l'écriture
    // échoue à mi-course, la période est un brouillon incomplet (l'admin
    // régénère), JAMAIS un planning « publié » vide que les vétos verraient.
    const { error: depubErr } = await supabase
      .from('periodes')
      .update({ statut: 'brouillon', publie_at: null })
      .eq('id', periodeId)

    if (depubErr) {
      return NextResponse.json(
        { error: `Erreur de dépublication avant régénération : ${depubErr.message}` },
        { status: 500 }
      )
    }

    // ── Persistence V1 (gardes) — transition F1-002 ─────────────
    // La table `gardes` reste la source de vérité pour les composants
    // UI existants jusqu'à la fin de la migration V1 → V2 (F1-002).

    // 0. CAPTURER les ids d'événements Google Agenda AVANT le DELETE
    //    (ils vivent sur les lignes `gardes`) — mais ne purger l'agenda
    //    qu'APRÈS le succès de la réécriture (étape 4). Ancien comportement :
    //    purge d'abord → un échec à mi-course laissait base vide + agenda vidé.
    const { data: gardesAvecEvent } = await supabase
      .from('gardes')
      .select('google_event_id')
      .eq('periode_id', periodeId)
      .eq('cabinet_id', cabinetId)
      .eq('verrouille', false)
      .not('google_event_id', 'is', null)

    const eventIdsAPurger = ((gardesAvecEvent ?? []) as { google_event_id: string | null }[])
      .map((g) => g.google_event_id)
      .filter((id): id is string => Boolean(id))

    // 1. Supprimer les gardes brouillon existantes pour cette période.
    //    Scopé cabinet_id (défense en profondeur : en DEV_BYPASS le client
    //    service_role contourne la RLS, donc on filtre explicitement).
    //    On NE supprime PAS les gardes verrouillées (verrouille=true) :
    //    elles représentent des décisions figées à préserver.
    const { error: deleteErr } = await supabase
      .from('gardes')
      .delete()
      .eq('periode_id', periodeId)
      .eq('cabinet_id', cabinetId)
      .eq('verrouille', false)

    if (deleteErr) {
      return NextResponse.json(
        { error: `Erreur suppression du brouillon précédent : ${deleteErr.message}` },
        { status: 500 }
      )
    }

    // 1b. Recenser les gardes verrouillées résiduelles de la période.
    //     Le solver régénère TOUTE la période sans connaître les verrous ;
    //     on doit donc exclure les (date, type) déjà verrouillés de l'insert,
    //     sinon collision sur l'index UNIQUE(cabinet_id, date, type).
    const { data: gardesVerrouillees, error: lockedErr } = await supabase
      .from('gardes')
      .select('date, type')
      .eq('periode_id', periodeId)
      .eq('cabinet_id', cabinetId)
      .eq('verrouille', true)

    if (lockedErr) {
      return NextResponse.json(
        { error: `Erreur lecture des gardes verrouillées : ${lockedErr.message}` },
        { status: 500 }
      )
    }

    const clesVerrouillees = new Set(
      ((gardesVerrouillees ?? []) as { date: string; type: string }[])
        .map((g) => `${g.date}|${g.type}`)
    )

    // 2. Préparer les gardes à insérer (vendredi_soir exclu — fusionné dans weekend ;
    //    dates/type déjà verrouillés exclus — on conserve le verrou existant).
    //    On garde EN PARALLÈLE l'attribution source + sa clé de type DB, pour la
    //    double écriture P3b-1 (garde_placements) avec exactement le même filtre.
    const attributionsInserees = result.planning.attributions
      .filter((a) => a.type !== 'vendredi_soir')
      .map((a) => ({ a, dbType: mapTypeGardeEnDb(a.type, a.date, contexte.calendrier) }))
      .filter(({ a, dbType }) => !clesVerrouillees.has(`${a.date}|${dbType}`))

    const gardesAInserer = attributionsInserees.map(({ a, dbType }) => ({
      periode_id: periodeId,
      cabinet_id: cabinetId,
      date: a.date,
      type: dbType,
      premier_id: premierId(a),
      second_id: secondId(a),
      verrouille: false,
      modifie_manuellement: false,
    }))

    // 3. Insérer en bloc — upsert idempotent scopé cabinet.
    //    ON CONFLICT (cabinet_id, date, type) DO NOTHING : si une ligne
    //    subsistait (course/retry), on ne casse pas la régénération.
    const { error: insertErr } = await supabase
      .from('gardes')
      .upsert(gardesAInserer, {
        onConflict: 'cabinet_id,date,type',
        ignoreDuplicates: true,
      })

    if (insertErr) {
      return NextResponse.json(
        { error: `Erreur insertion des gardes : ${insertErr.message}` },
        { status: 500 }
      )
    }

    // 3b. Double écriture P3b-1 — miroir des placements dans garde_placements
    //     (enfant de gardes.id, généralise premier_id/second_id vers N places).
    //     ADDITIF : aucun lecteur ne la consomme encore → best-effort. Un échec
    //     ici NE casse JAMAIS la persistance V1 : `gardes` reste la source de vérité.
    //     Les placements des gardes brouillon supprimées (étape 1) sont partis en
    //     cascade ; on ne (ré)écrit que ceux des gardes qu'on vient d'insérer.
    try {
      const { data: gardesEcrites } = await supabase
        .from('gardes')
        .select('id, date, type')
        .eq('periode_id', periodeId)
        .eq('cabinet_id', cabinetId)

      const idParCle = new Map<string, string>()
      for (const g of (gardesEcrites ?? []) as { id: string; date: string; type: string }[]) {
        idParCle.set(`${g.date}|${g.type}`, g.id)
      }

      const placementsRows = construireGardePlacements(
        attributionsInserees.map(({ a, dbType }) => ({
          date: a.date,
          dbType,
          placements: a.placements,
        })),
        idParCle,
        cabinetId,
      )

      if (placementsRows.length > 0) {
        const { error: placementsErr } = await supabase
          .from('garde_placements')
          .upsert(placementsRows, { onConflict: 'garde_id,place_index', ignoreDuplicates: false })
        if (placementsErr) {
          console.error('[P3b-1] double écriture garde_placements échouée:', placementsErr.message)
          await signalerIncidentTechnique(
            supabase, cabinetId,
            'Écriture des placements incomplète',
            'La copie technique des attributions (garde_placements) a échoué pendant la génération. Le planning affiché est correct ; signale-le si ça se répète.',
          )
        }
      }
    } catch (e) {
      console.error('[P3b-1] double écriture garde_placements exception:', e)
      await signalerIncidentTechnique(
        supabase, cabinetId,
        'Écriture des placements incomplète',
        'La copie technique des attributions (garde_placements) a échoué pendant la génération. Le planning affiché est correct ; signale-le si ça se répète.',
      )
    }

    // 4. Purge des anciens événements Google Agenda — APRÈS le succès de la
    //    réécriture, avec les ids capturés à l'étape 0. Best-effort : un échec
    //    ne casse pas la génération (la resynchro se fait à la publication).
    try {
      await supprimerEvenementsParIds(eventIdsAPurger)
    } catch (e) {
      console.error('[generate] purge agenda échouée (best-effort):', e)
      await signalerIncidentTechnique(
        supabase, cabinetId,
        'Nettoyage Google Agenda incomplet',
        "D'anciens événements de la période n'ont pas pu être retirés de Google Agenda pendant la régénération. Des doublons peuvent apparaître à la republication.",
      )
    }

    return NextResponse.json({
      success: true,
      nbGardes: gardesAInserer.length,
      snapshotId: persistenceResult.snapshotId,
      creneauxIgnores,
      dureeMs: result.dureeMs,
    })
  } finally {
    // Libération du verrou de génération — sur TOUS les chemins de sortie.
    await supabase
      .from('periodes')
      .update({ generation_lock_at: null })
      .eq('id', periodeId)
  }
}
