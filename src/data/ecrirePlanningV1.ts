// ============================================================
// GUARDVETO — Écriture d'un planning dans la table `gardes` (V1)
// ============================================================
// EXTRAIT de `app/api/generate/route.ts` le 2026-08-27 (B-062, lot 1), sans
// changement de comportement : la relecture de Filou doit réécrire le planning
// exactement comme la génération le fait.
//
// ── POURQUOI EXTRAIRE PLUTÔT QUE RECOPIER ───────────────────────────────────
//
// Un second chemin d'écriture des gardes aurait été la troisième occurrence
// d'un défaut déjà payé sur ce projet (« trois chemins d'écriture, deux
// gardiens », 22/08) : les chemins divergent, un seul reçoit les correctifs, et
// c'est l'autre qui casse. Ici il y a un chemin, et il porte les six précautions
// que la génération a accumulées — verrous préservés, capture des événements
// agenda AVANT le DELETE, réalignement V2 sur les gardes verrouillées.
//
// ⚠️ Ce module ne touche NI au statut de la période, NI à Google Agenda. Ces
//    deux gestes appartiennent à la régénération (dépublier avant de détruire,
//    purger les événements après le succès) et n'ont aucun sens pour une
//    retouche de brouillon. Les identifiants d'événements capturés sont RENDUS
//    à l'appelant, qui en fait ce qu'il veut.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttributionGarde, CalendrierResolu, PlanningPartiel } from '@/engine/types'
import { estJourFerie } from '@/engine/utils'
import { construireGardePlacements } from './gardePlacements'
import { syncAttributionsPourJours, joursImpactesGarde } from './syncAttributions'
import { idsEvenementsDeGardes } from '@/lib/sync-calendrier'

/**
 * Convertit le type interne du moteur vers le type de la table gardes (V1).
 * Les attributions `vendredi_soir` sont ignorées (stockées dans weekend).
 *
 * Zone-aware (fix audit 2026-07-03) : le calendrier du cabinet est utilisé —
 * MÊME source que le solver — sinon `gardes.type` divergeait du moteur pour
 * tout cabinet dont les fériés diffèrent du fallback national en dur.
 *
 * Généralisé P3b : un code SUR-MESURE est persisté TEL QUEL (le CHECK 3 valeurs
 * de `gardes.type` est levé en migration). Il garde son code même un jour férié
 * (la reclassification 'ferie' est un héritage propre à semaine_soir) — sinon
 * deux gardes du même jour entreraient en collision sur UNIQUE(date, type).
 */
export function mapTypeGardeEnDb(
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

export interface ResultatEcritureV1 {
  ok: boolean
  /** Message d'erreur prêt à remonter, si `ok` est faux. */
  erreur?: string
  /** Nombre de lignes `gardes` réellement écrites. */
  nbGardes: number
  /**
   * Identifiants d'événements Google Agenda portés par les gardes DÉTRUITES.
   * Capturés AVANT le DELETE (ils vivent sur les lignes `gardes`), rendus à
   * l'appelant pour qu'il purge l'agenda APRÈS le succès — jamais avant : un
   * échec à mi-course laisserait sinon la base vide ET l'agenda vidé.
   */
  eventIdsAPurger: string[]
  /**
   * Vrai si le réalignement V2 sur les gardes verrouillées a échoué. Ce n'est
   * pas bloquant (le planning est bon), mais l'appelant doit le signaler.
   */
  realignementEchoue: boolean
  /** Vrai si la copie technique `garde_placements` a échoué. Non bloquant. */
  placementsEchoues: boolean
}

/**
 * Réécrit les gardes de la période à partir d'un planning du moteur.
 *
 * Les gardes VERROUILLÉES sont préservées : elles représentent des décisions
 * figées, et le solver régénère toute la période sans les connaître.
 */
export async function ecrirePlanningV1(
  supabase: SupabaseClient,
  planning: PlanningPartiel,
  periodeId: string,
  cabinetId: string,
  calendrier?: CalendrierResolu,
): Promise<ResultatEcritureV1> {
  const vide: Omit<ResultatEcritureV1, 'ok' | 'erreur'> = {
    nbGardes: 0,
    eventIdsAPurger: [],
    realignementEchoue: false,
    placementsEchoues: false,
  }

  // 0. CAPTURER les ids d'événements Google Agenda AVANT le DELETE.
  //
  // ⚠️ DEUX SOURCES depuis B-079 (2026-08-27), et l'oubli de la seconde ne se
  // voit nulle part. `gardes.google_event_id` ne porte que l'ANCIEN format (un
  // événement par garde, en voie d'extinction) ; les événements par personne et
  // par jour vivent dans `garde_evenements`. N'en lire qu'une laisse dans
  // l'agenda de la cliente des gardes que plus rien dans le logiciel ne
  // référence — donc que plus rien ne pourra jamais retirer.
  //
  // ⚠️ ET C'EST BIEN AVANT LE DELETE : `garde_evenements.garde_id` est en
  // `ON DELETE CASCADE`. Après le DELETE ci-dessous, les lignes ont disparu et
  // les identifiants sont perdus pour toujours. Même discipline que celle déjà
  // en place pour `gardes.google_event_id`, pour la même raison.
  const { data: gardesAvecEvent } = await supabase
    .from('gardes')
    .select('id, google_event_id')
    .eq('periode_id', periodeId)
    .eq('cabinet_id', cabinetId)
    .eq('verrouille', false)

  const lignesGardes = ((gardesAvecEvent ?? []) as { id: string; google_event_id: string | null }[])
  const anciensIds = lignesGardes
    .map((g) => g.google_event_id)
    .filter((id): id is string => Boolean(id))

  // Scopé aux gardes RÉELLEMENT supprimées ci-dessous (non verrouillées) : une
  // garde verrouillée survit au DELETE, purger ses événements effacerait de
  // l'agenda des gardes toujours valides.
  const nouveauxIds = await idsEvenementsDeGardes(supabase, lignesGardes.map((g) => g.id))
  const eventIdsAPurger = [...new Set([...anciensIds, ...nouveauxIds])]

  // 0b. B-111 — MÉMORISER LES CADENAS AVANT LE DELETE.
  //
  // Une garde cadenassée par l'admin n'est PAS `verrouille` (ce booléen porte la
  // protection automatique des gardes passées/publiées, cf. la migration). Elle
  // est donc supprimée puis réinsérée juste en dessous — et sans cette lecture,
  // ses cadenas repartiraient à vide.
  //
  // Le symptôme aurait été le pire de tous : le planning resterait JUSTE (le
  // moteur a bien composé autour des places figées, elles sont dans ce qu'il
  // rend), mais les cadenas auraient disparu de l'écran. À la génération
  // suivante, plus rien ne serait fixé — et l'admin, qui vient de voir son
  // choix respecté, n'aurait aucune raison de re-vérifier.
  const { data: gardesCadenassees, error: cadenasErr } = await supabase
    .from('gardes')
    .select('date, type, places_figees')
    .eq('periode_id', periodeId)
    .eq('cabinet_id', cabinetId)
    .neq('places_figees', '{}')

  if (cadenasErr) {
    return {
      ...vide, ok: false, eventIdsAPurger,
      erreur: `Erreur lecture des places cadenassées : ${cadenasErr.message}`,
    }
  }

  const cadenasParCle = new Map<string, string[]>()
  for (const g of (gardesCadenassees ?? []) as { date: string; type: string; places_figees: string[] }[]) {
    cadenasParCle.set(`${g.date}|${g.type}`, g.places_figees ?? [])
  }

  // 1. Supprimer les gardes brouillon existantes pour cette période.
  //    Scopé cabinet_id (défense en profondeur : en DEV_BYPASS le client
  //    service_role contourne la RLS, donc on filtre explicitement).
  const { error: deleteErr } = await supabase
    .from('gardes')
    .delete()
    .eq('periode_id', periodeId)
    .eq('cabinet_id', cabinetId)
    .eq('verrouille', false)

  if (deleteErr) {
    return {
      ...vide, ok: false, eventIdsAPurger,
      erreur: `Erreur suppression du brouillon précédent : ${deleteErr.message}`,
    }
  }

  // 1b. Recenser les gardes verrouillées résiduelles de la période, pour les
  //     exclure de l'insert (sinon collision sur UNIQUE(cabinet_id, date, type)).
  const { data: gardesVerrouillees, error: lockedErr } = await supabase
    .from('gardes')
    .select('date, type')
    .eq('periode_id', periodeId)
    .eq('cabinet_id', cabinetId)
    .eq('verrouille', true)

  if (lockedErr) {
    return {
      ...vide, ok: false, eventIdsAPurger,
      erreur: `Erreur lecture des gardes verrouillées : ${lockedErr.message}`,
    }
  }

  const clesVerrouillees = new Set(
    ((gardesVerrouillees ?? []) as { date: string; type: string }[])
      .map((g) => `${g.date}|${g.type}`),
  )

  // 2. Préparer les gardes à insérer (vendredi_soir exclu — fusionné dans
  //    weekend ; dates/type déjà verrouillés exclus).
  const attributionsInserees = planning.attributions
    .filter((a) => a.type !== 'vendredi_soir')
    .map((a) => ({ a, dbType: mapTypeGardeEnDb(a.type, a.date, calendrier) }))
    .filter(({ a, dbType }) => !clesVerrouillees.has(`${a.date}|${dbType}`))

  // Places POSITIONNELLES (P3b) : place 0 → premier_id, place 1 → second_id.
  const gardesAInserer = attributionsInserees.map(({ a, dbType }) => ({
    periode_id: periodeId,
    cabinet_id: cabinetId,
    date: a.date,
    type: dbType,
    premier_id: a.placements[0]?.vetId ?? null,
    second_id: a.placements[1]?.vetId ?? null,
    verrouille: false,
    modifie_manuellement: false,
    // B-111 — les cadenas de l'admin survivent à la régénération (cf. étape 0b).
    places_figees: cadenasParCle.get(`${a.date}|${dbType}`) ?? [],
  }))

  // 3. Insérer en bloc — upsert idempotent scopé cabinet.
  const { error: insertErr } = await supabase
    .from('gardes')
    .upsert(gardesAInserer, {
      onConflict: 'cabinet_id,date,type',
      ignoreDuplicates: true,
    })

  if (insertErr) {
    return {
      ...vide, ok: false, eventIdsAPurger,
      erreur: `Erreur insertion des gardes : ${insertErr.message}`,
    }
  }

  // 3b. Double écriture P3b-1 — miroir des placements dans garde_placements.
  //     ADDITIF : best-effort, un échec ne casse JAMAIS la persistance V1.
  let placementsEchoues = false
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
        date: a.date, dbType, placements: a.placements,
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
        placementsEchoues = true
      }
    }
  } catch (e) {
    console.error('[P3b-1] double écriture garde_placements exception:', e)
    placementsEchoues = true
  }

  // 3c. Réalignement V2 sur les gardes VERROUILLÉES (P6 verrou n°7, étape 3).
  //     Sans lui, V2 porterait l'équipe du solver là où V1 garde l'équipe
  //     verrouillée → dérive garantie dès la régénération.
  let realignementEchoue = false
  if (clesVerrouillees.size > 0) {
    const joursVerrouilles = [
      ...new Set(
        ((gardesVerrouillees ?? []) as { date: string; type: string }[])
          .flatMap((g) => joursImpactesGarde(g.date, g.type)),
      ),
    ]
    const syncVerrous = await syncAttributionsPourJours(
      supabase, periodeId, cabinetId, joursVerrouilles,
    )
    if (!syncVerrous.ok) {
      console.error('[sync-V2] réalignement des gardes verrouillées échoué:', syncVerrous.erreur)
      realignementEchoue = true
    }
  }

  return {
    ok: true,
    nbGardes: gardesAInserer.length,
    eventIdsAPurger,
    realignementEchoue,
    placementsEchoues,
  }
}

/** Ré-exporté pour les appelants qui construisent leurs propres attributions. */
export type { AttributionGarde }
