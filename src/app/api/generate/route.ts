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
import { genererPlanningPur, genererSteps } from '@/engine/solver'
// B-111 — pour dire ce que les cadenas de l'admin ont (ou n'ont pas) protege.
import { figeesSansPlace, indexerFigees } from '@/engine/figees'
import { supprimerEvenementsParIds } from '@/lib/sync-calendrier'
import { resoudreContexte } from '@/data/resoudreContexte'
import { detecterCreneauxIgnores } from '@/engine/creneau-modele'
import { persisterResultat } from '@/data/persisterResultat'
import { ecrirePlanningV1 } from '@/data/ecrirePlanningV1'
import { signalerIncidentTechnique } from '@/lib/notifications-inapp'
import { ouvrirTrace, fermerTrace, type EtapeTracee } from '@/data/tracerGeneration'

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
  // ── B-104 (2e passe) — LA TRACE S'OUVRE AVANT LE VERROU ─────────────────
  //
  // Elle s'ouvrait juste après, et c'était un angle mort : un refus de verrou
  // n'écrivait RIEN. Le 02/09 à 22h56, l'incident s'est reproduit et la table
  // est restée vide — l'instrument était aveugle exactement là où ça casse.
  //
  // C'est le défaut que ce module dénonçait lui-même une heure plus tôt, d'un
  // cran plus tôt dans la chaîne : une trace qui ne garde que ce qui a déjà
  // commencé à bien se passer. Une TENTATIVE se trace, pas seulement un
  // travail.
  const departMs = Date.now()
  const traceId = await ouvrirTrace(supabase, periodeId, cabinetId, user.id)

  const cutoffVerrou = new Date(Date.now() - VERROU_PERIME_MS).toISOString()
  const { data: verrouAcquis, error: verrouErr } = await supabase.rpc(
    'acquerir_verrou_generation',
    { p_periode_id: periodeId, p_cutoff: cutoffVerrou },
  )

  if (verrouErr) {
    await fermerTrace(supabase, traceId, {
      issue: 'erreur',
      erreur: `verrou : ${verrouErr.message}`,
    })
    return NextResponse.json(
      { error: `Erreur d'acquisition du verrou de génération : ${verrouErr.message}` },
      { status: 500 }
    )
  }
  if (verrouAcquis !== true) {
    // Le fameux « une génération est déjà en cours ». Il laisse désormais une
    // ligne : c'est par elle qu'on saura si le verrou refuse sur une
    // génération réellement en cours, ou sur un verrou fantôme laissé par une
    // fonction morte — deux causes opposées, jusqu'ici indiscernables.
    await fermerTrace(supabase, traceId, {
      issue: 'refusee',
      erreur: 'Verrou déjà pris : une génération est réputée en cours pour cette période.',
    })
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
      // La trace est déjà ouverte — avant le verrou, plus haut. Quand la
      // fonction serverless est tuée, rien de ce qui suit ne s'exécute : ni le
      // résultat, ni le `finally`, ni la libération du verrou. Une ligne
      // ouverte et jamais refermée est alors la SEULE trace de l'incident, et
      // `ouverte_le` en donne l'heure.
      const etapes: EtapeTracee[] = []

      // On DONNE l'identifiant de trace au navigateur, première ligne du flux.
      //
      // Sans lui, les deux moitiés de l'incident resteraient étrangères : le
      // serveur saurait qu'il a fini, le navigateur saurait que sa fenêtre s'est
      // fermée, et rien ne dirait qu'il s'agit de la MÊME génération. C'est
      // exactement ce qui manquait pour diagnostiquer B-104.
      if (traceId) ecrire({ type: 'trace', traceId })

      // Les étapes tracées sont EXACTEMENT celles annoncées au client : une
      // seule source, donc l'historique ne peut pas raconter autre chose que ce
      // que l'admin a lu à l'écran.
      const emettre = (message: string) => {
        etapes.push({ etape: message, aMs: Date.now() - departMs })
        ecrire({ type: 'progres', message })
      }

      try {
        emettre('Je relis les règles et les congés du cabinet…')
        const { status, corps } = await executerGeneration(supabase, periodeId, cabinetId, emettre)
        ecrire({ type: 'resultat', status, corps })

        const c = corps as Record<string, unknown>
        await fermerTrace(supabase, traceId, {
          issue: (c.issue as 'complet' | 'partiel' | 'echec') ?? 'echec',
          nbGardes: typeof c.nbGardes === 'number' ? c.nbGardes : null,
          interrompu: c.interrompu === true,
          erreur: typeof c.error === 'string' ? c.error : null,
          etapes,
        })
      } catch (err) {
        // Une exception ici laisserait le client sur un flux muet : il attendrait
        // un résultat qui ne viendrait jamais. On la transforme en résultat.
        console.error('[generate] exception pendant la génération :', err)
        ecrire({
          type: 'resultat',
          status: 500,
          corps: { error: err instanceof Error ? err.message : String(err) },
        })
        await fermerTrace(supabase, traceId, {
          issue: 'erreur',
          erreur: err instanceof Error ? err.message : String(err),
          etapes,
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

    // ── B-111 — CE QUE L'ADMIN A FIXÉ, DIT AVANT DE CHERCHER ────
    //
    // Le nombre de places cadenassées change le sens de tout ce qui suit : une
    // régénération qui « ne trouve pas mieux » n'a pas la même signification
    // selon qu'on lui a laissé toute la période ou trois cases sur quarante.
    // Le taire ferait passer une contrainte volontaire pour un échec du moteur.
    const nbFigees = (contexte.placesFigees ?? []).length
    if (nbFigees > 0) {
      emettre(
        `Je garde ${nbFigees} place${nbFigees > 1 ? 's' : ''} que tu as fixée${nbFigees > 1 ? 's' : ''} et je compose autour`,
      )
    }

    // Les cadenas INOPÉRANTS. Deux causes, toutes deux invisibles autrement :
    // une place cadenassée dont la personne a été retirée depuis
    // (`placesFigeesSansTitulaire`), et un cadenas qui ne retombe sur aucune
    // place réelle de la période — créneau supprimé du catalogue, effectif de
    // nuit réduit, date sortie des bornes (`figeesSansPlace`).
    //
    // Dans les deux cas l'écran affiche encore un cadenas, et le moteur, lui,
    // rebat la case. C'est exactement le genre d'écart qu'on ne découvre qu'en
    // comparant deux plannings — donc jamais.
    const stepsPeriode = genererSteps(
      contexte.dateDebut, contexte.dateFin, contexte.saison,
      contexte.nbVetosSemaineSoir, contexte.creneaux,
    )
    const cadenasInoperants = [
      ...figeesSansPlace(indexerFigees(contexte.placesFigees), stepsPeriode)
        .map((f) => `${f.date} · ${f.role} — ce créneau n’existe plus dans cette période`),
      ...(contexte.placesFigeesSansTitulaire ?? [])
        .map((f) => `${f.date} · ${f.role} — la place est vide, il n’y a personne à fixer`),
    ]
    if (cadenasInoperants.length > 0) {
      emettre(
        `⚠️ ${cadenasInoperants.length} cadenas ne s’applique${cadenasInoperants.length > 1 ? 'nt' : ''} à rien — je régénère ${cadenasInoperants.length > 1 ? 'ces places' : 'cette place'}`,
      )
    }

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
        placesFigees: nbFigees,
        cadenasInoperants,
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
    //
    // EXTRAIT le 2026-08-27 dans `data/ecrirePlanningV1` (B-062) : la relecture
    // de Filou réécrit le planning et doit emprunter EXACTEMENT ce chemin, avec
    // ses six précautions (verrous préservés, capture des événements agenda
    // avant le DELETE, réalignement V2). Un second chemin d'écriture aurait été
    // la troisième occurrence d'un défaut déjà payé ici le 22/08.
    const ecriture = await ecrirePlanningV1(
      supabase, planningRetenu, periodeId, cabinetId, contexte.calendrier,
    )

    if (!ecriture.ok) {
      return reponse({ error: ecriture.erreur }, { status: 500 })
    }

    if (ecriture.placementsEchoues) {
      await signalerIncidentTechnique(
        supabase, cabinetId,
        'Écriture des placements incomplète',
        'La copie technique des attributions (garde_placements) a échoué pendant la génération. Le planning affiché est correct ; signale-le si ça se répète.',
      )
    }

    if (ecriture.realignementEchoue) {
      await signalerIncidentTechnique(
        supabase, cabinetId,
        'Copie technique du planning (V2) désynchronisée',
        'Le planning a bien été généré, mais sa copie technique (attributions) n\'a pas pu être réalignée sur les gardes verrouillées. Le contrôle de cohérence la signalera tant qu\'elle diverge.',
      )
    }

    const eventIdsAPurger = ecriture.eventIdsAPurger

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
      nbGardes: ecriture.nbGardes,
      snapshotId: persistenceResult.snapshotId,
      creneauxIgnores,
      creneauxVides,
      exclusDernierRecours,
      // B-111 — combien de places l'admin avait fixees, et lesquels de ses
      // cadenas n'ont servi a rien. Le second est le plus important : sans lui,
      // l'ecran continue d'afficher un cadenas sur une case que le moteur vient
      // de rebattre.
      placesFigees: nbFigees,
      cadenasInoperants,
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
