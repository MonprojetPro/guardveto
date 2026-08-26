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
// Réponse (B-053) — trois issues, le planning est TOUJOURS persisté sauf la 3e :
//   { issue: 'complet', success: true,  nbGardes, snapshotId, creneauxVides: [] }
//   { issue: 'partiel', success: false, nbGardes, creneauxVides[] } ← à compléter
//   { issue: 'echec',   success: false, error }  ← rien n'a pu être attribué
// ⚠️ `issue` et non `statut` : ce dernier désigne déjà le statut de la PÉRIODE
//    dans la réponse `requiresConfirmation` — deux sens pour un nom, jamais.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { genererPlanningPur } from '@/engine/solver'
import { estJourFerie } from '@/engine/utils'
import { supprimerEvenementsParIds } from '@/lib/sync-calendrier'
import { resoudreContexte } from '@/data/resoudreContexte'
import { detecterCreneauxIgnores } from '@/engine/creneau-modele'
import { persisterResultat } from '@/data/persisterResultat'
import { construireGardePlacements } from '@/data/gardePlacements'
import { syncAttributionsPourJours, joursImpactesGarde } from '@/data/syncAttributions'
import { signalerIncidentTechnique } from '@/lib/notifications-inapp'
import type { CalendrierResolu } from '@/engine/types'

// Verrou de génération : au-delà de ce délai, un verrou est considéré périmé
// (crash serverless sans libération) — largement > maxDuration (60 s).
const VERROU_PERIME_MS = 3 * 60 * 1000

// Laisse le temps au solver LNS + nettoyage agenda (évite le timeout serverless)
export const maxDuration = 60

// Plafond de TEMPS du backtracking du seed (dette technique : pire cas infaisable
// vicieux non borné). Coupe PROPRE bien avant maxDuration (60 s), en gardant ~20 s
// de marge pour la persistance + le nettoyage agenda.
const SEED_DEADLINE_MS = 30_000

// B-060 — budget de la passe de rattrapage. MiKL, 26/08 : « ce n'est pas grave
// de prendre quelques secondes en plus ». On les prend ici, pas ailleurs : le
// seed passe de 40 à 30 s (il ne trouvait de toute façon rien de plus au-delà,
// il prouvait l'impasse), et la reprise hérite du temps libéré. Total inchangé,
// sous les 60 s de la fonction.
const RATTRAPAGE_BUDGET_MS = 12_000

// ── Helpers ──────────────────────────────────────────────

/**
 * Convertit le type interne du moteur vers le type de la table gardes (V1).
 * Les attributions `vendredi_soir` sont ignorées (stockées dans weekend).
 * Zone-aware (fix audit 2026-07-03) : le calendrier du cabinet est utilisé —
 * MÊME source que le solver — sinon `gardes.type` divergeait du moteur pour
 * tout cabinet dont les fériés diffèrent du fallback national en dur.
 *
 * Généralisé P3b : un code SUR-MESURE est persisté TEL QUEL (le CHECK 3 valeurs
 * de `gardes.type` est levé en migration). Il garde son code même un jour férié
 * (la reclassification 'ferie' est un héritage propre à semaine_soir) — sinon
 * deux gardes du même jour entreraient en collision sur UNIQUE(date, type).
 */
function mapTypeGardeEnDb(
  type: string,
  date: string,
  calendrier?: CalendrierResolu,
): string {
  if (type === 'weekend') return 'weekend'
  if (type === 'semaine_soir') {
    // semaine_soir sur un jour férié → type 'ferie' en DB (héritage V1)
    return estJourFerie(date, calendrier) ? 'ferie' : 'semaine'
  }
  return type
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

    // Une période VERROUILLÉE est de l'histoire : elle se consulte, elle ne se
    // regénère pas. Le refus vit ICI et pas seulement dans l'écran : jusqu'au
    // 2026-08-19, seul un voile côté client l'empêchait — et ce voile empêchait
    // AUSSI la simple consultation, qu'il promettait pourtant. En le levant, il
    // fallait fermer la porte pour de bon, côté serveur.
    // (Le filtre `verrouille = false` plus bas protège les GARDES une à une ;
    // il n'a jamais rien dit du statut de la période.)
    if (periode.statut === 'verrouille') {
      return NextResponse.json(
        {
          error:
            'Cette période est verrouillée : elle se consulte, elle ne se régénère plus. Ouvre la période de travail pour agir.',
        },
        { status: 409 },
      )
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
  //
  // ⚠️ Ce compare-and-swap vit en SQL (`acquerir_verrou_generation`) et NON
  // ici. Écrit en `.update().or()`, il répondait 500 à CHAQUE génération —
  // « column periodes.generation_lock_at does not exist » alors que la colonne
  // existe. PostgREST accepte un filtre `or=` en lecture mais le qualifie
  // `periodes.colonne` en écriture, où la requête utilise un alias. Prouvé par
  // sonde le 2026-08-02. Ne PAS revenir à un `.or()` sur un update.
  const cutoffVerrou = new Date(Date.now() - VERROU_PERIME_MS).toISOString()
  const { data: verrouAcquis, error: verrouErr } = await supabase.rpc(
    'acquerir_verrou_generation',
    { p_periode_id: periodeId, p_cutoff: cutoffVerrou },
  )

  if (verrouErr) {
    return NextResponse.json(
      { error: `Erreur d'acquisition du verrou de génération : ${verrouErr.message}` },
      { status: 500 }
    )
  }
  if (verrouAcquis !== true) {
    return NextResponse.json(
      { error: 'Une génération est déjà en cours pour cette période. Attends quelques secondes puis réessaie.' },
      { status: 409 }
    )
  }

  // ── LE FLUX : la génération raconte ce qu'elle fait ─────────
  //
  // Tout ce qui précède pouvait échouer AVANT que le travail commence (auth,
  // période introuvable, verrou) : ces refus restent du JSON simple, immédiat.
  // À partir d'ici on travaille, parfois plusieurs secondes — et on le DIT, au
  // fil de l'eau, en NDJSON : une ligne par étape, la dernière portant le
  // résultat. Le client affiche ce que le serveur annonce, jamais autre chose.
  // NDJSON : un objet par ligne. Le séparateur est nommé plutôt qu'écrit en
  // clair — un simple saut de ligne dans une chaîne se perd à la relecture.
  const FIN_DE_LIGNE = String.fromCharCode(10)
  const encodeur = new TextEncoder()
  const flux = new ReadableStream({
    async start(controleur) {
      const ecrire = (objet: unknown) => {
        controleur.enqueue(encodeur.encode(JSON.stringify(objet) + FIN_DE_LIGNE))
      }
      const emettre = (message: string) => ecrire({ type: 'progres', message })

      try {
        emettre('Je relis les règles et les congés du cabinet…')
        const { status, corps } = await executerGeneration(supabase, periodeId, cabinetId, emettre)
        ecrire({ type: 'resultat', status, corps })
      } catch (err) {
        // Une exception ici laisserait le client sur un flux muet : il attendrait
        // un résultat qui ne viendrait jamais. On la transforme en résultat.
        console.error('[generate] exception pendant la génération :', err)
        ecrire({
          type: 'resultat',
          status: 500,
          corps: { error: err instanceof Error ? err.message : String(err) },
        })
      } finally {
        controleur.close()
      }
    },
  })

  return new Response(flux, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
    },
  })
}

/**
 * Le résultat d'une étape, avant d'être mis en forme pour le client.
 *
 * B-060 — la génération DIT où elle en est pendant qu'elle travaille (flux
 * NDJSON), et ne peut donc plus renvoyer des `NextResponse` en cours de route :
 * elle rend un objet, et c'est le handler qui l'écrit dans le flux. Le nom
 * `reponse` est choisi pour que la substitution reste mécanique et lisible dans
 * l'historique — un seul mot change par retour.
 */
function reponse(corps: unknown, init?: { status?: number }) {
  return { status: init?.status ?? 200, corps }
}

type ResultatEtape = ReturnType<typeof reponse>

/**
 * Le travail lui-même : contexte, moteur, rattrapage, persistance.
 *
 * `emettre` remonte les étapes en direct. Exigence de MiKL, le 26/08 : « je
 * préfère prendre plus de temps et l'utilisateur le comprendra si tu indiques
 * en direct ce qu'il se passe ». La progression vient donc du SERVEUR — un
 * décompte joué côté client, sans lien avec le travail réel, serait décoratif.
 */
async function executerGeneration(
  supabase: Awaited<ReturnType<typeof createClient>>,
  periodeId: string,
  cabinetId: string,
  emettre: (message: string) => void,
): Promise<ResultatEtape> {
  try {
    // ── Chargement du contexte (V2 : inclut le calendrier) ─────
    let contexte
    try {
      // B-046 — `pourGeneration` retire les « dernier recours » de l'effectif.
      contexte = await resoudreContexte(periodeId, cabinetId, { pourGeneration: true })
    } catch (err) {
      return reponse(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 404 }
      )
    }

    // B-046 — les « dernier recours » retirés de l'effectif par le chargement.
    // Ils ne sont PAS une anomalie : c'est le réglage voulu. Mais dès que la
    // génération échoue, ils doivent être nommés — une impasse causée par une
    // exclusion volontaire qui se tait envoie l'admin chercher un coupable
    // parmi ses règles.
    const exclusDernierRecours = (contexte.exclusDernierRecours ?? []).map((v) => v.prenom)

    if (contexte.vets.length === 0) {
      return reponse(
        {
          error:
            exclusDernierRecours.length > 0
              ? `Aucun vétérinaire mobilisable : les seules personnes actives (${exclusDernierRecours.join(', ')}) sont en « dernier recours uniquement », et le moteur ne les utilise jamais. Décoche ce réglage sur l'écran Équipe pour au moins l'une d'elles.`
              : 'Aucun vétérinaire actif trouvé. Impossible de générer le planning.',
        },
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
    // seedDeadlineMs : coupe PROPRE du backtracking du seed avant le timeout
    // serverless brutal (dette technique). Non déterministe → chemin serveur only.
    emettre('Je cherche la répartition la plus équitable…')
    const result = genererPlanningPur({
      ...contexte,
      seedDeadlineMs: SEED_DEADLINE_MS,
      // B-060 — la reprise sur les cases vides. Elle ne se déclenche QUE sur un
      // planning incomplet, et raconte ce qu'elle trouve.
      rattrapage: { budgetMs: RATTRAPAGE_BUDGET_MS, onProgres: emettre },
    })

    // ── B-053 — UN ÉCHEC N'EST PLUS UN MUR ──────────────────────
    //
    // Avant : sur impasse, la route retournait sans rien écrire. L'admin perdait
    // 100 % du travail du moteur pour un seul enchaînement impossible, et n'avait
    // aucun moyen de reprendre la main (on ne complète pas à la main un planning
    // qui n'existe pas).
    //
    // Maintenant : le moteur rend TOUJOURS ce qu'il a pu remplir (`planningPartiel`,
    // sans aucune règle dure enfreinte) + la liste des cases vraiment vides. On
    // persiste ce planning comme un brouillon À COMPLÉTER, par le MÊME chemin que
    // le succès — aucune seconde écriture à maintenir en parallèle.
    const planningRetenu = result.success ? result.planning : result.planningPartiel
    const creneauxVides = result.success ? [] : (result.creneauxVides ?? [])
    const placesPourvues = planningRetenu.attributions.reduce(
      (n, a) => n + a.placements.filter((p) => p.vetId).length, 0,
    )

    // Le seul cas qui reste un échec sec : le moteur n'a RIEN pu pourvoir.
    // Écraser un planning existant par du vide serait une destruction, pas un
    // secours. (Équipe absente, période aberrante… en pratique très rare.)
    if (!result.success && placesPourvues === 0) {
      return reponse({
        issue: 'echec',
        success: false,
        interrompu: result.interrompu ?? false,
        error: result.interrompu
          ? (result.raisonInterruption ?? 'Génération interrompue (calcul trop long).')
          : "Aucune garde n'a pu être attribuée sur cette période.",
        diagnostic: result.diagnostic ?? null,
        joursNonCouverts: result.joursNonCouverts,
        creneauxVides,
        creneauxIgnores,
        exclusDernierRecours,
        dureeMs: result.dureeMs,
      })
    }

    // ── Persistence V2 (attributions) ───────────────────────────
    emettre(
      creneauxVides.length > 0
        ? `J’enregistre le planning — ${creneauxVides.length} case${creneauxVides.length > 1 ? 's' : ''} restera${creneauxVides.length > 1 ? 'ont' : ''} à pourvoir`
        : 'J’enregistre le planning…',
    )
    let persistenceResult
    try {
      persistenceResult = await persisterResultat(planningRetenu, periodeId, cabinetId)
    } catch (err) {
      return reponse(
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
      return reponse(
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
      return reponse(
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
      return reponse(
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
    const attributionsInserees = planningRetenu.attributions
      .filter((a) => a.type !== 'vendredi_soir')
      .map((a) => ({ a, dbType: mapTypeGardeEnDb(a.type, a.date, contexte.calendrier) }))
      .filter(({ a, dbType }) => !clesVerrouillees.has(`${a.date}|${dbType}`))

    // Places POSITIONNELLES (P3b) : place 0 → premier_id, place 1 → second_id
    // (même convention que garde_placements). Pour le défaut, placements =
    // [premier, second] → identique aux anciens premierId()/secondId(). Les
    // rôles custom d'un créneau sur-mesure remplissent ainsi les colonnes V1
    // au lieu de les laisser à null ; les places au-delà de 2 vivent dans
    // garde_placements (miroir P3b-1).
    const gardesAInserer = attributionsInserees.map(({ a, dbType }) => ({
      periode_id: periodeId,
      cabinet_id: cabinetId,
      date: a.date,
      type: dbType,
      premier_id: a.placements[0]?.vetId ?? null,
      second_id: a.placements[1]?.vetId ?? null,
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
      return reponse(
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

    // 3c. Réalignement V2 sur les gardes VERROUILLÉES (P6 verrou n°7, étape 3).
    //     persisterResultat a écrit dans `attributions` le planning du SOLVER
    //     pour TOUTE la période — mais l'étape 2 a exclu de la V1 les (date,
    //     type) verrouillés (le verrou existant prime sur la proposition du
    //     solver). Sans réalignement, V2 porterait l'équipe du solver là où V1
    //     garde l'équipe verrouillée → dérive garantie dès la régénération.
    //     Resynchro PAR JOUR depuis la V1 (le vendredi lié d'un week-end
    //     verrouillé suit). Aucune garde verrouillée → no-op (byte-identique).
    if (clesVerrouillees.size > 0) {
      const joursVerrouilles = [
        ...new Set(
          ((gardesVerrouillees ?? []) as { date: string; type: string }[])
            .flatMap((g) => joursImpactesGarde(g.date, g.type))
        ),
      ]
      const syncVerrous = await syncAttributionsPourJours(
        supabase, periodeId, cabinetId, joursVerrouilles,
      )
      if (!syncVerrous.ok) {
        console.error('[sync-V2] réalignement des gardes verrouillées échoué:', syncVerrous.erreur)
        await signalerIncidentTechnique(
          supabase, cabinetId,
          'Copie technique du planning (V2) désynchronisée',
          'Le planning a bien été généré, mais sa copie technique (attributions) n\'a pas pu être réalignée sur les gardes verrouillées. Le contrôle de cohérence la signalera tant qu\'elle diverge.',
        )
      }
    }

    // 4. Purge des anciens événements Google Agenda — APRÈS le succès de la
    //    réécriture, avec les ids capturés à l'étape 0. Best-effort : un échec
    //    ne casse pas la génération (la resynchro se fait à la publication).
    try {
      // #10b — calendarId scopé au cabinet (colonne cabinets.google_calendar_id) ;
      // fallback env GOOGLE_CALENDAR_ID en aval si la colonne est nulle (pilote).
      const { data: cab } = await supabase
        .from('cabinets')
        .select('google_calendar_id')
        .eq('id', cabinetId)
        .single()
      const calendarId = ((cab as { google_calendar_id?: string | null } | null)
        ?.google_calendar_id ?? '').trim() || null
      await supprimerEvenementsParIds(eventIdsAPurger, calendarId)
    } catch (e) {
      console.error('[generate] purge agenda échouée (best-effort):', e)
      await signalerIncidentTechnique(
        supabase, cabinetId,
        'Nettoyage Google Agenda incomplet',
        "D'anciens événements de la période n'ont pas pu être retirés de Google Agenda pendant la régénération. Des doublons peuvent apparaître à la republication.",
      )
    }

    // B-053 — trois issues, dites explicitement. `success` reste pour la
    // rétro-compat, mais il ne suffit plus : un planning PARTIEL est bien en
    // base et parfaitement utilisable, il a seulement des cases à pourvoir.
    return reponse({
      issue: creneauxVides.length > 0 ? 'partiel' : 'complet',
      success: creneauxVides.length === 0,
      nbGardes: gardesAInserer.length,
      snapshotId: persistenceResult.snapshotId,
      creneauxIgnores,
      creneauxVides,
      exclusDernierRecours,
      // Le calcul a été coupé avant d'avoir tout exploré : ce qui est en base
      // est bon, mais une recherche complète aurait peut-être fait mieux.
      interrompu: result.success ? false : (result.interrompu ?? false),
      diagnostic: result.success ? null : (result.diagnostic ?? null),
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
